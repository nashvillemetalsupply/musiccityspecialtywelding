import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))

function loadRoute(fakes) {
  const path = resolve(root, "app/api/ops/digest/route.ts")
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const context = vm.createContext({
    console,
    process: { env: {} },
    Request,
    Response,
    URL,
    Intl,
    Date,
  })
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, (specifier) => {
    if (fakes.has(specifier)) return fakes.get(specifier)
    throw new Error(`Unexpected digest import: ${specifier}`)
  }, loaded)
  return loaded.exports
}

function normalizedSql(strings) {
  return strings.join(" ? ").replace(/\s+/g, " ").trim()
}

test("digest excludes internal test leads and sends the expected owner summary", async () => {
  const testRows = [
    { is_test: false, id: 1 },
    { is_test: true, id: 2, message: "[INTERNAL TEST] synthetic lead" },
  ]
  const queries = []
  const sent = []
  const sql = async (strings, ...values) => {
    const text = normalizedSql(strings)
    queries.push(text)
    if (text.includes("SELECT count(*)::int AS count FROM leads")) {
      const matching = text.includes("is_test = false") ? testRows.filter((row) => !row.is_test) : testRows
      return [{ count: matching.length }]
    }
    if (text.startsWith("SELECT * FROM leads")) {
      const matching = text.includes("is_test = false") ? testRows.filter((row) => !row.is_test) : testRows
      return matching
    }
    return []
  }
  const route = loadRoute(new Map([
    ["@/lib/db", { dbConfigured: () => true, getSql: () => sql }],
    ["@/lib/ops-auth", { isAuthorizedCron: () => true }],
    ["@/lib/notify", { notifyAll: async (input) => { sent.push(input); return [{ id: 91 }] } }],
  ]))

  const response = await route.GET(new Request("https://example.test/api/ops/digest"))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.unanswered, 1)
  assert.equal(body.failedDeliveries, 1)
  assert.equal(body.staleQuotes, 1)
  assert.equal(body.followUpsDue, 1)
  assert.equal(body.unpaidInvoices, 1)
  assert.equal(body.adWinsReady, 1)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].priority, "digest")
  assert.equal(sent[0].ownerOnly, true)
  assert.match(sent[0].title, /^Today.*shop list is ready$/)
  assert.equal(sent[0].body, "1 due \u00b7 1 waiting \u00b7 1 stale quotes \u00b7 1 unpaid")

  const leadReads = queries.filter((query) => query.startsWith("SELECT * FROM leads") || query.includes("SELECT count(*)::int AS count FROM leads"))
  assert.equal(leadReads.length, 6)
  assert.ok(leadReads.every((query) => query.includes("is_test = false")), "every digest count and row query must exclude test leads")
})
