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
function publicPages(chatFlag, suspense = React.Suspense) {
  const cache = new Map()
  const nextLinks = []
  const fakes = {
    react: { ...React, Suspense: suspense },
    "next/link": ({ children, ...props }) => { nextLinks.push(props.href); return React.createElement("a", props, children) },
    "next/image": Object.assign(({ src, alt }) => React.createElement("img", { src, alt }), { getImageProps: ({ src, alt }) => ({ props: { src, alt } }) }),
    "@/public/images/optimized/critical-image-provenance.json": nativeRequire("../public/images/optimized/critical-image-provenance.json"),
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
  return { load, render: (element) => renderToStaticMarkup(element), nextLinks }
}

test("yielding below-fold hydration preserves the complete server-rendered public HTML", async () => {
  const bounded = publicPages("1")
  const transparent = publicPages("1", React.Fragment)
  assert.equal(
    bounded.render(React.createElement(bounded.load("app/page.tsx").default)),
    transparent.render(React.createElement(transparent.load("app/page.tsx").default)),
  )
  for (const { slug } of bounded.load("lib/service-pages.ts").servicePages) {
    const params = { params: Promise.resolve({ slug }) }
    assert.equal(
      bounded.render(await bounded.load("app/services/[slug]/page.tsx").default(params)),
      transparent.render(await transparent.load("app/services/[slug]/page.tsx").default(params)),
      `${slug}: hydration boundaries must retain every server-rendered element and attribute`,
    )
  }
})

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
  test(`desktop header offers only the phone CTA (chat ${chatFlag ?? "off"})`, () => {
    const { load, render } = publicPages(chatFlag)
    for (const home of [false, true]) {
      const html = render(React.createElement(load("components/navbar.tsx").Navbar, { home }))
      const desktop = html.replace(/<details\b[\s\S]*?<\/details>/g, "")
      assert.deepEqual(counts(desktop), { tel: 1, callButtons: 1, ask: 0 })
      assert.match(desktop, /aria-label="Desktop navigation"/)
    }
  })

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
      for (const name of ["ms-subhero", "ms-contact"]) {
        assert.equal(counts(section(html, name)).callButtons, 1, `${slug} ${name} call`)
        assert.equal(counts(section(html, name)).ask, 1, `${slug} ${name} ask`)
      }
      assert.doesNotMatch(html, /<section[^>]*class="ms-subclose"/, `${slug} has one closing section`)
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

test("public navigation renders the correct service, section, city and legal destinations", async () => {
  const { load, render, nextLinks } = publicPages("1")
  const home = render(React.createElement(load("app/page.tsx").default))
  for (const href of ["#home", "#work", "#services", "#job-glass", "/privacy", "/terms", "/services/mobile-welding#service"]) assert.ok(home.includes(`href="${href}"`), href)
  for (const { slug } of load("lib/service-pages.ts").servicePages) assert.ok(home.includes(`href="/services/${slug}"`) || slug === "gate-repair", slug)
  const ServicePage = load("app/services/[slug]/page.tsx").default
  const service = render(await ServicePage({ params: Promise.resolve({ slug: "mobile-welding" }) }))
  for (const href of ["/", "/#services", "/#job-glass", "/service-areas", "/privacy", "/terms"]) assert.ok(service.includes(`href="${href}"`), href)
  assert.equal((home.match(/href="\/services\/mobile-welding#service"/g) ?? []).length, 8)
  for (const href of ["#home", "#work", "#services", "#job-glass", "/privacy", "/terms", "/services/mobile-welding#service", "/service-areas"]) assert.ok(nextLinks.includes(href), `Link destination ${href}`)
})
