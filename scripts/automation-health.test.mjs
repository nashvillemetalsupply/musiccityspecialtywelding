import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { automationRunIsStale, gmailFreshnessWindowMs } from "../lib/automation-health.ts"
import {
  evaluateGmailWakePolicy,
  GMAIL_WAKE_PRODUCTION_ORIGIN,
  requestOriginFromHeaders,
} from "../lib/gmail-wake-policy.ts"

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const HEALTH = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8")

// Run the route's real reminder checks and warning projection without loading
// provider clients or connecting to the shared database.
function reminderHealthAt(lastReminderAt, nowMs, lastReminderOk = true) {
  const checks = HEALTH.match(/  const (?:centralHour|reminderStale|reminderDead|reminderHealthy) = [^\r\n]+/g).join("\n")
  const warnings = HEALTH.match(/  const warnings = \[[\s\S]*?\]\.filter\(\(warning\) => warning !== null\)/)[0]
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowMs])) }
    static now() { return nowMs }
  }
  const result = runInNewContext(`${checks}\n${warnings}\n;({ reminderStale, reminderDead, reminderHealthy, warnings })`, {
    Date: FixedDate,
    database: { lastReminderAt, lastReminderOk },
    gmailConfigured: () => false,
    gmailStale: false,
  })
  return JSON.parse(JSON.stringify(result))
}

test("reminders warn only after 3h and stay healthy through throttled runs", () => {
  const nowMs = Date.parse("2026-11-08T18:00:00Z")
  const atBoundary = reminderHealthAt(new Date(nowMs - 3 * HOUR_MS).toISOString(), nowMs)
  assert.deepEqual(atBoundary, { reminderStale: false, reminderDead: false, reminderHealthy: true, warnings: [] })
  for (const ageMs of [3 * HOUR_MS + 1, 7 * HOUR_MS, 26 * HOUR_MS]) {
    const lastAt = new Date(nowMs - ageMs).toISOString()
    assert.deepEqual(reminderHealthAt(lastAt, nowMs), {
      reminderStale: true, reminderDead: false, reminderHealthy: true,
      warnings: [{ kind: "reminder-stale", lastAt }],
    })
  }
})

test("reminders older than 26h block readiness and retain the stale warning", () => {
  const nowMs = Date.parse("2026-11-08T18:00:00Z")
  const lastAt = new Date(nowMs - 26 * HOUR_MS - 1).toISOString()
  assert.deepEqual(reminderHealthAt(lastAt, nowMs), {
    reminderStale: true, reminderDead: true, reminderHealthy: false,
    warnings: [{ kind: "reminder-stale", lastAt }],
  })
})

test("missing reminders keep the existing 2 AM Central readiness boundary", () => {
  assert.deepEqual(reminderHealthAt(null, Date.parse("2026-11-08T07:59:59Z"), null), {
    reminderStale: false, reminderDead: false, reminderHealthy: true, warnings: [],
  })
  assert.deepEqual(reminderHealthAt(null, Date.parse("2026-11-08T08:00:00Z"), null), {
    reminderStale: true, reminderDead: true, reminderHealthy: false,
    warnings: [{ kind: "reminder-stale", lastAt: null }],
  })
})

test("a failed reminder run still blocks readiness even while fresh", () => {
  const nowMs = Date.parse("2026-11-08T18:00:00Z")
  assert.equal(reminderHealthAt(new Date(nowMs - HOUR_MS).toISOString(), nowMs, false).reminderHealthy, false)
})

test("health exposes both reminder ages and readiness uses reminder health", () => {
  assert.match(HEALTH, /reminderStale,\s+reminderDead,/)
  assert.match(HEALTH, /reminderHealthy &&/)
  assert.doesNotMatch(HEALTH, /!reminderStale &&/)
})

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
