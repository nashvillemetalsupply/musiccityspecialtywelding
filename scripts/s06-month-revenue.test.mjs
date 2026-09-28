import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))

function loadOpsData(revenueRows) {
  const path = resolve(root, "lib/ops-data.ts")
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const queries = []
  const sql = async (strings, ...values) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim()
    const [start, end] = values
    queries.push({ text, start, end })
    const from = Date.parse(start)
    const until = Date.parse(end)
    const cents = revenueRows
      .filter((row) => Date.parse(row.wonAt) >= from && Date.parse(row.wonAt) < until)
      .reduce((sum, row) => sum + row.cents, 0)
    return [{ cents }]
  }
  const moduleFakes = new Map([
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/events", { listBoardEventTrails: async () => [] }],
    ["@/lib/job-line-items", { listJobLineItemsForLeads: async () => new Map() }],
    ["@/lib/leads", { LEAD_STATUSES: [] }],
    ["@/lib/ad-spend.mjs", { AD_CHANNELS: [] }],
    ["@/lib/dni.mjs", { dniNumber: () => "" }],
    ["@/lib/pagination", { clampPageToTotal: () => 1, normalizePage: () => 1 }],
    ["@/lib/shop-brain-invariants.mjs", { BOARD_SIGNAL_LABELS: {} }],
    ["@/lib/visibility", { projectClaimForRole: (row) => row, projectCommitmentForRole: (row) => row, redactCrewText: (value) => value }],
  ])
  const context = vm.createContext({ console, Intl, Date, process: { env: {} }, require: (specifier) => {
    if (moduleFakes.has(specifier)) return moduleFakes.get(specifier)
    throw new Error(`Unexpected ops-data import: ${specifier}`)
  } })
  const loaded = { exports: {} }
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, context.require, loaded)
  return { getMonthRevenueCents: loaded.exports.getMonthRevenueCents, queries }
}

test("monthly revenue uses Central month boundaries at 23:59 and 00:00 through DST", async () => {
  const revenueRows = [
    { wonAt: "2026-04-01T04:59:00.000Z", cents: 100 }, // March 31, 23:59 CDT
    { wonAt: "2026-04-01T05:00:00.000Z", cents: 200 }, // April 1, 00:00 CDT
    { wonAt: "2026-05-01T04:59:00.000Z", cents: 300 }, // April 30, 23:59 CDT
    { wonAt: "2026-05-01T05:00:00.000Z", cents: 400 }, // May 1, 00:00 CDT
  ]
  const opsDataModule = loadOpsData(revenueRows)

  const marchRevenue = await opsDataModule.getMonthRevenueCents(new Date("2026-04-01T04:59:00.000Z"))
  const aprilRevenue = await opsDataModule.getMonthRevenueCents(new Date("2026-04-01T05:00:00.000Z"))

  assert.equal(marchRevenue, 100)
  assert.equal(aprilRevenue, 500)
  assert.deepEqual(opsDataModule.queries.map(({ start, end }) => [start, end]), [
    ["2026-03-01T06:00:00.000Z", "2026-04-01T05:00:00.000Z"],
    ["2026-04-01T05:00:00.000Z", "2026-05-01T05:00:00.000Z"],
  ])
  for (const query of opsDataModule.queries) {
    assert.match(query.text, /won_at >= \?\s*::timestamptz/)
    assert.match(query.text, /won_at < \?\s*::timestamptz/)
  }
})
