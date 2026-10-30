import assert from "node:assert/strict"
import test from "node:test"
import { draftAfterReplyDelivery } from "../app/ops/leads/[id]/reply-draft.ts"

test("successful delivery consumes exactly the submitted draft", () => {
  assert.equal(draftAfterReplyDelivery("On my way.", "On my way."), "")
})

test("a later edit or in-flight voice completion survives an earlier send", () => {
  const sent = "On my way."
  assert.equal(draftAfterReplyDelivery("Bring the trailer.", sent), "Bring the trailer.")
  assert.equal(draftAfterReplyDelivery(`${sent} The hinge is ready.`, sent), `${sent} The hinge is ready.`)
})

test("an unsent or cleared draft is never reconstructed by delivery", () => {
  assert.equal(draftAfterReplyDelivery("New note", null), "New note")
  assert.equal(draftAfterReplyDelivery("", "Earlier note"), "")
})
