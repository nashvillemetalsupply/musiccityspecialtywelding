import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { normalizeRecentDeliveryErrors } from "../lib/delivery-errors.mjs"
import { buildHealthMonitorFailureAlert } from "../lib/health-monitor-alert.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const now = Date.parse("2026-09-27T18:00:00Z")

test("recent delivery errors keep only bounded production failures from the last 24 hours", () => {
  const rows = [
    { occurred_at: "2026-09-27T17:00:00Z", title: "SMS failed", error: "Twilio rejected request", is_test: false },
    { occurred_at: "2026-09-27T16:00:00Z", title: "[INTERNAL TEST] Preview", error: "test failure", is_test: true },
    { occurred_at: "2026-09-26T17:59:59Z", title: "Old error", error: "stale", is_test: false },
    { occurred_at: "2026-09-27T17:30:00Z", title: "Blank error", error: " ", is_test: false },
    { occurred_at: "2026-09-27T18:01:00Z", title: "Future error", error: "not yet", is_test: false },
    { occurred_at: "2026-09-27T17:40:00Z", title: "Marked test", error: "[INTERNAL TEST] synthetic", is_test: false },
  ]
  assert.deepEqual(normalizeRecentDeliveryErrors(rows, now), [{
    at: "2026-09-27T17:00:00.000Z",
    title: "SMS failed",
    error: "Twilio rejected request",
  }])
})

test("health failure alerts persist owner-only SMS intent and mark internal tests", () => {
  const alert = buildHealthMonitorFailureAlert("1234-2")
  assert.deepEqual({
    priority: alert.priority,
    stock: alert.stock,
    ownerOnly: alert.ownerOnly,
    smsOnly: alert.smsOnly,
    quietHoursExempt: alert.quietHoursExempt,
    isTest: alert.isTest,
    dedupeKey: alert.dedupeKey,
  }, {
    priority: "interrupt",
    stock: "red",
    ownerOnly: true,
    smsOnly: true,
    quietHoursExempt: true,
    isTest: false,
    dedupeKey: "health-monitor:1234-2",
  })
  const internal = buildHealthMonitorFailureAlert("1234-2", { isTest: true })
  assert.equal(internal.isTest, true)
  assert.equal(internal.actionDetail.isTest, true)
  assert.match(internal.title, /^\[INTERNAL TEST\]/)
  assert.equal(internal.dedupeKey, "health-monitor:test:1234-2")
  assert.equal(buildHealthMonitorFailureAlert("not safe/for shell"), null)
})

test("health and Updates surface owner-visible recent errors, and workflow failure text uses the persisted alert endpoint", () => {
  const query = source("lib/delivery-errors.ts")
  const health = source("app/api/health/route.ts")
  const healthPost = health.slice(health.indexOf("export async function POST"))
  const updates = source("app/board/updates/page.tsx")
  const workflow = source(".github/workflows/health-monitor.yml")

  assert.match(query, /n\.delivery_error <> ''/)
  assert.match(query, /COALESCE\(n\.delivery_last_attempt_at, n\.created_at\) >= now\(\) - interval '24 hours'/)
  assert.match(query, /WHERE recent\.is_test = false/)
  assert.match(health, /recentErrors: database\.recentDeliveryErrors/)
  assert.match(healthPost, /if \(!isAuthorizedCron\(req\)\)/)
  assert.ok(healthPost.indexOf("if (!isAuthorizedCron(req))") < healthPost.indexOf("await notifyAll(alert)"))
  assert.match(healthPost, /const deliveries = await notifyAll\(alert\)/)
  assert.match(healthPost, /isTest: input\.isTest === true/)
  assert.match(health, /recentDeliveryErrorsHealthy &&/)
  assert.match(updates, /operator\.role === "owner" \? listRecentDeliveryErrors\(\)/)
  assert.match(updates, /updates-delivery-title/)
  assert.match(workflow, /- name: Text owner when the health monitor fails\s+if: failure\(\)/)
  assert.match(workflow, /-X POST[\s\S]*api\/health/)
  assert.match(workflow, /Authorization: Bearer \$\{CRON_SECRET\}/)
  assert.match(workflow, /\.delivery\.recentErrors \| length == 0/)
  assert.match(workflow, /monthly-keepalive:[\s\S]*group: monthly-health-monitor-keepalive/)
})
