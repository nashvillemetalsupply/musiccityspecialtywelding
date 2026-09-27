import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { COLUMNS, createExportResponse, ownerExportRefusal } from "../app/api/ops/export/csv.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const routeSource = readFileSync(resolve(root, "app/api/ops/export/route.ts"), "utf8")
const csvSource = readFileSync(resolve(root, "app/api/ops/export/csv.mjs"), "utf8")

function timestampMicros(value) {
  const timestamp = value instanceof Date ? value.toISOString() : String(value)
  const milliseconds = Date.parse(timestamp)
  assert.ok(Number.isFinite(milliseconds), `fake received an invalid timestamp cursor: ${timestamp}`)
  const fraction = timestamp.match(/\.(\d+)/)?.[1] ?? ""
  return BigInt(milliseconds) * 1000n + BigInt(fraction.slice(3, 6).padEnd(3, "0"))
}

function makeSql({ leads = [], googleConversions = [] }) {
  const calls = []
  const sql = {
    async query(text, values = []) {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), values })
      const isGoogle = text.includes("SELECT id, gclid, won_at, revenue_cents")
      const rows = isGoogle ? googleConversions : leads
      const safeRows = text.includes("is_test = false")
        ? rows.filter((row) => row.is_test !== true)
        : rows
      const pageSize = values[values.length - 1]
      const descending = text.includes("ORDER BY created_at DESC")
      const timestampKey = isGoogle ? "cursor_won_at" : "cursor_created_at"
      const timestampOf = (row) => timestampMicros(row[timestampKey] ?? (isGoogle ? row.won_at : row.created_at))
      const idOf = (row) => BigInt(row.id)
      const returnPage = (page) => text.includes(`AS ${timestampKey}`)
        ? page.map((row) => ({
            ...row,
            [timestampKey]: row[timestampKey] ?? (isGoogle ? row.won_at : row.created_at),
          }))
        : page
      const orderedRows = [...safeRows].sort((left, right) => {
        const timestampOrder = timestampOf(left) < timestampOf(right) ? -1 : timestampOf(left) > timestampOf(right) ? 1 : 0
        const idOrder = idOf(left) < idOf(right) ? -1 : idOf(left) > idOf(right) ? 1 : 0
        return descending ? -(timestampOrder || idOrder) : timestampOrder || idOrder
      })
      if (values.length !== 3) return returnPage(orderedRows.slice(0, pageSize))

      const cursorTimestamp = timestampMicros(values[0])
      const cursorId = BigInt(values[1])
      const isAfterCursor = (row) => {
        const timestamp = timestampOf(row)
        const id = idOf(row)
        const comparison = timestamp < cursorTimestamp ? -1 : timestamp > cursorTimestamp ? 1 : id < cursorId ? -1 : id > cursorId ? 1 : 0
        return descending ? comparison < 0 : comparison > 0
      }
      return returnPage(orderedRows.filter(isAfterCursor).slice(0, pageSize))
    },
  }
  return { sql, calls }
}

function leadRow(id, { isTest = false } = {}) {
  return {
    id,
    public_id: isTest ? "INTERNAL-TEST-LEAD" : `L-${id}`,
    created_at: new Date(Date.UTC(2026, 0, 1) - id * 1000).toISOString(),
    first_name: isTest ? "[INTERNAL TEST]" : "Real",
    last_name: "Lead",
    phone: "5550101",
    email: "lead@example.invalid",
    estimate_value_cents: 12500,
    revenue_cents: 12500,
    is_test: isTest,
  }
}

function precisionBoundaryRows({ google = false } = {}) {
  const rows = Array.from({ length: 501 }, (_, index) => {
    const id = index + 1
    const timestamp = index < 499
      ? new Date(Date.UTC(2026, 0, 1) + (google ? index - 500 : 500 - index) * 1000).toISOString()
      : `2026-01-01T00:00:00.${google ? (index === 499 ? "123455" : "123456") : (index === 499 ? "123456" : "123455")}Z`
    const date = new Date(timestamp)
    return google
      ? {
          id,
          gclid: `CLICK-${id}`,
          won_at: date,
          cursor_won_at: timestamp,
          revenue_cents: 12500,
          is_test: false,
        }
      : {
          ...leadRow(id),
          created_at: date,
          cursor_created_at: timestamp,
        }
  })
  return rows
}

test("export refuses a crew session before reading leads", async () => {
  const response = ownerExportRefusal({ id: 5, role: "crew" })

  assert.equal(response.status, 403)
  assert.equal(await response.text(), "Owner access required.")
  assert.equal(ownerExportRefusal(null).status, 401)
  assert.match(routeSource, /const refusal = ownerExportRefusal\(operator\)/)
  assert.ok(routeSource.indexOf("if (refusal) return refusal") < routeSource.indexOf("getSql()"))
})

