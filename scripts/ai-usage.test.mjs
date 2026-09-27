import assert from "node:assert/strict"
import test from "node:test"
import { AI_MAX_RETRIES, buildAiUsageRun, runLoggedAiCall } from "../lib/ai-usage.mjs"

test("AI calls use two explicit retries and preserve token usage plus test status", () => {
  assert.equal(AI_MAX_RETRIES, 2)
  assert.deepEqual(buildAiUsageRun({
    operation: "call-summary",
    provider: "deepseek",
    model: "deepseek-chat",
    ok: true,
    isTest: true,
    usage: { prompt_tokens: 90, completion_tokens: 30, total_tokens: 120 },
  }), {
    job: "ai-usage",
    ok: true,
    detail: { operation: "call-summary", provider: "deepseek", model: "deepseek-chat" },
    meta: { usage: { prompt_tokens: 90, completion_tokens: 30, total_tokens: 120 }, isTest: true },
  })
})

test("successful model results are logged and returned even if usage persistence fails", async () => {
  let logged
  const result = await runLoggedAiCall(
    { operation: "brief", model: "model-x", isTest: false },
    async () => ({ text: "Brief", totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }),
    async (run) => { logged = run; throw new Error("database unavailable") },
    () => {},
  )
  assert.deepEqual(logged.meta.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  assert.equal(result.text, "Brief")
})

test("failed provider calls log their error and still reject to the caller", async () => {
  let logged
  await assert.rejects(() => runLoggedAiCall(
    { operation: "brief", model: "model-x" },
    async () => { throw new Error("403 access denied") },
    async (run) => { logged = run },
  ), /403 access denied/)
  assert.equal(logged.ok, false)
  assert.equal(logged.detail.error, "403 access denied")
  assert.equal(logged.meta.usage, null)
})
