import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runOwnerPaymentReversal, normalizePaymentReversalInput } from "../lib/payment-reversal.mjs"
import { eventIsOwnerOnly } from "../lib/event-visibility.mjs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("crew cannot reverse a payment and the rejected attempt writes nothing", async () => {
  let writes = 0
  await assert.rejects(
    runOwnerPaymentReversal("crew", async () => { writes += 1 }),
    /Owner access is required/,
  )
  assert.equal(writes, 0)
  const actions = read("app/ops/actions.ts")
  const start = actions.indexOf("export async function reversePayment(")
  const end = actions.indexOf("export async function reversePaymentState(", start)
  const action = actions.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.ok(action.indexOf("runOwnerPaymentReversal(operator.role") < action.indexOf("applyPaymentReversal("))
})

test("a reversal requires a positive amount and a nonempty reason", () => {
  assert.throws(() => normalizePaymentReversalInput(0, "duplicate"), /positive/)
  assert.throws(() => normalizePaymentReversalInput(-25, "duplicate"), /positive/)
  assert.throws(() => normalizePaymentReversalInput(2500, "  "), /reason/)
  assert.deepEqual(normalizePaymentReversalInput(2500, " customer refund "), {
    amountCents: 2500,
    reason: "customer refund",
  })
})

test("payment reversal appends a locked ledger event and projects the remaining net paid", () => {
  const ledger = read("lib/payment-ledger.ts")
  const start = ledger.indexOf("export async function applyPaymentReversal(")
  const body = ledger.slice(start)
  assert.ok(start >= 0)
  assert.match(body, /current_paid_cents[\s\S]{0,200}FOR UPDATE/)
  assert.match(body, /current_paid_cents >= \$\{amountCents\}::bigint/)
  assert.match(body, /INSERT INTO events[\s\S]{0,300}'payment\.reversed'::text/)
  assert.match(body, /paid_amount_cents = c\.net_paid_cents/)
  assert.match(body, /paid_at = CASE[\s\S]{0,220}ELSE NULL END/)
  assert.match(body, /'amountCents', \$\{amountCents\}::bigint/)
  assert.match(body, /'reason', \$\{reason\}::text/)
  assert.match(body, /'netPaidCents', c\.net_paid_cents/)
  assert.doesNotMatch(body, /UPDATE events/, "previous receipts remain immutable")
  const sqlBody = body.match(/const rows = \(await sql`([\s\S]*?)`\) as/)?.[1] ?? ""
  assert.ok(sqlBody)
  const interpolations = sqlBody.match(/\$\{[^}]+\}/g) ?? []
  const casted = sqlBody.match(/\$\{[^}]+\}::(?:bigint|boolean|text|timestamptz|jsonb|numeric|int)/g) ?? []
  assert.equal(casted.length, interpolations.length, "each SQL interpolation has an explicit Postgres cast")
})

test("payment.reversed is hidden from crew projections", () => {
  assert.equal(eventIsOwnerOnly("payment.reversed", null), true)
})

test("the owner payment form requires a reason and exposes the reversal action", () => {
  const form = read("app/ops/leads/[id]/payment-form.tsx")
  const page = read("app/ops/leads/[id]/page.tsx")
  assert.match(form, /reversePaymentState/)
  assert.match(form, /name="reversalAmount"[^>]*required/)
  assert.match(form, /name="reason"[^>]*required/)
  assert.match(form, /Record payment reversal/)
  assert.match(page, /operator\.role === "owner" && <section className="card job-payment"/)
})
