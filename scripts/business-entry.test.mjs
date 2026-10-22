import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  mayRecordBusinessFact,
  ownerSurfaceRoleForOperator,
  recordBusinessEntry,
} from "../lib/business-entries.ts"
import { S81_BUSINESS_KEYS } from "../lib/sms-operator-commands.ts"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("one worker session records booked and paid facts with the active S81 tab tag", async () => {
  const operator = { id: 71, role: "crew" }
  const journaled = []
  const journal = async (event) => { journaled.push(event) }

  await recordBusinessEntry({ operator, business: "ld2r", verb: "booked", value: "2", externalId: "crm-00000000-0000-4000-8000-000000000001", journal })
  await recordBusinessEntry({ operator, business: "railing", verb: "paid", value: "450.25", externalId: "crm-00000000-0000-4000-8000-000000000002", journal })

  assert.equal(ownerSurfaceRoleForOperator(operator.role), "worker")
  assert.deepEqual(journaled.map(({ body, business, count, amountCents, verb }) => ({ body, business, count, amountCents, verb })), [
    { body: "booked ld2r 2", business: "ld2r", count: 2, amountCents: null, verb: "booked" },
    { body: "paid railing $450.25", business: "railing", count: null, amountCents: 45025, verb: "paid" },
  ])
  assert.ok(journaled.every((event) => event.operator.id === operator.id && event.outcome === "done"))

  // The web path is deliberately journal-only. Tests cannot reach Twilio.
  const action = read("app/board/business-actions.ts")
  assert.doesNotMatch(action, /twilio|sendSms|fetch\(/i)
})

test("business keys outside the S81 roster are refused", async () => {
  const operator = { id: 71, role: "crew" }
  assert.ok(S81_BUSINESS_KEYS.includes("ld2r"))
  await assert.rejects(recordBusinessEntry({
    operator,
    business: "outside-business",
    verb: "booked",
    value: "1",
    externalId: "crm-unknown-key",
    journal: async () => assert.fail("Rejected keys must not be journaled"),
  }), /Unknown business/)
})

test("roles outside the owner and worker bindings cannot enter booked or paid facts", async () => {
  assert.equal(mayRecordBusinessFact("bookkeeper"), false)
  assert.equal(mayRecordBusinessFact("operator"), false)
  assert.equal(mayRecordBusinessFact("manager"), false)
  assert.equal(mayRecordBusinessFact("owner"), true)
  assert.equal(mayRecordBusinessFact("worker"), true)
  assert.equal(ownerSurfaceRoleForOperator("owner"), "owner")
  assert.equal(ownerSurfaceRoleForOperator("crew"), "worker")
  assert.equal(ownerSurfaceRoleForOperator("bookkeeper"), null)
  await assert.rejects(recordBusinessEntry({
    operator: { id: 99, role: "bookkeeper" },
    business: "ld2r",
    verb: "paid",
    value: "20",
    externalId: "crm-forbidden-role",
    journal: async () => assert.fail("Unbound roles must not be journaled"),
  }), /not bound/)
})
