import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  classifyAlertFailure,
  permanentTwilioRecipientError,
  splitHealthDeliveryErrors,
  summarizeDeadNotifications,
  twilioErrorCodeFrom,
} from "../lib/alert-failure-classifier.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const now = Date.parse("2026-10-08T18:00:00Z")

const NO_CHANNEL = "No configured alert channel accepted this retry."
const deadRow = (overrides) => ({
  id: 1,
  operator_id: 1,
  created_at: "2026-10-08T12:00:00Z",
  title: "Missed call",
  error: NO_CHANNEL,
  source: "",
  provider_error_code: "",
  sibling_delivered: false,
  ...overrides,
})

test("a no-channel copy is covered when another owner's copy of the same alert was delivered", () => {
  assert.equal(classifyAlertFailure(deadRow({ sibling_delivered: true })).blocking, false)
  assert.equal(classifyAlertFailure(deadRow({ sibling_delivered: true })).reason, "covered-by-sibling")
  for (const error of [
    "No registered push, email, or SMS fallback channel accepted the alert.",
    "Operator 82 has no cell_phone on file.",
    "The coalesced alert could not reach a registered push channel",
    "The coalesced alert could not reach a registered push, email, or SMS channel.",
  ]) {
    assert.equal(classifyAlertFailure(deadRow({ error, sibling_delivered: true })).blocking, false, error)
  }
})

test("a total non-delivery still counts: nobody got the alert", () => {
  const row = deadRow({ sibling_delivered: false })
  assert.equal(classifyAlertFailure(row).blocking, true)
  assert.equal(classifyAlertFailure(row).reason, "undelivered")
})

test("a real provider failure on a reachable channel still counts even when a sibling was delivered", () => {
  const row = deadRow({ error: "Twilio reported that the operator alert was not delivered (error 30008: Unknown error).", sibling_delivered: true })
  assert.equal(classifyAlertFailure(row).blocking, true)
})

test("Twilio 21610, 21614 and the 21211 class are permanent and say what the owner must do", () => {
  const optOut = permanentTwilioRecipientError("21610")
  assert.equal(optOut.reason, "opted-out")
  assert.match(optOut.message, /opted out/i)
  assert.match(optOut.message, /START/)
  assert.match(optOut.message, /Twilio 21610/)
  assert.match(optOut.message, /not retried/i)
  assert.equal(permanentTwilioRecipientError(21614).reason, "not-mobile")
  for (const code of ["21211", "21217", "21401", "21421"]) {
    assert.equal(permanentTwilioRecipientError(code).reason, "invalid-number", code)
  }
  for (const code of ["", "20429", "30008", "30003", null, undefined]) {
    assert.equal(permanentTwilioRecipientError(code), null, String(code))
  }
  assert.doesNotMatch(optOut.message, /\+?1?\d{10}/, "never carries a phone number")
})

test("Twilio error codes are read from the provider payload code or from stored error text", () => {
  assert.equal(twilioErrorCodeFrom({ code: 21610, message: "Attempt to send to unsubscribed recipient" }), "21610")
  assert.equal(twilioErrorCodeFrom("Twilio reported that the operator alert was not delivered (error 21610: Unsubscribed)."), "21610")
  assert.equal(twilioErrorCodeFrom("Twilio send failed: Attempt to send to unsubscribed recipient"), "21610")
  assert.equal(twilioErrorCodeFrom("The operator's cell opted out of texts (Twilio 21610)."), "21610")
  assert.equal(twilioErrorCodeFrom("No configured alert channel accepted this retry."), "")
  assert.equal(twilioErrorCodeFrom(null), "")
})

test("an opted-out copy is covered when a sibling was delivered and names the operator, never the number", () => {
  const row = deadRow({
    operator_id: 35,
    error: "Twilio reported that the operator alert was not delivered (error 21610: Unsubscribed recipient).",
    sibling_delivered: true,
  })
  const verdict = classifyAlertFailure(row)
  assert.equal(verdict.blocking, false)
  assert.equal(verdict.permanent.reason, "opted-out")
  const summary = summarizeDeadNotifications([row, deadRow({ id: 2, operator_id: 35, error: "", provider_error_code: "21610", sibling_delivered: false })])
  assert.deepEqual(summary.optedOutOperatorIds, [35])
  assert.deepEqual(summary.permanentSmsRecipients, [{ operatorId: 35, twilioCode: "21610", reason: "opted-out" }])
  assert.equal(summary.counted, 1, "nobody reached on the second alert, so it still counts")
  assert.equal(summary.coveredBySibling, 1)
})

test("the health monitor's own failed alert is diagnostic only", () => {
  const rows = [
    deadRow({ id: 10, source: "health-monitor", error: "Twilio send failed: Attempt to send to unsubscribed recipient", sibling_delivered: false }),
    deadRow({ id: 11, source: "health-monitor", error: NO_CHANNEL, created_at: "2026-10-08T13:00:00Z" }),
  ]
  for (const row of rows) {
    const verdict = classifyAlertFailure(row)
    assert.equal(verdict.blocking, false)
    assert.equal(verdict.reason, "health-monitor-alert")
  }
  const summary = summarizeDeadNotifications(rows)
  assert.equal(summary.counted, 0)
  assert.equal(summary.healthMonitorAlert.count, 2)
  assert.equal(summary.healthMonitorAlert.lastError, NO_CHANNEL)
  assert.equal(summary.healthMonitorAlert.lastAt, "2026-10-08T13:00:00.000Z")
})

