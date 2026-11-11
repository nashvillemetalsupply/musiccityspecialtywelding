import assert from "node:assert/strict"
import test from "node:test"
import { buildAuditBank, gradeAuditReply } from "./assistant-audit-bank.mjs"

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

const auditFixture = buildAuditBank({
  services: ["mobile-welding", "trailer-welding-repair", "gate-repair", "equipment-repair", "architectural-welding", "custom-fabrication", "custom-metal-products"]
    .map((slug) => ({ slug, shortTitle: slug, faqs: [], commonJobs: [], details: [] })),
  serviceAreas: ["Lebanon"],
})

test("audit accepts approved shop voice while retaining factual caveats", () => {
  const entry = auditFixture.find((row) => row.question === "Can you fabricate gas meter manifolds?")
  assert.equal(gradeAuditReply(entry, { reply: "Yes. We fabricate gas meter manifolds; we review the exact scope before accepting the work. What needs welding?" }).grade, "ANSWERED")
  assert.equal(gradeAuditReply(entry, { reply: "Yes. We fabricate gas meter manifolds. What needs welding?" }).grade, "DEAD END")
  assert.equal(gradeAuditReply(entry, { reply: contacts, handoff_reason: "unknown", handoffPersisted: true }).grade, "DEAD END")
})

test("audit requires photo guidance and travel conditions after shop-voice rewrites", () => {
  const photos = auditFixture.find((row) => row.question === "Do you need close-up and full-item photos?")
  assert.equal(gradeAuditReply(photos, { reply: "Yes. Send the full item and close-ups of the failure." }).grade, "ANSWERED")
  assert.equal(gradeAuditReply(photos, { reply: "Yes. What needs welding?" }).grade, "DEAD END")
  const area = auditFixture.find((row) => row.area === "Lebanon")
  assert.equal(gradeAuditReply(area, { reply: "Yes. We work in Lebanon; the job scope, location and schedule determine the trip." }).grade, "ANSWERED")
  assert.equal(gradeAuditReply(area, { reply: "Yes. We work in Lebanon." }).grade, "DEAD END")
})
