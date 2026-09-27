import assert from "node:assert/strict"
import { File } from "node:buffer"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))
const nativeRequire = createRequire(import.meta.url)

function loadRoute() {
  const path = resolve(root, "app/api/ops/shop/document/route.ts")
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const timeline = []
  const sql = async (strings, ...values) => {
    timeline.push({ kind: "db", text: strings.join(" ? ").replace(/\s+/g, " ").trim(), values })
    return []
  }
  const put = async (pathname, file, options) => {
    timeline.push({ kind: "blob", pathname, file, options })
    return { pathname: "shop-documents/private-test.pdf" }
  }
  const fakes = new Map([
    ["node:crypto", nativeRequire("node:crypto")],
    ["@vercel/blob", { put }],
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/ops-auth", { getAuthenticatedOperator: async () => ({ id: 17, role: "owner" }) }],
  ])
  const context = vm.createContext({ console, process: { env: {} }, Request, Response, URL, FormData, File, Blob, Date, Buffer })
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, (specifier) => {
    if (fakes.has(specifier)) return fakes.get(specifier)
    throw new Error(`Unexpected shop-document import: ${specifier}`)
  }, loaded)
  return { route: loaded.exports, timeline }
}

function uploadRequest({ type = "application/pdf", size = 13, name = "test-document.pdf" } = {}) {
  const form = new FormData()
  form.set("kind", "w9")
  form.set("file", new File([new Uint8Array(size)], name, { type }))
  return new Request("https://example.test/api/ops/shop/document", { method: "POST", body: form })
}

test("shop document attempt is persisted before the private Blob upload", async () => {
  const { route, timeline } = loadRoute()
  const response = await route.POST(uploadRequest())

  assert.equal(response.status, 303)
  assert.equal(new URL(response.headers.get("location")).pathname, "/ops/shop")
  assert.equal(timeline[0].kind, "db")
  assert.match(timeline[0].text, /INSERT INTO shop_document_attempts/)
  assert.equal(timeline[1].kind, "blob")
  assert.equal(timeline[1].options.access, "private")
  assert.ok(timeline.findIndex((entry) => entry.kind === "blob") < timeline.findIndex((entry) => entry.kind === "db" && entry.text.includes("UPDATE shop_document_attempts")))
})

test("shop document route rejects oversized and non-PDF uploads before persistence", async () => {
  for (const invalid of [
    { type: "text/plain", size: 13, name: "not-a-pdf.txt" },
    { type: "application/pdf", size: 10_000_001, name: "too-large.pdf" },
  ]) {
    const { route, timeline } = loadRoute()
    const response = await route.POST(uploadRequest(invalid))
    assert.equal(response.status, 400)
    assert.equal(timeline.length, 0)
  }
})