test("production's dead backlog shape: covered copies and monitor alerts stop pinning the count", () => {
  const rows = [
    ...Array.from({ length: 140 }, (_, i) => deadRow({ id: 100 + i, operator_id: 1, sibling_delivered: true })),
    ...Array.from({ length: 10 }, (_, i) => deadRow({ id: 300 + i, operator_id: 82, error: "Operator 82 has no cell_phone on file.", sibling_delivered: true })),
    deadRow({ id: 400, operator_id: 1, sibling_delivered: false }),
  ]
  const summary = summarizeDeadNotifications(rows)
  assert.equal(summary.counted, 1)
  assert.equal(summary.coveredBySibling, 150)
})

test("recent delivery errors split into health-blocking and diagnostic-only", () => {
  const rows = [
    { occurred_at: "2026-10-08T17:00:00Z", title: "Health monitor failed", error: "Twilio send failed: x", is_test: false, source: "health-monitor", provider_error_code: "", sibling_delivered: false, operator_id: 1 },
    { occurred_at: "2026-10-08T16:00:00Z", title: "Missed call", error: NO_CHANNEL, is_test: false, source: "", provider_error_code: "", sibling_delivered: true, operator_id: 1 },
    { occurred_at: "2026-10-08T15:00:00Z", title: "Missed call", error: NO_CHANNEL, is_test: false, source: "", provider_error_code: "", sibling_delivered: false, operator_id: 1 },
    { occurred_at: "2026-10-08T14:00:00Z", title: "[INTERNAL TEST] probe", error: "x", is_test: true, source: "", provider_error_code: "", sibling_delivered: false, operator_id: 1 },
  ]
  const split = splitHealthDeliveryErrors(rows, now)
  assert.deepEqual(split.blocking, [{ at: "2026-10-08T15:00:00.000Z", title: "Missed call", error: NO_CHANNEL }])
  assert.deepEqual(split.diagnostic.map((item) => item.reason), ["health-monitor-alert", "covered-by-sibling"])
  assert.equal(split.diagnostic.some((item) => /INTERNAL TEST/.test(item.title)), false)
})

test("health wires the classifier into ok, durableFailures and recentErrors", () => {
  const health = source("app/api/health/route.ts")
  const query = source("lib/delivery-errors.ts")
  assert.match(query, /export async function listDeadNotificationRows\(/)
  assert.match(query, /export async function listHealthDeliveryErrors\(/)
  assert.match(query, /AS sibling_delivered/)
  assert.match(query, /sibling\.dedupe_key = n\.dedupe_key/)
  assert.match(query, /n\.dedupe_key <> ''/)
  assert.match(query, /sibling\.operator_id IS DISTINCT FROM n\.operator_id/)
  assert.match(query, /sibling\.delivery_status = ANY\(ARRAY\['accepted','delivered'\]::text\[\]\)/)
  assert.match(query, /n\.action_detail->>'source', ''\) AS source/)
  assert.match(query, /->-1->'payload'->>'code', ''\) AS provider_error_code/)
  assert.match(query, /n\.delivery_status = 'dead' AND n\.read_at IS NULL[\s\S]*?ORDER BY n\.created_at DESC LIMIT 10000/)
  assert.match(health, /summarizeDeadNotifications\(await listDeadNotificationRows\(\)\)/)
  assert.match(health, /result\.notificationDeliveryDead = deadSummary\.counted/)
  assert.match(health, /result\.recentDeliveryErrors = healthErrors\.blocking/)
  assert.match(health, /optedOutOperatorIds: database\.optedOutOperatorIds/)
  assert.match(health, /healthMonitorAlert: database\.healthMonitorAlert/)
  assert.match(health, /diagnosticErrors: database\.diagnosticDeliveryErrors/)
  assert.doesNotMatch(health, /\) AS notification_delivery_dead/)
})

test("permanent Twilio recipient errors stop inline and scheduled retries and reach the status callback", () => {
  const notify = source("lib/notify.ts")
  const statusRoute = source("app/api/twilio/notification-status/route.ts")
  const inline = notify.slice(notify.indexOf("async function sendSmsWithInlineRetry"), notify.indexOf("async function persistSmsAttempt"))
  assert.match(inline, /permanentTwilioRecipientError\(twilioErrorCodeFrom\(/)
  // Permanent stops before the inline retry; the other return shapes are unchanged.
  assert.match(inline, /if \(permanent\) return \{ sent: false, unknown: false, error: permanent\.message, permanent: true \}[\s\S]*if \(!definitive\) return \{ sent: false, unknown: true, error: message \}/)
  // Scheduled retry: permanent goes dead on the first attempt, not the fifth.
  assert.match(notify, /delivery_status = CASE WHEN \$\{smsPermanent\}::boolean OR delivery_attempts >= 5 THEN 'dead' ELSE 'retry' END/)
  assert.match(notify, /delivery_next_attempt_at = CASE WHEN \$\{smsPermanent\}::boolean OR delivery_attempts >= 5 THEN NULL/)
  // First send: a separate dead branch, the ordinary retry statement untouched.
  const firstSend = notify.slice(notify.indexOf("export async function notify("), notify.indexOf("export async function notifyOwnerCellSms"))
  assert.match(firstSend, /\} else if \(smsPermanent\) \{[\s\S]{0,400}ELSE 'dead' END,\s+delivery_last_attempt_at = now\(\), delivery_next_attempt_at = NULL/)
  assert.match(firstSend, /SET interrupt_reserved_at = NULL, delivery_status = 'retry',/)
  // Coalesced summary: same rule.
  assert.match(notify, /delivery_status = CASE WHEN \$\{summaryPermanent\}::boolean OR delivery_attempts >= 5 THEN 'dead' ELSE 'retry' END/)
  assert.match(statusRoute, /permanentTwilioRecipientError\(errorCode\)/)
  assert.match(statusRoute, /permanent\?\.message \?\? `Twilio reported that the operator alert was not delivered/)
})
