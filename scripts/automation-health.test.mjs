import assert from "node:assert/strict"
import test from "node:test"
import { automationRunIsStale, gmailFreshnessWindowMs } from "../lib/automation-health.mjs"

const MINUTE_MS = 60 * 1000

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
