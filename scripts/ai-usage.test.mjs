import assert from "node:assert/strict"
import test from "node:test"
import { AI_MAX_RETRIES, buildAiUsageRun, retryAiRequest, runLoggedAiCall } from "../lib/ai-usage.mjs"

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

test("AI requests retry transient network and provider failures up to maxRetries", async () => {
  const waits = []
  let attempts = 0
  const response = await retryAiRequest(async () => {
    attempts += 1
    if (attempts === 1) throw new Error("network reset")
    if (attempts === 2) return { status: 429, ok: false }
    return { status: 200, ok: true }
  }, (result) => !result.ok && (result.status === 429 || result.status >= 500), AI_MAX_RETRIES, async (ms) => waits.push(ms))
  assert.equal(response.status, 200)
  assert.equal(attempts, 3)
  assert.deepEqual(waits, [250, 500])
})

test("AI requests do not retry a 403 response or hide a terminal network error", async () => {
  let attempts = 0
  const forbidden = await retryAiRequest(async () => {
    attempts += 1
    return { status: 403, ok: false }
  }, (response) => !response.ok && (response.status === 429 || response.status >= 500), AI_MAX_RETRIES, async () => {})
  assert.equal(forbidden.status, 403)
  assert.equal(attempts, 1)

  await assert.rejects(() => retryAiRequest(async () => {
    attempts += 1
    throw new Error("final network failure")
  }, () => false, 1, async () => {}), /final network failure/)
  assert.equal(attempts, 3)
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
