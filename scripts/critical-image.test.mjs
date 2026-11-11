import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"
import ts from "typescript"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url))
const provenance = JSON.parse(read("public/images/optimized/critical-image-provenance.json"))
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

test("static critical images retain the approved source and copied optimized bytes", async () => {
  assert.equal(provenance.assets.length, 4)
  for (const asset of provenance.assets) {
    const original = read(`public${asset.source}`)
    const optimized = read(`public${asset.publicPath}`)
    assert.equal(sha256(original), asset.sourceSha256, `${asset.source}: source changed; review cached variants`)
    assert.equal(sha256(optimized), asset.sha256, `${asset.publicPath}: copied bytes changed`)
    assert.equal(optimized.byteLength, asset.bytes)
    assert.equal(asset.quality, 75)
    assert.equal(asset.mimeType, "image/avif")
    const [sourceMetadata, metadata] = await Promise.all([sharp(original).metadata(), sharp(optimized).metadata()])
    assert.equal(metadata.width, asset.width)
    assert.ok(Math.abs(metadata.height - sourceMetadata.height * asset.width / sourceMetadata.width) < 1, "source aspect ratio must survive unchanged")
  }
})

test("the server hero emits one AVIF preload and keeps an eager native format fallback", () => {
  const nativeRequire = createRequire(import.meta.url)
  const loaded = { exports: {} }
  const source = ts.transpileModule(read("components/critical-image.tsx").toString(), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  new Function("exports", "require", "module", source)(loaded.exports, (name) =>
    name === "@/public/images/optimized/critical-image-provenance.json" ? provenance : nativeRequire(name), loaded)
  const html = renderToStaticMarkup(React.createElement(loaded.exports.CriticalImage, {
    src: "/images/optimized/welder-1600.webp", alt: "Existing shop work", fill: true,
    sizes: "(max-width: 899px) calc(100vw - 2rem), 46vw", priority: true, fetchPriority: "high",
  }))
  assert.equal((html.match(/<link\b/g) ?? []).length, 1, "the native fallback must not preload a second image")
  assert.match(html, /<link[^>]*type="image\/avif"[^>]*fetchPriority="high"/)
  assert.match(html, /<source[^>]*type="image\/avif"[^>]*welder-1600-640-q75\.avif/)
  const fallback = html.match(/<img\b[^>]*>/)?.[0]
  assert.ok(fallback)
  assert.match(fallback, /srcSet="\/_next\/image\?/)
  assert.match(fallback, /fetchPriority="high"/)
  assert.match(fallback, /alt="Existing shop work"/)
  assert.doesNotMatch(fallback, /loading="lazy"/)
})
