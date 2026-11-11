import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"
import ts from "typescript"
import nextConfig from "../next.config.ts"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url))
const provenance = JSON.parse(read("public/images/optimized/critical-image-provenance.json"))
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

test("static critical images retain the approved source and reviewed optimized bytes", async () => {
  assert.equal(provenance.assets.length, 4)
  for (const asset of provenance.assets) {
    const original = read(`public${asset.source}`)
    const optimized = read(`public${asset.publicPath}`)
    assert.equal(sha256(original), asset.sourceSha256, `${asset.source}: source changed; review cached variants`)
    assert.equal(sha256(optimized), asset.sha256, `${asset.publicPath}: approved optimized bytes changed`)
    assert.equal(optimized.byteLength, asset.bytes)
    if (asset.publicPath === "/images/optimized/IMG_3994-768-q75.avif") {
      assert.equal(asset.quality, 43, "the re-encoded AVIF records its actual encoder quality")
      assert.equal(asset.requestedQuality, 75, "the approved variant still replaces the original quality-75 request")
      assert.ok(optimized.byteLength <= 40_000, "the mobile-welding 768px hero must stay within Fable's 40 KB cap")
    } else assert.equal(asset.quality, 75)
    assert.equal(asset.mimeType, "image/avif")
    const [sourceMetadata, metadata] = await Promise.all([sharp(original).metadata(), sharp(optimized).metadata()])
    assert.equal(metadata.width, asset.width)
    assert.ok(Math.abs(metadata.height - sourceMetadata.height * asset.width / sourceMetadata.width) < 1, "source aspect ratio must survive unchanged")
  }
})

function renderHero(src, quality) {
  const nativeRequire = createRequire(import.meta.url)
  const { getImgProps } = nativeRequire("next/dist/shared/lib/get-img-props")
  const { imageConfigDefault } = nativeRequire("next/dist/shared/lib/image-config")
  const defaultLoader = nativeRequire("next/dist/shared/lib/image-loader").default
  const loaded = { exports: {} }
  const source = ts.transpileModule(read("components/critical-image.tsx").toString(), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  new Function("exports", "require", "module", source)(loaded.exports, (name) => {
    if (name === "@/public/images/optimized/critical-image-provenance.json") return provenance
    // Unbundled Next defaults omit this repo's 768px device size. Exercise the
    // same width/quality selection as the built site with its real config.
    if (name === "next/image") return { getImageProps: (props) => getImgProps(props, { defaultLoader, imgConf: { ...imageConfigDefault, ...nextConfig.images } }) }
    return nativeRequire(name)
  }, loaded)
  return renderToStaticMarkup(React.createElement(loaded.exports.CriticalImage, {
    src, quality, alt: "Existing shop work", fill: true,
    sizes: "(max-width: 899px) calc(100vw - 2rem), 46vw", priority: true, fetchPriority: "high",
  }))
}

test("the server hero emits one AVIF preload and keeps an eager native format fallback", () => {
  const html = renderHero("/images/optimized/welder-1600.webp")
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

test("the approved re-encode still serves the static 768px hero for default and explicit quality-75 requests", () => {
  for (const quality of [undefined, 75]) {
    const html = renderHero("/images/owner-work/IMG_3994.webp", quality)
    const preload = html.match(/<link\b[^>]*>/)?.[0]
    const avifSource = html.match(/<source\b[^>]*>/)?.[0]
    assert.ok(preload && avifSource)
    for (const markup of [preload, avifSource]) {
      assert.match(markup, /IMG_3994-768-q75\.avif 768w/)
      assert.doesNotMatch(markup, /%2Fimages%2Fowner-work%2FIMG_3994\.webp(?:&amp;|&)w=768/)
    }
  }
})