test("owner full export streams every page and never emits test rows", async () => {
  const leads = Array.from({ length: 501 }, (_, index) => leadRow(index + 1))
  leads.push(leadRow(9000, { isTest: true }))
  const { sql, calls } = makeSql({ leads })
  assert.equal(ownerExportRefusal({ id: 5, role: "owner" }), null)
  const response = createExportResponse(sql, "full")
  const lines = (await response.text()).split("\r\n").filter(Boolean)
  const columns = lines[0].split(",")

  assert.equal(response.status, 200)
  assert.ok(response.body, "CSV response body is streamed")
  assert.equal(lines.length, 502, "header and all 501 non-test leads are exported")
  assert.ok(lines[1].includes("L-1"))
  assert.ok(lines.at(-1).includes("L-501"))
  assert.ok(!lines.join("\n").includes("INTERNAL-TEST-LEAD"))
  assert.ok(!lines.join("\n").includes("[INTERNAL TEST]"))
  assert.ok(calls.every(({ text }) => text.includes("WHERE is_test = false")))
  assert.equal(calls.length, 2, "the second page is fetched after the first 500 rows")
  assert.equal(calls[0].values[0], 500)
  assert.equal(calls[1].values[1], 500, "keyset cursor resumes after the last row from page one")
  assert.ok(calls.every(({ text }) => text.includes("ORDER BY created_at DESC, id DESC")))
  assert.ok(calls.every(({ text }) => !text.includes("LIMIT 5000")))
  assert.ok(columns.includes("public_id"))
  assert.ok(columns.includes("revenue_cents"), "the owner export retains job revenue")
  assert.ok(!columns.some((column) => /^(?:crew|worker)_(?:pay|wages|commission|labor|hourly)(?:_|$)/i.test(column)))
  assert.ok(!columns.some((column) => /^(?:payroll|labor_cost|commission)_cents$/i.test(column)))
  assert.deepEqual(columns, COLUMNS)
})

test("Google offline-conversion export also streams and filters test rows", async () => {
  const { sql, calls } = makeSql({
    googleConversions: [
      { id: 1, gclid: "CLICK-1", won_at: "2026-01-01T00:00:00.000Z", revenue_cents: 12500, is_test: false },
      { id: 2, gclid: "TEST-CLICK", won_at: "2026-01-02T00:00:00.000Z", revenue_cents: 500, is_test: true },
    ],
  })
  const response = createExportResponse(sql, "google-oci")
  const csv = await response.text()

  assert.equal(response.status, 200)
  assert.ok(response.body, "Google CSV response body is streamed")
  assert.match(csv, /CLICK-1,Won Job \(Offline\),2026-01-01 00:00:00\+00:00,125\.00,USD/)
  assert.ok(!csv.includes("TEST-CLICK"))
  assert.ok(calls[0].text.includes("is_test = false"))
  assert.ok(calls[0].text.includes("ORDER BY won_at ASC, id ASC"))
  assert.ok(!calls[0].text.includes("LIMIT 5000"))
})

test("full export preserves microsecond keyset boundaries from Date-returning rows", async () => {
  const leads = precisionBoundaryRows()
  assert.equal(leads[499].created_at.getTime(), leads[500].created_at.getTime(), "driver Date values share one millisecond")
  const { sql, calls } = makeSql({ leads })
  const lines = (await createExportResponse(sql, "full").text()).split("\r\n").filter(Boolean)
  const publicIds = lines.slice(1).map((line) => line.split(",")[0])

  assert.equal(lines.length, 502, "every row is exported across the page boundary")
  assert.equal(new Set(publicIds).size, 501, "no lead is duplicated")
  assert.ok(publicIds.includes("L-501"), "the row just beyond the cursor is not skipped")
  assert.equal(calls.length, 2)
  assert.match(calls[0].text, /created_at::text AS cursor_created_at/)
  assert.equal(calls[1].values[0], leads[499].cursor_created_at, "cursor retains all six fractional digits")
})

test("Google export preserves microsecond keyset boundaries from Date-returning rows", async () => {
  const googleConversions = precisionBoundaryRows({ google: true })
  assert.equal(googleConversions[499].won_at.getTime(), googleConversions[500].won_at.getTime(), "driver Date values share one millisecond")
  const { sql, calls } = makeSql({ googleConversions })
  const lines = (await createExportResponse(sql, "google-oci").text()).split("\r\n").filter(Boolean)
  const clickIds = lines.slice(1).map((line) => line.split(",")[0])

  assert.equal(lines.length, 502, "every conversion is exported across the page boundary")
  assert.equal(new Set(clickIds).size, 501, "no Google conversion is duplicated")
  assert.ok(clickIds.includes("CLICK-501"), "the row just beyond the cursor is not skipped")
  assert.equal(calls.length, 2)
  assert.match(calls[0].text, /won_at::text AS cursor_won_at/)
  assert.equal(calls[1].values[0], googleConversions[499].cursor_won_at, "cursor retains all six fractional digits")
})

test("export route has no test-row bypass or unbounded full-result buffering", () => {
  assert.doesNotMatch(routeSource, /includeTests\s*===?\s*["']1["']/)
  assert.match(csvSource, /new ReadableStream/)
  assert.match(csvSource, /created_at, id\) </)
  assert.match(csvSource, /won_at, id\) >/)
  assert.doesNotMatch(csvSource, /LIMIT\s+5000/i)
  assert.doesNotMatch(csvSource, /SELECT \* FROM leads/i)
})
