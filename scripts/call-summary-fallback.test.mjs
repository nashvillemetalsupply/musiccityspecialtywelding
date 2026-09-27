import assert from "node:assert/strict"
import test from "node:test"
import { applyOnlyValidatedSummary, readWithSchemaFallback } from "../lib/call-summary-fallback.mjs"

function parseSummary(value) {
  if (!value || typeof value !== "object" || typeof value.caller_name !== "string" || typeof value.need !== "string") {
    throw new Error("Invalid call summary shape")
  }
  return value
}

test("a malformed fallback fails validation before summary persistence or job creation", async () => {
  let saved = 0
  let jobsCreated = 0
  const read = () => readWithSchemaFallback({
    primary: async () => { throw new Error("gateway unavailable") },
    fallback: async () => ({ need: "Build a steel bracket", is_job: "yes" }),
    fallbackConfigured: true,
    parse: parseSummary,
  })
  await assert.rejects(() => applyOnlyValidatedSummary(read, async () => {
    saved += 1
    jobsCreated += 1
  }), /Invalid call summary shape/)
  assert.equal(saved, 0)
  assert.equal(jobsCreated, 0)
})

test("a valid fallback is parsed before the summary side effect runs", async () => {
  const order = []
  const summary = await applyOnlyValidatedSummary(
    () => readWithSchemaFallback({
      primary: async () => { throw new Error("gateway unavailable") },
      fallback: async () => ({ caller_name: "Casey", need: "Build a steel bracket" }),
      fallbackConfigured: true,
      parse: parseSummary,
    }),
    async (value) => { order.push(value.caller_name) },
  )
  assert.deepEqual(order, ["Casey"])
  assert.equal(summary.need, "Build a steel bracket")
})
