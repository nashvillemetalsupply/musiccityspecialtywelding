import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))

function loadTemplates() {
  const path = resolve(root, "lib/email-templates.ts")
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const escapeEmailText = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  const fakes = new Map([
    ["@/lib/shop-contact", { getShopPhone: () => ({ display: "(615) 555-0101", href: "tel:+16155550101" }) }],
    ["@/lib/email-safety.ts", { escapeEmailText, safeEmailHref: (value) => value }],
  ])
  const context = vm.createContext({ console, process: { env: {} } })
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, (specifier) => {
    if (fakes.has(specifier)) return fakes.get(specifier)
    throw new Error(`Unexpected email-template import: ${specifier}`)
  }, loaded)
  return loaded.exports
}

test("branded email retains the [INTERNAL TEST] marker in its visible subject copy", () => {
  const { brandedEmail } = loadTemplates()
  const html = brandedEmail({
    preheader: "[INTERNAL TEST] synthetic preheader",
    headline: "[INTERNAL TEST] Quote received",
    bodyHtml: "<p>[INTERNAL TEST] Synthetic body</p>",
  })

  assert.match(html, /\[INTERNAL TEST\] synthetic preheader/)
  assert.match(html, /<h1[^>]*>\[INTERNAL TEST\] Quote received<\/h1>/)
  assert.match(html, /\[INTERNAL TEST\] Synthetic body/)
})
