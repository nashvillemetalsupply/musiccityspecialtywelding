import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { paymentRollup } from "../lib/payments.mjs"

const ACTIONS_SOURCE = readFileSync("app/ops/actions.ts", "utf8").replace(/\r\n/g, "\n")
const LEDGER_SOURCE = readFileSync("lib/payment-ledger.ts", "utf8").replace(/\r\n/g, "\n")
const GMAIL_SOURCE = readFileSync("app/api/ingest/gmail/route.ts", "utf8").replace(/\r\n/g, "\n")
const WIRE_SOURCE = readFileSync("app/api/ops/wire/action/route.ts", "utf8").replace(/\r\n/g, "\n")

function exportedFunction(source, name) {
  const start = source.indexOf(`export async function ${name}`)
  assert.ok(start >= 0, `${name} exists`)
  const next = source.indexOf("\nexport async function ", start + 1)
  return source.slice(start, next < 0 ? undefined : next)
}

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

test("the action is owner-gated and requires a stable receipt key", () => {
  const action = exportedFunction(ACTIONS_SOURCE, "recordPayment")
  assert.match(action.slice(0, 500), /requireOwner\(operator\)/)
  assert.match(action, /const receiptKey = String\(formData\.get\("receiptKey"\) \?\? ""\)\.trim\(\)/)
  assert.match(action, /\^\[a-zA-Z0-9_-\]\{12,80\}\$/)
  assert.match(action, /const externalId = `manual-payment:\$\{receiptKey\}`/)
})

