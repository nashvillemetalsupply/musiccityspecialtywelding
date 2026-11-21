import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { normalizeRecentDeliveryErrors } from "../lib/delivery-errors.mjs"
import { buildHealthMonitorFailureAlert } from "../lib/health-monitor-alert.ts"

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
  const now = new Date("2026-09-27T12:01:00Z")
  const alert = buildHealthMonitorFailureAlert("1234-2", {}, now)
  const sameBucket = buildHealthMonitorFailureAlert("9876-4", {}, new Date("2026-09-27T17:59:00Z"))
  const nextBucket = buildHealthMonitorFailureAlert("5678-1", {}, new Date("2026-09-27T18:00:00Z"))
  const internal = buildHealthMonitorFailureAlert("1234-2", { isTest: true }, now)
  assert.deepEqual({
    priority: alert.priority,
    stock: alert.stock,
    ownerOnly: alert.ownerOnly,
    smsOnly: alert.smsOnly,
    capExempt: alert.capExempt,
    quietHoursExempt: alert.quietHoursExempt,
    isTest: alert.isTest,
    dedupeKey: alert.dedupeKey,
  }, {
    priority: "interrupt",
    stock: "red",
    ownerOnly: true,
    smsOnly: true,
    capExempt: true,
    quietHoursExempt: true,
    isTest: false,
    dedupeKey: "health-monitor:2026-09-27T12",
  })
  assert.equal(alert.actionDetail.runId, "1234-2")
  assert.equal(sameBucket.dedupeKey, alert.dedupeKey)
  assert.notEqual(nextBucket.dedupeKey, alert.dedupeKey)
  assert.equal(internal.isTest, true)
  assert.equal(internal.actionDetail.isTest, true)
  assert.match(internal.title, /^\[INTERNAL TEST\]/)
  assert.equal(internal.dedupeKey, "health-monitor:test:2026-09-27T12")
  assert.notEqual(internal.dedupeKey, alert.dedupeKey)
  assert.equal(buildHealthMonitorFailureAlert("not safe/for shell"), null)
})

test("health and Updates surface owner-visible recent errors, and the backup uses the shared monitor", () => {
  const query = source("lib/delivery-errors.ts")
  const health = source("app/api/health/route.ts")
  const healthPost = health.slice(health.indexOf("export async function POST"))
  const monitor = source("lib/health-monitor.ts")
  const updates = source("app/board/updates/page.tsx")
  const workflow = source(".github/workflows/health-monitor.yml")

  assert.match(query, /n\.delivery_error <> ''/)
  assert.match(query, /COALESCE\(n\.delivery_last_attempt_at, n\.created_at\) >= now\(\) - interval '24 hours'/)
  assert.match(query, /WHERE recent\.is_test = false/)
  assert.match(health, /recentErrors: database\.recentDeliveryErrors/)
  assert.match(healthPost, /handleHealthMonitor\(req, \(\) => GET\(req\)\)/)
  assert.ok(monitor.indexOf("if (!isAuthorizedCron(req))") < monitor.indexOf("await notifyAll(alert)"))
  assert.match(monitor, /isTest = input\?\.isTest === true/)
  assert.match(health, /recentDeliveryErrorsHealthy &&/)
  assert.match(updates, /operator\.role === "owner" \? listRecentDeliveryErrors\(\)/)
  assert.match(updates, /updates-delivery-title/)
  assert.match(workflow, /api\/health\/monitor/)
  assert.match(workflow, /Authorization: Bearer \$\{CRON_SECRET\}/)
  assert.match(workflow, /\.delivery\.recentErrors \| length == 0/)
  assert.match(workflow, /monthly-keepalive:[\s\S]*group: monthly-health-monitor-keepalive/)
})

test("Vercel evaluates health every 15 minutes and GitHub records healthy backup evaluations", () => {
  const { crons } = JSON.parse(source("vercel.json"))
  const workflow = source(".github/workflows/health-monitor.yml")
  const backupJob = workflow.slice(workflow.indexOf("  backup-health-evaluation:"), workflow.indexOf("  monthly-keepalive:"))
  assert.ok(crons.some(({ path, schedule }) => path === "/api/health/monitor" && schedule === "5,20,35,50 * * * *"))
  assert.match(backupJob, /^  backup-health-evaluation:\s+runs-on: ubuntu-latest\s+timeout-minutes: 2\s+steps:/)
  assert.match(backupJob, /curl -sS --max-time 65[\s\S]*api\/health\/monitor/)
  assert.doesNotMatch(backupJob, /^    needs:/m)
})
