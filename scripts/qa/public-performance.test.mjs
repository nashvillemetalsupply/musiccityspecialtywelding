import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import Module from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"
import ts from "typescript"
import test from "node:test"

const root = fileURLToPath(new URL("../..", import.meta.url))

test("the home hero uses the 1600px source through Next image optimization", async () => {
  const page = readFileSync(join(root, "app", "page.tsx"), "utf8")
  const heroImage = /<Image\s+src="\/images\/optimized\/welder-1600\.webp"[\s\S]*?\/>/.exec(page)?.[0]
  assert.ok(heroImage, "home hero must point to the 1600px welder source")
  assert.match(heroImage, /\bsizes=/)
  assert.match(heroImage, /\bpriority\b/)
  assert.match(heroImage, /fetchPriority="high"/)
  assert.doesNotMatch(heroImage, /\bunoptimized\b/)

  const image = await sharp(join(root, "public", "images", "optimized", "welder-1600.webp")).metadata()
  assert.equal(image.width, 1600)
  assert.equal(image.height, 1280)
})

function loadPublicAnalyticsForServerRender() {
  const filename = join(root, "components", "public-analytics.tsx")
  const source = readFileSync(filename, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  })
  const measurementSource = readFileSync(join(root, "lib", "measurement.ts"), "utf8")
  const measurementModule = new Module(join(root, "lib", "measurement.ts"))
  measurementModule._compile(ts.transpileModule(measurementSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, measurementModule.id)
  const measurement = measurementModule.exports
  const pixelId = measurement.META_PIXEL_ID
  assert.ok(pixelId, "the existing Meta pixel ID must be present")

  const originalLoad = Module._load
  Module._load = function loadForServerRender(request, parent, isMain) {
    if (request === "next/script") {
      return {
        __esModule: true,
        default: ({ id, children }) => React.createElement("script", { id }, children),
      }
    }
    if (request === "next/navigation") return { usePathname: () => "/" }
    if (request === "@/components/attribution-tracker") return { AttributionTracker: () => null }
    if (request === "@/components/deferred-google-tag") return { DeferredGoogleTag: () => null }
    if (request === "@/components/phone-click-tracker") return { PhoneClickTracker: () => null }
    if (request === "@/lib/measurement") return measurement
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const loaded = new Module(filename)
    loaded.filename = filename
    loaded.paths = Module._nodeModulePaths(root)
    loaded._compile(compiled.outputText, filename)
    return { component: loaded.exports.PublicAnalytics, metaPixelBootstrapSource: loaded.exports.metaPixelBootstrapSource, pixelId }
  } finally {
    Module._load = originalLoad
  }
}

test("the initial server HTML omits Meta while its deferred payload stays unchanged", () => {
  const { component, metaPixelBootstrapSource, pixelId } = loadPublicAnalyticsForServerRender()
  const html = renderToStaticMarkup(React.createElement(component, { measurementId: "G-TEST123" }))
  assert.match(html, /id="google-tag"/)
  assert.doesNotMatch(html, /id="meta-pixel"|fbevents\.js|connect\.facebook\.net/)

  const payload = metaPixelBootstrapSource(pixelId)
  const eventCalls = payload.match(/fbq\('(init|track)'[^;]*;/g)
  assert.deepEqual(eventCalls, [`fbq('init', '${pixelId}');`, "fbq('track', 'PageView');"])
  assert.match(payload, /window\.fbq\.apply\(window, queued\[i\]\)/)
})
