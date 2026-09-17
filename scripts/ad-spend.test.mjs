import { strict as assert } from "node:assert"
import test from "node:test"

import { costPerLeadCents, parseAdSpendPayload, parseSpendDollars } from "../lib/ad-spend.mjs"

test("blank spend leaves the saved number alone", () => {
  assert.deepEqual(parseSpendDollars(""), { ok: true, cents: null })
  assert.deepEqual(parseSpendDollars("   "), { ok: true, cents: null })
  assert.deepEqual(parseSpendDollars(null), { ok: true, cents: null })
})

test("zero is a real answer and is kept", () => {
  assert.deepEqual(parseSpendDollars("0"), { ok: true, cents: 0 })
})

test("dollars, commas and a dollar sign all parse", () => {
  assert.deepEqual(parseSpendDollars("450"), { ok: true, cents: 45000 })
  assert.deepEqual(parseSpendDollars("$1,234.50"), { ok: true, cents: 123450 })
})

test("junk and negatives are refused rather than stored as zero", () => {
  assert.equal(parseSpendDollars("abc").ok, false)
  assert.equal(parseSpendDollars("-5").ok, false)
  assert.equal(parseSpendDollars("2000000").ok, false)
})

test("cost per lead divides spend by leads", () => {
  assert.equal(costPerLeadCents(45000, 12), 3750)
  assert.equal(costPerLeadCents(0, 12), 0)
})

test("no recorded spend is not the same answer as no leads", () => {
  assert.equal(costPerLeadCents(null, 12), null)
  // Spend with nothing to show for it is the whole spend, not a divide by zero.
  assert.equal(costPerLeadCents(45000, 0), 45000)
  assert.equal(costPerLeadCents(0, 0), null)
})

test("the ingest payload takes an optional YYYY-MM month", () => {
  assert.deepEqual(parseAdSpendPayload({ google: 450, facebook: "120.50" }), {
    ok: true,
    monthStart: null,
    updates: [{ channel: "google", cents: 45000 }, { channel: "facebook", cents: 12050 }],
  })
  assert.equal(parseAdSpendPayload({ month: "2026-08", google: 1 }).monthStart, "2026-08-01")
  assert.equal(parseAdSpendPayload({ month: "2026-13", google: 1 }).ok, false)
  assert.equal(parseAdSpendPayload({ month: "August", google: 1 }).ok, false)
})

test("the ingest payload refuses junk rather than writing a wrong number", () => {
  assert.equal(parseAdSpendPayload({ google: "abc" }).ok, false)
  assert.equal(parseAdSpendPayload({ google: -5 }).ok, false)
  assert.equal(parseAdSpendPayload(null).ok, false)
  // No channel at all is a broken sender, not a month of zero spend.
  assert.equal(parseAdSpendPayload({ month: "2026-09" }).ok, false)
})

test("one channel alone leaves the other channel's saved figure alone", () => {
  const parsed = parseAdSpendPayload({ google: 200 })
  assert.deepEqual(parsed.updates, [{ channel: "google", cents: 20000 }])
})