test("receipt and paid projection are one atomic locked statement", () => {
  const action = exportedFunction(ACTIONS_SOURCE, "recordPayment")
  assert.equal((action.match(/await sql`/g) ?? []).length, 1, "one database statement owns the transition")
  assert.match(action, /WITH target AS MATERIALIZED \([\s\S]*WHERE id = \$\{leadId\}::bigint[\s\S]*FOR UPDATE/)
  assert.match(action, /event_write AS \([\s\S]*INSERT INTO events/)
  assert.match(action, /projection_write AS \([\s\S]*UPDATE leads/)
  assert.ok(action.indexOf("INSERT INTO events") < action.indexOf("UPDATE leads"))
  assert.doesNotMatch(action, /recordEvent\(/, "a separate event statement would reopen the crash gap")
  assert.match(action, /SELECT 'invoice\.payment-received'::text,/)
  assert.doesNotMatch(action, /CASE WHEN c\.fully_paid THEN 'invoice\.paid'/, "one receipt key must have one stable event kind")
})

test("a repeated receipt repairs from immutable absolute receipt truth", () => {
  const action = exportedFunction(ACTIONS_SOURCE, "recordPayment")
  assert.match(action, /existing_key AS MATERIALIZED \([\s\S]*e\.external_id = \$\{externalId\}::text/)
  assert.match(action, /receipt_scope AS MATERIALIZED \([\s\S]*e\.detail->>'paidTotalCents'/)
  assert.match(action, /lower\(COALESCE\(e\.detail->>'manual', 'false'\)\) = 'true'/)
  assert.match(action, /paid_amount_cents = GREATEST\(COALESCE\(l\.paid_amount_cents, 0::bigint\), r\.paid_total_cents\)/)
  assert.match(action, /ON CONFLICT \(kind, external_id\) WHERE external_id <> '' DO NOTHING/)
  assert.doesNotMatch(action, /UPDATE events/, "the immutable receipt is never rewritten")
  assert.match(action, /key_lead_id/)
  assert.match(action, /if \(result\[0\]\.key_lead_id === null\)/, "a simultaneous duplicate is a successful replay")
})

test("distinct payments serialize and payment cannot complete or hand off work", () => {
  const action = exportedFunction(ACTIONS_SOURCE, "recordPayment")
  assert.ok(action.indexOf("FOR UPDATE") < action.indexOf("paid_amount_cents + ${amountCents}::bigint"))
  assert.match(action, /'amountCents', \$\{amountCents\}::bigint/)
  assert.match(action, /'paidTotalCents', c\.paid_total_cents/)
  for (const lifecycleField of ["completed_at", "handed_off_at", "won_at", "status ="]) {
    assert.ok(!action.includes(lifecycleField), `payment must not write ${lifecycleField}`)
  }
})

test("every payment SQL interpolation has an explicit Postgres cast", () => {
  const action = exportedFunction(ACTIONS_SOURCE, "recordPayment")
  const sqlBody = action.match(/const result = \(await sql`([\s\S]*?)`\) as/)?.[1] ?? ""
  assert.ok(sqlBody, "payment CTE exists")
  const all = sqlBody.match(/\$\{[^}]+\}/g) ?? []
  const casted = sqlBody.match(/\$\{[^}]+\}::(?:bigint|boolean|text|timestamptz|jsonb|numeric|int|real)/g) ?? []
  assert.equal(casted.length, all.length, `uncast interpolation in payment SQL: ${all.join(", ")}`)
})

test("manual payment receipts preserve internal-test truth", () => {
  const action = exportedFunction(ACTIONS_SOURCE, "recordPayment")
  assert.match(action, /SELECT id, person_id, is_test/)
  assert.match(action, /CASE WHEN c\.is_test THEN '\[INTERNAL TEST\] '/)
  assert.match(action, /'isTest', c\.is_test/)
})

test("QuickBooks and manual receipts add through the same locked balance", () => {
  assert.match(LEDGER_SOURCE, /export async function applyQuickBooksPayment/)
  assert.match(LEDGER_SOURCE, /COALESCE\(paid_amount_cents, 0::bigint\) AS current_paid_cents[\s\S]*FOR UPDATE/)
  assert.match(LEDGER_SOURCE, /t\.current_paid_cents \+ \$\{amountCents\}::bigint AS paid_total_cents/)
  assert.match(LEDGER_SOURCE, /receipt_write AS \([\s\S]*INSERT INTO events/)
  assert.match(LEDGER_SOURCE, /projection_write AS \([\s\S]*UPDATE leads/)
  assert.ok(LEDGER_SOURCE.indexOf("receipt_write AS") < LEDGER_SOURCE.indexOf("projection_write AS"))
  assert.match(LEDGER_SOURCE, /paid_amount_cents = GREATEST\(COALESCE\(l\.paid_amount_cents, 0::bigint\), r\.paid_total_cents\)/)
})

test("QuickBooks receipt replay is immutable and cannot add the same payment twice", () => {
  assert.match(LEDGER_SOURCE, /existing_receipt AS MATERIALIZED/)
  assert.match(LEDGER_SOURCE, /e\.detail->>'sourceEventId' = \$\{String\(input\.sourceEventId\)\}::text/)
  assert.match(LEDGER_SOURCE, /quickbooks-payment:\$\{input\.sourceEventId\}/)
  assert.match(LEDGER_SOURCE, /WHERE NOT EXISTS \(SELECT 1 FROM existing_receipt\)/)
  assert.match(LEDGER_SOURCE, /NOT EXISTS \(SELECT 1 FROM existing_receipt e WHERE e\.kind = 'invoice\.paid'\)/)
  assert.match(LEDGER_SOURCE, /ON CONFLICT \(kind, external_id\) WHERE external_id <> '' DO NOTHING/)
  assert.doesNotMatch(LEDGER_SOURCE, /UPDATE events/)
})

test("both automatic and manually attached QuickBooks receipts use the shared ledger", () => {
  assert.match(GMAIL_SOURCE, /await applyQuickBooksPayment\(\{/)
  assert.match(WIRE_SOURCE, /await applyQuickBooksPayment\(\{/)
  assert.doesNotMatch(GMAIL_SOURCE, /FROM events\s+WHERE kind = 'email\.payment' AND lead_id/)
  assert.doesNotMatch(WIRE_SOURCE, /FROM events WHERE kind = 'email\.payment' AND lead_id/)
  assert.match(GMAIL_SOURCE, /duplicate: !inserted \|\| payment\.duplicate/)
  assert.match(WIRE_SOURCE, /status_source_event_id = \$\{payment\.paidEventId \?\? payment\.receiptEventId\}::bigint/)
})

test("QuickBooks payment receipts preserve internal-test truth", () => {
  assert.match(LEDGER_SOURCE, /const body = `\$\{input\.isTest \? "\[INTERNAL TEST\] " : ""\}/)
  assert.match(LEDGER_SOURCE, /WHERE id = \$\{input\.leadId\}::bigint AND is_test = \$\{input\.isTest\}::boolean/)
  assert.equal((LEDGER_SOURCE.match(/'isTest', (?:c|t)\.is_test/g) ?? []).length, 2)
})

test("the job offers field collection without putting card data in Shop Brain", () => {
  const page = readFileSync(new URL("../app/ops/leads/[id]/page.tsx", import.meta.url), "utf8")
  assert.match(page, /id="onsite-payment"/)
  assert.match(page, /QuickBooks GoPayment/)
  assert.match(page, /Take payments only/)
  assert.match(page, /No card number enters Shop Brain/)
  assert.match(page, /Mark remaining balance paid in full/)
  assert.doesNotMatch(page, /!lead\.invoice_total_cents && <label className="job-check job-payment-settles"/)
})
