import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  addRoofJob,
  listRoofJobs,
  markRoofJobPaid,
  parseAmountCents,
  recordSmsCountRoofJobs,
  ROOF_JOB_BUSINESSES,
  roofJobRowsForSmsCount,
  validateRoofJobInput,
} from "../lib/roof-jobs.ts"
import { parseOperatorCommand } from "../lib/sms-operator-commands.ts"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const owner = { id: 1, role: "owner" }
const crew = { id: 71, role: "crew" }
const REQUEST = "00000000-0000-4000-8000-000000000001"

// Records every query; `answer` decides what each call returns.
function fakeSql(answer = () => []) {
  const calls = []
  const sql = async (strings, ...values) => {
    const call = { text: strings.join("?"), values }
    calls.push(call)
    return answer(call)
  }
  return { sql, calls }
}

test("O1: roof_jobs takes LD2R, Railing and BuilderBox only; Grease Patrol and unknown keys are refused", async () => {
  assert.deepEqual(ROOF_JOB_BUSINESSES, ["ld2r", "railing", "builderbox"])
  assert.throws(() => validateRoofJobInput({ business: "grease-patrol" }), /Grease Patrol ops board/)
  assert.throws(() => validateRoofJobInput({ business: "welding" }), /Unknown business/)
  assert.throws(() => validateRoofJobInput({ business: "outside-business" }), /Unknown business/)
  const { sql, calls } = fakeSql()
  await assert.rejects(addRoofJob({ operator: owner, fields: { business: "grease-patrol" }, requestId: REQUEST, sql }), /Grease Patrol/)
  await assert.rejects(listRoofJobs({ business: "grease-patrol", operator: owner, sql }), /Grease Patrol/)
  await assert.rejects(recordSmsCountRoofJobs({ operator: owner, business: "grease-patrol", rows: [], sql }), /Grease Patrol/)
  assert.equal(calls.length, 0)
  assert.deepEqual(roofJobRowsForSmsCount({ business: "grease-patrol", verb: "booked", count: 2, amountCents: null, sid: "SM1" }), [])

  // The DB CHECK spells out the same list (migrate.mjs runs without TypeScript).
  const check = /business TEXT NOT NULL CHECK \(business IN \(([^)]*)\)\)/.exec(read("scripts/migrate.mjs"))
  assert.deepEqual(check[1].split(",").map((key) => key.trim().replace(/'/g, "")), ROOF_JOB_BUSINESSES)
  assert.match(read("scripts/migrate.mjs"), /\{ name: "roof-jobs-o1-2026-10-23", query: roofJobsStatement \}/)
})

test("O1: the add form validates fields server side and writes one idempotent booked row", async () => {
  assert.equal(parseAmountCents(""), null)
  assert.equal(parseAmountCents("450"), 45000)
  assert.equal(parseAmountCents("$1,250.50"), 125050)
  assert.throws(() => parseAmountCents("abc"), /dollars/)
  assert.throws(() => parseAmountCents("2000000"), /too big/)
  assert.throws(() => parseAmountCents("0"), /dollars/)
  assert.throws(() => parseAmountCents("$0.00"), /dollars/)
  assert.throws(() => validateRoofJobInput({ business: "ld2r", jobDate: "2026-02-30" }), /calendar date/)
  assert.throws(() => validateRoofJobInput({ business: "ld2r", phone: "call me" }), /Phone/)
  assert.throws(() => validateRoofJobInput({ business: "ld2r", note: "x".repeat(501) }), /too long/)

  const { sql, calls } = fakeSql()
  await addRoofJob({ operator: crew, fields: { business: "railing", customerName: " Ann  Lee ", phone: "615-555-0100", jobDate: "2026-10-24", amount: "", note: "" }, requestId: REQUEST, isTest: true, sql })
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /ON CONFLICT \(external_id\) DO NOTHING/)
  assert.deepEqual(calls[0].values, ["railing", "Ann Lee", "615-555-0100", "2026-10-24", null, "", 71, `crm-${REQUEST}`, false])
  await assert.rejects(addRoofJob({ operator: owner, fields: { business: "ld2r" }, requestId: "not-a-uuid", sql }), /Refresh/)
  await assert.rejects(addRoofJob({ operator: { id: 9, role: "bookkeeper" }, fields: { business: "ld2r" }, requestId: REQUEST, sql }), /not bound/)
  await addRoofJob({ operator: owner, fields: { business: "ld2r" }, requestId: REQUEST, isTest: true, sql })
  assert.equal(calls.at(-1).values.at(-1), true, "owner test entry keeps is_test")
})

test("O1: SMS 'booked ld2r 2' becomes two booked rows and 'paid ld2r $450' one paid row", async () => {
  const booked = parseOperatorCommand("booked ld2r 2")
  assert.equal(booked.ref.kind, "business")
  const bookedRows = roofJobRowsForSmsCount({ business: booked.ref.business, verb: booked.verb, count: booked.ref.count, amountCents: booked.amountCents, sid: "SMabc" })
  assert.deepEqual(bookedRows, [
    { status: "booked", amountCents: null, externalId: "sms-SMabc-1" },
    { status: "booked", amountCents: null, externalId: "sms-SMabc-2" },
  ])

  const paid = parseOperatorCommand("paid ld2r $450")
  const paidRows = roofJobRowsForSmsCount({ business: paid.ref.business, verb: paid.verb, count: paid.ref.count, amountCents: paid.amountCents, sid: "SMdef" })
  assert.deepEqual(paidRows, [{ status: "paid", amountCents: 45000, externalId: "sms-SMdef-paid" }])

  const { sql, calls } = fakeSql()
  assert.equal(await recordSmsCountRoofJobs({ operator: crew, business: "ld2r", rows: bookedRows, sql }), 2)
  assert.deepEqual(calls[0].values, ["ld2r", "sms count", 71, ["booked", "booked"], [null, null], ["sms-SMabc-1", "sms-SMabc-2"]])
  assert.match(calls[0].text, /ON CONFLICT \(external_id\) DO NOTHING/)
  assert.match(calls[0].text, /CASE WHEN r\.status = 'paid' THEN now\(\) END/)

  // The handler writes rows only for roof-job businesses and keeps the audit event.
  const handler = read("lib/sms-operator-in.ts")
  const branch = handler.slice(handler.indexOf('parsed.ref.kind === "business"'))
  assert.ok(branch.indexOf("isRoofJobBusiness(business)") < branch.indexOf("recordSmsCountRoofJobs("))
  assert.ok(branch.indexOf("recordSmsCountRoofJobs(") < branch.indexOf("return finish(businessReply("))
})

test("O1: owner lists every row; crew lists only rows they created", async () => {
  const { sql, calls } = fakeSql()
  await listRoofJobs({ business: "ld2r", operator: crew, sql })
  await listRoofJobs({ business: "ld2r", operator: owner, sql })
  assert.match(calls[0].text, /ORDER BY created_at DESC, id DESC/)
  assert.match(calls[0].text, /AND \(\?::boolean OR \(created_by = \?::bigint AND is_test = false\)\)/)
  assert.deepEqual(calls[0].values.slice(0, 3), ["ld2r", false, 71])
  assert.deepEqual(calls[1].values.slice(0, 3), ["ld2r", true, 1])

  // Same predicate in a tiny in-memory run: crew 71 sees only its own real rows.
  const rows = [
    { id: 1, created_by: 71, is_test: false },
    { id: 2, created_by: 1, is_test: false },
    { id: 3, created_by: 71, is_test: true },
  ]
  const visible = (op) => rows.filter((row) => op.role === "owner" || (row.created_by === op.id && !row.is_test)).map((row) => row.id)
  assert.deepEqual(visible(crew), [1])
  assert.deepEqual(visible(owner), [1, 2, 3])
})

test("O1: mark paid moves booked to paid, stays in its business, keeps a booked amount, and is a no-op twice", async () => {
  const booked = fakeSql((call) => call.text.includes("SELECT") ? [{ status: "booked", amount_cents: null }] : [])
  await assert.rejects(markRoofJobPaid({ operator: crew, business: "ld2r", id: 5, amount: "", sql: booked.sql }), /Enter the amount/)
  assert.equal(booked.calls.filter((call) => call.text.includes("UPDATE")).length, 0)
  assert.deepEqual(await markRoofJobPaid({ operator: crew, business: "ld2r", id: 5, amount: "450", sql: booked.sql }), { alreadyPaid: false })
  const update = booked.calls.find((call) => call.text.includes("UPDATE"))
  assert.match(update.text, /SET status = 'paid', paid_at = now\(\)/)
  assert.match(update.text, /WHERE id = \?::bigint AND business = \?::text AND status = 'booked'/)
  assert.match(update.text, /amount_cents = COALESCE\(amount_cents, \?::bigint\)/)
  assert.deepEqual(update.values, [45000, 5, "ld2r", false, 71])
  assert.match(booked.calls[0].text, /WHERE id = \?::bigint AND business = \?::text/)

  const priced = fakeSql((call) => call.text.includes("SELECT") ? [{ status: "booked", amount_cents: "30000" }] : [])
  await markRoofJobPaid({ operator: owner, business: "ld2r", id: 6, amount: "", sql: priced.sql })
  assert.equal(priced.calls.find((call) => call.text.includes("UPDATE")).values[0], null, "keeps the booked amount")
  const repriced = fakeSql((call) => call.text.includes("SELECT") ? [{ status: "booked", amount_cents: "30000" }] : [])
  await assert.rejects(markRoofJobPaid({ operator: crew, business: "ld2r", id: 6, amount: "1", sql: repriced.sql }), /already has an amount/)
  assert.equal(repriced.calls.filter((call) => call.text.includes("UPDATE")).length, 0)
  await assert.rejects(markRoofJobPaid({ operator: owner, business: "grease-patrol", id: 6, amount: "", sql: repriced.sql }), /Grease Patrol/)

  const paid = fakeSql(() => [{ status: "paid", amount_cents: "45000" }])
  assert.deepEqual(await markRoofJobPaid({ operator: owner, business: "ld2r", id: 7, amount: "", sql: paid.sql }), { alreadyPaid: true })
  assert.equal(paid.calls.length, 1)

  const missing = fakeSql(() => [])
  await assert.rejects(markRoofJobPaid({ operator: crew, business: "ld2r", id: 8, amount: "10", sql: missing.sql }), /not found/)
  await assert.rejects(markRoofJobPaid({ operator: crew, business: "ld2r", id: 0, amount: "10", sql: missing.sql }), /not found/)
})
