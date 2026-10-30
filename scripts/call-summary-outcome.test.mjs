import test from "node:test"
import assert from "node:assert/strict"
import { outcomeLine } from "../lib/call-summary-outcome.ts"
import { callSummarySchema, outcomeLine as legacyOutcomeLine } from "../lib/call-summary-shared.ts"

const summary = {
  caller_name: "[INTERNAL TEST] Riverbend", need: "Repair trailer", details: [],
  where_when: null, is_job: "yes", not_job_reason: null, next_question: null,
}

test("call outcome wording and precedence survive the client formatter split", () => {
  assert.equal(outcomeLine({ ...summary, auto: "filed" }, 17), "Repeat caller. Filed to their open job.")
  assert.equal(outcomeLine({ ...summary, auto: "failed" }, 17), "Saved as a job. It is on the tracker.")
  assert.equal(outcomeLine({ ...summary, auto: "saved" }, null), "Saved as a job. It is on the tracker.")
  assert.equal(outcomeLine({ ...summary, is_job: "no", not_job_reason: "Wrong number", auto: "failed" }, null), "Wrong number. Left in calls to save.")
  assert.equal(outcomeLine({ ...summary, is_job: "no" }, null), "Left in calls to save.")
  assert.equal(outcomeLine({ ...summary, auto: "failed" }, null), "The save did not go through. It is in calls to save.")
  assert.equal(outcomeLine(summary, null), "Could not tell if it is a job. Left in calls to save.")
  assert.equal(legacyOutcomeLine, outcomeLine)
})

test("the server retains the same validation and null normalization", () => {
  assert.deepEqual(callSummarySchema.parse({ ...summary, need: null, details: null, is_job: "unexpected" }), { ...summary, need: "", details: [], is_job: "unsure" })
  assert.equal(callSummarySchema.safeParse({ ...summary, need: "x".repeat(2001) }).success, false)
})
