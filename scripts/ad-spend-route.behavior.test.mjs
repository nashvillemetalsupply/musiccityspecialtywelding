import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"
import { parseAdSpendPayload } from "../lib/ad-spend.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const nativeRequire = createRequire(import.meta.url)

function loadRoute() {
  const path = resolve(root, "app/api/ops/ad-spend/route.ts")
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const records = new Map()
  const sqlCalls = []
  const revalidated = []
  const sql = async (strings, ...values) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim()
    sqlCalls.push({ text, values })
    const [month, channel, cents] = values
    records.set(`${month}|${channel}`, { month, channel, cents, source: "api" })
    return []
  }
  const fakes = new Map([
    ["node:crypto", nativeRequire("node:crypto")],
    ["next/cache", { revalidatePath: (pathName) => revalidated.push(pathName) }],
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/ad-spend.mjs", { parseAdSpendPayload }],
  ])
  const context = vm.createContext({ console, process: { env: { AD_SPEND_INGEST_TOKEN: "synthetic-mirror-token" } }, Request, Response, URL, Buffer })
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, (specifier) => {
    if (fakes.has(specifier)) return fakes.get(specifier)
    throw new Error(`Unexpected ad-spend import: ${specifier}`)
  }, loaded)
  return { route: loaded.exports, records, sqlCalls, revalidated }
}

test("ad-spend ingestion returns 401 without a valid bearer token and does no writes", async () => {
  const { route, sqlCalls } = loadRoute()
  const response = await route.POST(new Request("https://example.test/api/ops/ad-spend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ month: "2026-09", google: 125.5 }),
  }))

  assert.equal(response.status, 401)
  assert.equal(sqlCalls.length, 0)
})

test("repeating the same Mirror push leaves one row per month and channel", async () => {
  const { route, records, sqlCalls, revalidated } = loadRoute()
  const request = () => new Request("https://example.test/api/ops/ad-spend", {
    method: "POST",
    headers: { authorization: "Bearer synthetic-mirror-token", "content-type": "application/json" },
    body: JSON.stringify({ month: "2026-09", google: 125.5, facebook: 200 }),
  })

  const first = await route.POST(request())
  const second = await route.POST(request())
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(records.size, 2)
  assert.equal(records.get("2026-09-01|google").cents, 12550)
  assert.equal(records.get("2026-09-01|facebook").cents, 20000)
  assert.equal(sqlCalls.length, 4)
  assert.ok(sqlCalls.every(({ text }) => text.includes("ON CONFLICT (month_start, channel) DO UPDATE")))
  assert.deepEqual(revalidated, ["/board", "/board"])
})
