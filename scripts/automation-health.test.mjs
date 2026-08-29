import assert from "node:assert/strict"
import test from "node:test"
import { automationRunIsStale, gmailFreshnessWindowMs } from "../lib/automation-health.mjs"
import {
  evaluateGmailWakePolicy,
  GMAIL_WAKE_PRODUCTION_ORIGIN,
  requestOriginFromHeaders,
} from "../lib/gmail-wake-policy.mjs"

const MINUTE_MS = 60 * 1000
const PRODUCTION_WAKE_ENVIRONMENT = {
  vercel: "1",
  vercelEnv: "production",
  configuredOrigin: GMAIL_WAKE_PRODUCTION_ORIGIN,
}

test("copied production env cannot wake live Gmail from localhost", () => {
  assert.deepEqual(
    evaluateGmailWakePolicy({ ...PRODUCTION_WAKE_ENVIRONMENT, callerOrigin: "http://localhost:3000" }),
    { allowed: false, reason: "outside-production" },
  )
})

test("Gmail wake requires the exact canonical caller and configured origins", () => {
  assert.deepEqual(
    evaluateGmailWakePolicy({ ...PRODUCTION_WAKE_ENVIRONMENT, callerOrigin: GMAIL_WAKE_PRODUCTION_ORIGIN }),
    { allowed: true, reason: null },
  )
  assert.equal(evaluateGmailWakePolicy({ ...PRODUCTION_WAKE_ENVIRONMENT, callerOrigin: "https://www.musiccityspecialtywelding.com" }).allowed, false)
  assert.equal(evaluateGmailWakePolicy({ ...PRODUCTION_WAKE_ENVIRONMENT, callerOrigin: GMAIL_WAKE_PRODUCTION_ORIGIN, configuredOrigin: "https://example.com" }).allowed, false)
  assert.equal(evaluateGmailWakePolicy({ ...PRODUCTION_WAKE_ENVIRONMENT, callerOrigin: GMAIL_WAKE_PRODUCTION_ORIGIN, configuredOrigin: `${GMAIL_WAKE_PRODUCTION_ORIGIN}/unexpected` }).allowed, false)
})

test("request headers fail closed without canonical HTTPS forwarding truth", () => {
  const headers = (values) => ({ get: (name) => values[name] ?? null })
  assert.equal(requestOriginFromHeaders(headers({ host: "musiccityspecialtywelding.com", "x-forwarded-proto": "https" })), GMAIL_WAKE_PRODUCTION_ORIGIN)
  assert.equal(requestOriginFromHeaders(headers({ host: "localhost:3000", "x-forwarded-proto": "http" })), "http://localhost:3000")
  assert.equal(requestOriginFromHeaders(headers({ host: "musiccityspecialtywelding.com" })), "")
})

test("Gmail freshness follows the UTC scheduler cadence", () => {
  assert.equal(gmailFreshnessWindowMs(new Date("2026-08-24T12:00:00Z")), 60 * MINUTE_MS)
  assert.equal(gmailFreshnessWindowMs(new Date("2026-08-24T23:59:00Z")), 60 * MINUTE_MS)
  assert.equal(gmailFreshnessWindowMs(new Date("2026-08-24T00:00:00Z")), 120 * MINUTE_MS)
  assert.equal(gmailFreshnessWindowMs(new Date("2026-08-24T11:59:00Z")), 120 * MINUTE_MS)
})

test("an hourly overnight Gmail run is not falsely marked stale", () => {
  const nowMs = Date.parse("2026-08-24T09:25:00Z")
  assert.equal(
    automationRunIsStale("2026-08-24T08:59:00Z", gmailFreshnessWindowMs(new Date(nowMs)), nowMs),
    false,
  )
})

test("missing, invalid, and genuinely late Gmail runs remain stale", () => {
  const nowMs = Date.parse("2026-08-24T14:00:00Z")
  const freshnessMs = gmailFreshnessWindowMs(new Date(nowMs))
  assert.equal(automationRunIsStale(null, freshnessMs, nowMs), true)
  assert.equal(automationRunIsStale("not-a-date", freshnessMs, nowMs), true)
  assert.equal(automationRunIsStale("2026-08-24T12:59:59Z", freshnessMs, nowMs), true)
  assert.equal(automationRunIsStale("2026-08-24T13:00:00Z", freshnessMs, nowMs), false)
})
