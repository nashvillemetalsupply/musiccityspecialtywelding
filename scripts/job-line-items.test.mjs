import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import {
  MAX_LINE_ITEMS, formatLineItemsText, lineItemsTotalCents, parseLineItemsText,
} from "../lib/job-line-items.mjs"

test("both line shapes parse, and money survives the round trip", () => {
  const { items, errors } = parseLineItemsText([
    "Steel | 10 ga galv, 18 pcs | 1860",
    "Galv touch-up | 180",
    "Delivery | Gallatin | $280.50",
  ].join("\n"))

  assert.deepEqual(errors, [])
  assert.equal(items.length, 3)
  assert.deepEqual(items[0], { label: "Steel", note: "10 ga galv, 18 pcs", amountCents: 186_000 })
  assert.deepEqual(items[1], { label: "Galv touch-up", note: "", amountCents: 18_000 })
  assert.equal(items[2].amountCents, 28_050)
  assert.equal(lineItemsTotalCents(items), 232_050)

  // Editing is the same act as entering, so what comes back out has to parse
  // to exactly what went in.
  assert.deepEqual(parseLineItemsText(formatLineItemsText(items)).items, items)
})

test("blank lines are skipped, bad lines are named by number", () => {
  const { items, errors } = parseLineItemsText([
    "Steel | 1860",
    "",
    "no pipe at all",
    " | 40",
    "Weld | not money",
  ].join("\n"))

  assert.equal(items.length, 1)
  assert.equal(errors.length, 3)
  assert.match(errors[0], /^Line 3:/)
  assert.match(errors[1], /^Line 4:/)
  assert.match(errors[2], /^Line 5:/)
})

test("the list is bounded and negatives are refused", () => {
  const overLong = Array.from({ length: MAX_LINE_ITEMS + 5 }, (_, i) => `Line ${i} | 1`).join("\n")
  const long = parseLineItemsText(overLong)
  assert.equal(long.items.length, MAX_LINE_ITEMS)
  assert.equal(long.errors.length, 1)

  assert.equal(parseLineItemsText("Refund | -50").items.length, 0)
  assert.equal(parseLineItemsText("Moon | 99999999999").items.length, 0)
  assert.equal(lineItemsTotalCents(null), 0)
  assert.equal(formatLineItemsText(null), "")
})

test("line items are money: crew never reads them and the write is owner-gated", () => {
  const store = readFileSync(new URL("../lib/job-line-items.ts", import.meta.url), "utf8")
  // Both readers refuse a non-owner role before any SQL runs. Crew getting an
  // empty list is authorization; hiding the table in CSS would not be.
  assert.match(store, /if \(role !== "owner"\) return \[\]/)
  assert.match(store, /if \(role !== "owner"\) return byLead/)
  assert.match(store, /FROM job_line_items items\s+JOIN leads l ON l\.id = items\.lead_id/)
  assert.match(store, /items\.is_test = false\s+AND l\.is_test = false/)
  assert.match(store, /NOT ILIKE '%\[INTERNAL TEST\]%'/)
  // Every interpolation carries an explicit Postgres cast (Neon 42P18).
  for (const cast of ["::bigint[]", "::bigint", "::int", "::text", "::boolean"]) {
    assert.ok(store.includes(cast), `${cast} missing from the line-item queries`)
  }

  const actions = readFileSync(new URL("../app/ops/actions.ts", import.meta.url), "utf8")
  const action = actions.slice(actions.indexOf("export async function saveJobLineItems"))
  assert.match(action.slice(0, 400), /requireOwner\(operator\)/)
  // A rejected line blocks the whole save rather than writing a partial list.
  assert.match(action.slice(0, 900), /if \(errors\.length\) throw new Error/)
  // is_test follows the lead, so a test job never counts as business.
  assert.match(action.slice(0, 1200), /isTest: rows\[0\]\.is_test/)
})

test("the migration is idempotent and the table is additive", () => {
  const migration = readFileSync(new URL("../scripts/migrate.mjs", import.meta.url), "utf8")
  assert.match(migration, /CREATE TABLE IF NOT EXISTS job_line_items/)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS job_line_items_lead_idx/)
  assert.match(migration, /job_line_items_label_check CHECK \(label <> ''\)/)
})
