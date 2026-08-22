import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { paymentRollup } from "../lib/payments.mjs"

test("partial payment accrues and does not settle", () => {
  assert.deepEqual(
    paymentRollup({ currentPaidCents: 0, amountCents: 50000, invoiceTotalCents: 186000, settles: false }),
    { paidTotalCents: 50000, fullyPaid: false })
})

test("reaching the invoice total settles", () => {
  assert.deepEqual(
    paymentRollup({ currentPaidCents: 50000, amountCents: 136000, invoiceTotalCents: 186000, settles: false }),
    { paidTotalCents: 186000, fullyPaid: true })
})

test("overpayment still settles and keeps the real total", () => {
  assert.deepEqual(
    paymentRollup({ currentPaidCents: 0, amountCents: 200000, invoiceTotalCents: 186000, settles: false }),
    { paidTotalCents: 200000, fullyPaid: true })
})

test("no invoice: only the owner's word settles", () => {
  assert.equal(paymentRollup({ currentPaidCents: 0, amountCents: 40000, invoiceTotalCents: null, settles: false }).fullyPaid, false)
  assert.equal(paymentRollup({ currentPaidCents: 0, amountCents: 40000, invoiceTotalCents: null, settles: true }).fullyPaid, true)
})

test("null current rollup reads as zero", () => {
  assert.equal(paymentRollup({ currentPaidCents: null, amountCents: 100, invoiceTotalCents: null, settles: false }).paidTotalCents, 100)
})

test("the action is owner-gated and persists the receipt before the rollup", () => {
  const src = readFileSync("app/ops/actions.ts", "utf8")
  const action = src.slice(src.indexOf("export async function recordPayment"))
  assert.notEqual(action.length, src.length, "recordPayment exists")
  assert.match(action.slice(0, 400), /requireOwner\(operator\)/)
  // event first, leads UPDATE second — intent persists before the side effect
  assert.ok(action.indexOf("recordEvent") < action.indexOf("UPDATE leads"))
})
