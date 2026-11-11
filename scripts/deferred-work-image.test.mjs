import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const nativeRequire = createRequire(import.meta.url)
const source = readFileSync(new URL("../components/deferred-work-image.tsx", import.meta.url), "utf8")
function loadComponent(globals = {}) {
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, globals)(
    (name) => name === "next/image" ? () => assert.fail("an offscreen image must not render during SSR") : nativeRequire(name), loaded, loaded.exports,
  )
  return loaded.exports
}

test("server HTML reserves a full photo slot and only exposes the genuine image inside noscript", () => {
  const { DeferredWorkImage } = loadComponent()
  const props = { src: "/images/owner-work/stainless-worktable.webp", alt: "Custom stainless worktable", sizes: "31vw" }
  const html = renderToStaticMarkup(React.createElement(DeferredWorkImage, props))
  assert.match(html, /<span role="img" aria-label="Custom stainless worktable" style="position:absolute;inset:0;display:block">/)
  assert.match(html, /<noscript><img[^>]+src="\/images\/owner-work\/stainless-worktable.webp"[^>]+alt="Custom stainless worktable"/)
  assert.match(html, /width:100%;height:100%;object-fit:cover/)
  assert.doesNotMatch(html.replace(/<noscript>[\s\S]*?<\/noscript>/, ""), /<img|srcset=|rel="preload"/)
})

test("gallery requests wait until the full slot approaches the viewport and schedule exactly once", () => {
  let callback, observed, options, disconnects = 0, loads = 0
  class Observer {
    constructor(receive, config) { callback = receive; options = config }
    observe(element) { observed = element }
    disconnect() { disconnects++ }
  }
  const { observeWorkImage } = loadComponent({ IntersectionObserver: Observer })
  const slot = { id: "full-gallery-photo-slot" }
  const cleanup = observeWorkImage(slot, () => loads++)
  assert.equal(observed, slot)
  assert.equal(options.rootMargin, "240px")
  assert.equal(loads, 0)
  callback([{ isIntersecting: false }])
  assert.equal(loads, 0)
  callback([{ isIntersecting: true }])
  assert.equal(loads, 1)
  assert.equal(disconnects, 1)
  callback([{ isIntersecting: true }])
  assert.equal(loads, 1)
  cleanup()
})

test("unmounting cancels a pending image and browsers without observers load it immediately", () => {
  let callback, loads = 0, disconnects = 0
  class Observer {
    constructor(receive) { callback = receive }
    observe() {}
    disconnect() { disconnects++ }
  }
  const { observeWorkImage } = loadComponent({ IntersectionObserver: Observer })
  const cleanup = observeWorkImage({}, () => loads++)
  cleanup()
  callback([{ isIntersecting: true }])
  assert.equal(disconnects, 1)
  assert.equal(loads, 0)
  const fallback = loadComponent().observeWorkImage({}, () => loads++)
  assert.equal(loads, 1)
  fallback()
})
