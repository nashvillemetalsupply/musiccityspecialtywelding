import { strict as assert } from "node:assert"
import test from "node:test"

import { costPerLeadCents, parseSpendDollars } from "../lib/ad-spend.mjs"

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
