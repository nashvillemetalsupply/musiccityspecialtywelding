import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))
const nativeRequire = createRequire(import.meta.url)
const compiled = new Map()
const phone = { href: "tel:+16157033296", display: "(615) 703-3296" }

// Render the actual route and shared action components. Only Next's media/link
// adapters and unrelated metadata/measurement dependencies are replaced.
function publicPages(chatFlag) {
  const cache = new Map()
  const fakes = {
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "next/image": ({ src, alt }) => React.createElement("img", { src, alt }),
    "next/navigation": { notFound: () => { throw new Error("not found") } },
    "@/lib/shop-contact": { getShopPhone: () => phone },
    "@/lib/public-metadata": { createPublicMetadata: () => ({}) },
    "@/lib/measurement": {},
  }
  function load(path) {
    const file = resolve(root, path)
    if (cache.has(file)) return cache.get(file)
    if (!compiled.has(file)) {
      compiled.set(file, ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText)
    }
    const compiledModule = { exports: {} }
    cache.set(file, compiledModule.exports)
    const require = (name) => {
      if (Object.hasOwn(fakes, name)) return fakes[name]
      if (name.endsWith(".css")) return {}
      if (name.startsWith("@/") || name.startsWith(".")) {
        const target = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(file), name)
        const source = [target, `${target}.tsx`, `${target}.ts`].find((candidate) => existsSync(candidate))
        assert.ok(source, `missing local dependency: ${name}`)
        return load(source)
      }
      return nativeRequire(name)
    }
    const context = vm.createContext({ process: { env: { NEXT_PUBLIC_ASSISTANT_CHAT: chatFlag } }, require })
    vm.runInContext(`(function(exports, require, module) { ${compiled.get(file)}\n})`, context)(compiledModule.exports, require, compiledModule)
    return compiledModule.exports
  }
  return { load, render: (element) => renderToStaticMarkup(element) }
}

const counts = (html) => ({
  tel: (html.match(/<a\b[^>]*href="tel:/g) ?? []).length,
  callButtons: (html.match(/<a\b(?=[^>]*class="[^"]*\bms-button\b)(?=[^>]*href="tel:)[^>]*>/g) ?? []).length,
  ask: (html.match(/<(?:a|button)\b[^>]*>Ask the shop<\/(?:a|button)>/g) ?? []).length,
})

function section(html, className) {
  const body = html.match(new RegExp(`<section\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/section>`))?.[1]
  assert.ok(body, `missing ${className}`)
  return body
}

function content(html) {
  const main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/)?.[0]
  const footer = html.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0]
  assert.ok(main && footer)
  return main + footer
}

for (const chatFlag of [undefined, "1"]) {
  test(`home has only hero, post-process, and quote-form CTA pairs (chat ${chatFlag ?? "off"})`, () => {
    const { load, render } = publicPages(chatFlag)
    const html = render(React.createElement(load("app/page.tsx").default))
    assert.deepEqual(counts(content(html)), { tel: 5, callButtons: 3, ask: 3 })
    for (const name of ["ms-hero", "ms-process", "ms-contact"]) {
      const { callButtons, ask } = counts(section(html, name))
      assert.deepEqual({ callButtons, ask }, { callButtons: 1, ask: 1 }, name)
    }
    assert.ok(html.indexOf('id="services"') < html.indexOf('id="process"'))
    assert.ok(html.indexOf('id="process"') < html.indexOf('id="contact"'))
  })

  test(`every service has only hero and closing CTA pairs (chat ${chatFlag ?? "off"})`, async () => {
    const { load, render } = publicPages(chatFlag)
    const ServicePage = load("app/services/[slug]/page.tsx").default
    for (const { slug } of load("lib/service-pages.ts").servicePages) {
      const html = render(await ServicePage({ params: Promise.resolve({ slug }) }))
      assert.deepEqual(counts(content(html)), { tel: 4, callButtons: 2, ask: 2 }, slug)
      for (const name of ["ms-subhero", "ms-subclose"]) {
        assert.equal(counts(section(html, name)).callButtons, 1, `${slug} ${name} call`)
        assert.equal(counts(section(html, name)).ask, 1, `${slug} ${name} ask`)
      }
      assert.equal(counts(section(html, "ms-contact")).callButtons, 0, `${slug} form has no extra call CTA`)
    }
  })

  test(`service areas has only hero and closing CTA pairs (chat ${chatFlag ?? "off"})`, () => {
    const { load, render } = publicPages(chatFlag)
    const html = render(React.createElement(load("app/service-areas/page.tsx").default))
    assert.deepEqual(counts(content(html)), { tel: 3, callButtons: 2, ask: 2 })
    for (const name of ["ms-area-hero", "ms-subclose"]) {
      assert.equal(counts(section(html, name)).callButtons, 1, name)
      assert.equal(counts(section(html, name)).ask, 1, name)
    }
  })
}
