import assert from "node:assert/strict"
import test from "node:test"
import { gradeAuditReply } from "./assistant-audit-bank.mjs"

const contacts = "[Call](tel:+16157033296). [Quote form](/#contact). [Email](mailto:Sales@musiccityspecialtywelding.com)."
const unknown = { expected: "handoff" }

test("audit rejects a phone-only unknown answer even with handoff metadata", () => {
  assert.equal(gradeAuditReply(unknown, { reply: "[Call](tel:+16157033296)", handoff_reason: "unknown", handoffPersisted: true }).grade, "DEAD END")
})

test("audit requires routing metadata and a durable request, not links alone", () => {
  assert.equal(gradeAuditReply(unknown, { reply: contacts }).grade, "DEAD END")
  assert.equal(gradeAuditReply(unknown, { reply: contacts, handoff_reason: "unknown", handoffPersisted: false }).grade, "DEAD END")
  assert.equal(gradeAuditReply(unknown, { reply: contacts, handoff_reason: "unknown", handoffPersisted: true }).grade, "HANDOFF")
})

test("audit cannot hide an unsupported assertion behind contact links", () => {
  const entry = { ...unknown, forbidden: ["fully insured"] }
  assert.equal(gradeAuditReply(entry, { reply: `We are fully insured. ${contacts}`, handoff_reason: "unknown", handoffPersisted: true }).grade, "WRONG")
})

test("audit requires the case-specific sourced answer, not an unrelated intake prompt", () => {
  const entry = { expected: "answer-or-handoff", requiredAnswer: "We repair steel gate frames." }
  assert.equal(gradeAuditReply(entry, { reply: "What name should the shop use?" }).grade, "DEAD END")
  assert.equal(gradeAuditReply(entry, { reply: "We repair steel gate frames. What is damaged?" }).grade, "ANSWERED")
})

test("audit catches a numeric price even when a model omits handoff metadata", () => {
  assert.equal(gradeAuditReply(unknown, { reply: "That is $200." }).grade, "WRONG")
})

test("audit requires an answer for Fable's sourced cases even when a handoff is complete", () => {
  assert.equal(gradeAuditReply({ expected: "answer" }, { reply: contacts, handoff_reason: "unknown", handoffPersisted: true }).grade, "DEAD END")
})

test("audit requires email as well as phone and form for unknown facts", () => {
  assert.equal(gradeAuditReply(unknown, { reply: "[Call](tel:+16157033296). [Quote form](/#contact).", handoff_reason: "unknown", handoffPersisted: true }).grade, "DEAD END")
})
