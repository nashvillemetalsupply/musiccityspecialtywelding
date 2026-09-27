import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))

function loadRoute({ role }) {
  const path = resolve(root, "app/api/ops/export/route.ts")
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const sqlCalls = []
  const sql = async (strings, ...values) => {
    sqlCalls.push({ text: strings.join(" ? ").replace(/\s+/g, " ").trim(), values })
    return [{
      public_id: "L-TEST-1",
      first_name: "[INTERNAL TEST]",
      last_name: "Example",
      phone: "5550101",
      email: "test@example.invalid",
      estimate_value_cents: 12500,
      revenue_cents: 12500,
      is_test: true,
    }]
  }
  const fakes = new Map([
    ["next/headers", { cookies: async () => ({ get: () => ({ value: "synthetic-session" }) }) }],
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/ops-auth", {
      OPS_SESSION_COOKIE: "mcw_ops_session",
      validateSessionToken: async () => ({ id: 5, role }),
    }],
  ])
  const context = vm.createContext({ console, process: { env: {} }, Request, Response, URL, Date })
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, (specifier) => {
    if (fakes.has(specifier)) return fakes.get(specifier)
    throw new Error(`Unexpected export import: ${specifier}`)
  }, loaded)
  return { route: loaded.exports, sqlCalls }
}

test("export refuses a crew session before reading leads", async () => {
  const { route, sqlCalls } = loadRoute({ role: "crew" })
  const response = await route.GET(new Request("https://example.test/api/ops/export"))

  assert.equal(response.status, 403)
  assert.equal(await response.text(), "Owner access required.")
  assert.equal(sqlCalls.length, 0)
})

test("owner CSV contains no crew pay or worker compensation columns", async () => {
  const { route, sqlCalls } = loadRoute({ role: "owner" })
  const response = await route.GET(new Request("https://example.test/api/ops/export"))
  const [header] = (await response.text()).split("\r\n")

  assert.equal(response.status, 200)
  assert.ok(sqlCalls.some(({ text }) => text.includes("SELECT * FROM leads")))
  const columns = header.split(",")
  assert.ok(columns.includes("public_id"))
  assert.ok(columns.includes("revenue_cents"), "the owner export retains job revenue")
  assert.ok(!columns.some((column) => /^(?:crew|worker)_(?:pay|wages|commission|labor|hourly)(?:_|$)/i.test(column)))
  assert.ok(!columns.some((column) => /^(?:payroll|labor_cost|commission)_cents$/i.test(column)))
})
