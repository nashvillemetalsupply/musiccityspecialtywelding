import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { setTimeout as sleep } from "node:timers/promises"
import { gradeAuditReply } from "./assistant-audit-bank.mjs"

export const LIVE_AUDIT_INTERVAL_MS = 12_000
export const LIVE_AUDIT_OUTPUT = "docs/assistant-audit-live-r3.json"
export const LIVE_AUDIT_SOURCE = "docs/assistant-audit-fable-r4-dry.json"
export const LIVE_AUDIT_PARAPHRASES = "scripts/fixtures/assistant-audit-paraphrases.json"

export function auditOrigin(value) {
  assert.ok(value, "Live HTTP audit requires --base-url; there is no default target")
  const target = new URL(value)
  assert.ok(["http:", "https:"].includes(target.protocol) && !target.username && !target.password
    && !target.search && !target.hash && target.pathname === "/",
  "--base-url must be an HTTP(S) origin without credentials, path, query or fragment")
  return target.origin
}

export function loadLiveAuditCases(auditPath, paraphrasePath) {
  const audit = JSON.parse(readFileSync(auditPath, "utf8"))
  const groups = JSON.parse(readFileSync(paraphrasePath, "utf8"))
  assert.ok(Array.isArray(audit.results), "Offline audit must contain results")
  const handoffs = audit.results.filter((entry) => entry.grade === "HANDOFF")
  assert.equal(handoffs.length, 82, "Expected the 82 offline-audit handoff rows")
  assert.equal(groups.length, 12, "Expected the twelve named sourced questions")
  const canonicalQuestions = new Set(groups.map((group) => group.canonicalQuestion))
  assert.equal(canonicalQuestions.size, 12, "Canonical sourced questions must be distinct")
  const cases = handoffs.map(({ id, category, question, source, expected, requiredAnswer, forbidden }) => ({
    id, category, question, source, expected, referenceAnswer: requiredAnswer,
    ...(forbidden ? { forbidden } : {}), set: "offline-handoff",
  }))
  for (const group of groups) {
    assert.equal(group.questions.length, 3, `Expected three paraphrases of ${group.canonicalQuestion}`)
    const canonical = audit.results.find((entry) => entry.expected === "answer"
      && (entry.question === group.canonicalQuestion || entry.question.startsWith(`${group.canonicalQuestion} I'm asking about `)))
    assert.ok(canonical, `Missing named sourced audit row: ${group.canonicalQuestion}`)
    for (const [index, question] of group.questions.entries()) {
      assert.ok(typeof question === "string" && question.trim(), "Paraphrase must be a customer question")
      cases.push({ id: `${canonical.id}-P${index + 1}`, category: canonical.category, question,
        canonicalQuestion: group.canonicalQuestion, source: canonical.source,
        expected: "answer", referenceAnswer: canonical.requiredAnswer, set: "sourced-paraphrase" })
    }
  }
  assert.equal(cases.length, 118)
  assert.equal(new Set(cases.map((entry) => entry.id)).size, cases.length, "Case IDs must be distinct")
  assert.equal(new Set(cases.map((entry) => entry.question)).size, cases.length, "Questions must be distinct")
  return cases
}

// The production CLI never exposes these clock/fetch dependencies as flags.
// A monotonic clock prevents wall-clock adjustments from collapsing the gap.
export async function runLiveAudit(cases, { baseUrl, fetch: send = globalThis.fetch,
  now = () => performance.now(), wait = sleep, onResult = () => {} }) {
  const origin = auditOrigin(baseUrl)
  const results = []
  let previousStart = null
  for (const entry of cases) {
    if (previousStart !== null) {
      let remaining = previousStart + LIVE_AUDIT_INTERVAL_MS - now()
      while (remaining > 0) {
        await wait(remaining)
        remaining = previousStart + LIVE_AUDIT_INTERVAL_MS - now()
      }
    }
    const input = { session_id: randomUUID(), turn_index: 0,
      message: `[INTERNAL TEST] ${entry.question}`, is_test: true }
    previousStart = now()
    let result
    try {
      const response = await send(`${origin}/api/assist`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
        redirect: "error", signal: AbortSignal.timeout(65_000),
      })
      const value = await response.json()
      // Reference text is for human comparison, not an exact-phrase test of
      // model wording. This automated grade cannot certify business facts or
      // safety refusals; the report explicitly requires transcript review.
      const grade = response.ok ? gradeAuditReply(entry, value)
        : { grade: "DEAD END", reason: `HTTP ${response.status}; no successful assistant turn` }
      if (grade.grade === "ANSWERED") grade.reason = "Nonempty reply without a handoff; factual and safety review pending"
      result = { ...entry, input, status: response.status, reply: value.reply ?? value.error ?? "",
        handoff_reason: value.handoff_reason ?? null, ...grade, review: "PENDING" }
    } catch (error) {
      result = { ...entry, input, status: null, reply: "", handoff_reason: null,
        grade: "DEAD END", reason: `Request failed: ${error.message}`, review: "PENDING" }
    }
    results.push(result)
    onResult(result)
    // No retries or further traffic after rate limiting or a broken endpoint.
    if (result.status === null || result.status === 429 || result.status >= 500) break
  }
  return results
}
