import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { automationRunIsStale } from "../lib/automation-health.ts"
import { buildHealthMonitorFailureAlert } from "../lib/health-monitor-alert.ts"

const minute = 60_000
const start = Date.parse("2026-11-21T17:05:00Z")
const secret = "Bearer synthetic-cron-secret"

function compile(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  return new vm.Script(`(function(exports, require, module) { ${outputText}\n})`, { filename: path })
}

const serviceModule = compile("lib/health-monitor.ts")
const routeModule = compile("app/api/health/monitor/route.ts")

function load(script, context, imports) {
  const loaded = { exports: {} }
  script.runInContext(context)(loaded.exports, (specifier) => {
    assert.ok(Object.hasOwn(imports, specifier), `Unexpected import: ${specifier}`)
    return imports[specifier]
  }, loaded)
  return loaded.exports
}

function harness({ deliveryStatus = "delivered" } = {}) {
  let now = start
  let uuid = 0
  let probeCount = 0
  let leaseWrites = 0
  let failBeforeNotification = false
  const leases = new Map()
  const runs = []
  const alerts = []
  const snapshot = {
    ok: true,
    leadsAccepted: true,
    automation: { gmailStale: false },
    delivery: { recentErrors: [] },
    shopBrain: { ready: true, durableFailures: { healthy: true }, inboundCallReceipts: { silent: false } },
    googleAds: { conversionConfigured: true, phoneConversionConfigured: true },
    googleAnalytics: { measurementConfigured: true },
  }
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (query.startsWith("INSERT INTO automation_leases")) {
      const [job, holder] = values
      const current = leases.get(job)
      assert.match(query, /lease_expires_at <= now\(\)/)
      assert.match(query, /now\(\) \+ interval '10 minutes'/)
      if (current && current.expiresAt > now) return []
      leaseWrites++
      leases.set(job, { holder, expiresAt: now + 10 * minute })
      return [{ key: job }]
    }
    if (query.startsWith("WITH previous AS")) {
      const [job, , , isTest] = values
      assert.match(query, /job = 'gmail-ingest'::text AND ok ORDER BY ran_at DESC LIMIT 1/)
      const success = runs.findLast((run) => run.job === "gmail-ingest" && run.ok)
      const history = runs.filter((run) => run.job === job)
      const previous = history.at(-1)
      const failures = history.slice(history.findLastIndex((run) => run.ok) + 1)
      const legacyPage = previous?.detail?.reason && !Object.hasOwn(previous.detail, "outageKey")
        && alerts.findLast((alert) => alert.isTest === isTest && alert.at >= history[0].at
          && !history.some((run) => run.at >= alert.at && !run.detail.reason))
      return [{
        last_gmail_success_at: success ? new Date(success.at).toISOString() : previous?.detail?.lastGmailSuccessAt ?? null,
        first_failed_at: previous?.detail?.firstFailedAt ?? (failures.length ? new Date(failures[0].at).toISOString() : null),
        outage_key: previous?.detail?.outageKey ?? legacyPage?.dedupeKey ?? null,
      }]
    }
    if (query.startsWith("INSERT INTO automation_runs")) {
      const [job, ok, detail] = values
      runs.push({ job, ok, at: now, detail: JSON.parse(detail) })
      return []
    }
    if (query.startsWith("SELECT (count(*) FILTER")) {
      const [isTest, outageKey] = values
      assert.match(query, /FILTER \(WHERE delivery_status <> 'dead'\)/)
      assert.match(query, /count\(DISTINCT dedupe_key\)/)
      assert.match(query, /WHERE is_test = \? ::boolean AND starts_with\(dedupe_key, \? ::text\)/)
      const pages = alerts.filter((alert) => alert.isTest === isTest && alert.dedupeKey.startsWith(outageKey))
      return [{
        live: pages.filter((alert) => alert.deliveryStatus !== "dead").length,
        attempts: new Set(pages.map((alert) => alert.dedupeKey)).size,
      }]
    }
    assert.fail(`Unexpected monitor SQL: ${query}`)
  }
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
  }
  const context = vm.createContext({ Request, Response, Date: FixedDate, process: { env: { VERCEL_ENV: "production" } } })
  const loadService = () => load(serviceModule, context, {
    "node:crypto": { randomUUID: () => `monitor-${++uuid}` },
    "@/lib/db": { getSql: () => sql },
    "@/lib/automation-health.ts": { automationRunIsStale },
    "@/lib/health-monitor-alert.ts": { buildHealthMonitorFailureAlert },
    "@/lib/notify": { notifyAll: async (alert) => {
      if (failBeforeNotification) {
        failBeforeNotification = false
        throw new Error("Notification database unavailable")
      }
      assert.equal(runs.at(-1).detail.reason, alert.actionDetail.reason, "evaluation persisted before the alert")
      assert.equal(alert.ownerOnly, true)
      assert.equal(alert.smsOnly, true)
      assert.equal(alert.capExempt, true)
      assert.equal(alert.quietHoursExempt, true)
      if (alerts.some(({ dedupeKey }) => alert.dedupeKey === dedupeKey)) return [{ id: 0, sent: false }]
      alerts.push({ ...alert, at: now, deliveryStatus })
      return [{ id: alerts.length, sent: deliveryStatus === "delivered" }]
    } },
    "@/lib/ops-auth": { isAuthorizedCron: (req) => req.headers.get("authorization") === secret },
  })
  const loadRoute = () => load(routeModule, context, {
    "@/lib/health-monitor": loadService(),
    "../route": { GET: async () => {
      probeCount++
      return Response.json(snapshot, { status: snapshot.ok ? 200 : 503 })
    } },
  })
  let route = loadRoute()
  return {
    alerts,
    runs,
    snapshot,
    elapsed: (minutes) => { now += minutes * minute },
    gmailRun: (age, ok) => runs.push({ job: "gmail-ingest", ok, at: now - age * minute }),
    legacyRun: (age, ok, reason) => runs.push({ job: "health-monitor", ok, at: now - age * minute, detail: { reason } }),
    legacyPage: (age) => alerts.push({ at: now - age * minute, isTest: false, dedupeKey: "health-monitor:2026-11-21T12", deliveryStatus: "delivered" }),
    failBeforeNotification: () => { failBeforeNotification = true },
    coldStart: () => { route = loadRoute() },
    probeCount: () => probeCount,
    leaseWrites: () => leaseWrites,
    get: (authorization = secret) => route.GET(new Request("https://example.test/api/health/monitor", { headers: { authorization } })),
  }
}

test("the cron endpoint rejects unauthenticated probes without running an evaluation", async () => {
  const h = harness()
  assert.equal((await h.get("")).status, 401)
  assert.equal(h.probeCount(), 0)
  assert.deepEqual(h.runs, [])
})

test("one failed health evaluation never pages and a recovery resets the streak", async () => {
  const h = harness()
  h.gmailRun(30, true)
  h.snapshot.ok = false
  assert.equal((await (await h.get()).json()).evaluationOk, false)
  assert.equal(h.alerts.length, 0)
  h.elapsed(15)
  h.snapshot.ok = true
  await h.get()
  h.elapsed(15)
  h.snapshot.ok = false
  await h.get()
  assert.deepEqual(h.runs.slice(1).map(({ ok }) => ok), [false, true, false])
  assert.equal(h.alerts.length, 0)
})

test("a 46-minute Gmail warning never pages", async () => {
  const h = harness()
  h.gmailRun(46, true)
  h.snapshot.automation.gmailStale = true
  h.snapshot.shopBrain.warnings = [{ kind: "gmail-stale" }]
  const result = await (await h.get()).json()
  assert.equal(result.evaluationOk, true)
  assert.equal(result.reason, null)
  assert.equal(h.alerts.length, 0)
})

test("Gmail pages once at 61 minutes since the last success, even with a newer failed run", async () => {
  const h = harness()
  h.gmailRun(61, true)
  h.gmailRun(1, false)
  const result = await (await h.get()).json()
  assert.equal(result.reason, "gmail-stale")
  assert.equal(result.sent, 1)
  assert.equal(h.alerts.length, 1)
})

test("simultaneous cron and backup calls coalesce and one evaluation writes its lease once", async () => {
  const h = harness()
  h.gmailRun(30, true)
  h.snapshot.ok = false
  const calls = await Promise.all([h.get(), h.get()])
  const results = await Promise.all(calls.map((response) => response.json()))
  assert.equal(results.filter(({ skipped }) => skipped).length, 1)
  assert.equal(h.probeCount(), 1)
  assert.equal(h.alerts.length, 0)
  assert.equal(h.leaseWrites(), 1)
  h.elapsed(5)
  assert.equal((await (await h.get()).json()).skipped, true)
  assert.equal(h.leaseWrites(), 1)
})

test("Vercel at 17:05 and delayed GitHub at 17:16 do not page", async () => {
  const h = harness()
  h.gmailRun(0, true)
  h.snapshot.ok = false
  await h.get()
  h.elapsed(11)
  const result = await (await h.get()).json()
  assert.equal(result.evaluationOk, false)
  assert.equal(result.reason, null)
  assert.equal(h.alerts.length, 0)
})

test("failed checks at 17:05 and 17:35 page at the 30-minute threshold", async () => {
  const h = harness()
  h.gmailRun(0, true)
  h.snapshot.ok = false
  await h.get()
  assert.equal(h.alerts.length, 0)
  h.elapsed(30)
  const second = await (await h.get()).json()
  assert.equal(second.reason, "consecutive-failures")
  assert.equal(second.sent, 1)
  assert.equal(h.alerts.length, 1)
})

test("a continuous eight-hour outage pages once", async () => {
  const h = harness()
  h.gmailRun(61, true)
  assert.equal((await (await h.get()).json()).sent, 1)
  for (let elapsed = 15; elapsed <= 480; elapsed += 15) {
    h.elapsed(15)
    if (elapsed === 240) h.coldStart()
    assert.equal((await (await h.get()).json()).sent, 0, `${elapsed} minutes into the same outage`)
  }
  assert.equal(h.alerts.length, 1)
})

test("history pruning cannot end an ongoing Gmail outage", async () => {
  const h = harness()
  h.gmailRun(61, true)
  assert.equal((await (await h.get()).json()).sent, 1)
  h.runs.shift()
  h.elapsed(15)
  const evaluation = await (await h.get()).json()
  assert.equal(evaluation.reason, "gmail-stale")
  assert.equal(evaluation.sent, 0)
})

test("a Gmail page covers a health failure that continues after Gmail recovers", async () => {
  const h = harness()
  h.gmailRun(61, true)
  h.snapshot.ok = false
  const first = await (await h.get()).json()
  assert.equal(first.reason, "gmail-stale")
  assert.equal(first.sent, 1)
  const outageKey = h.alerts[0].dedupeKey

  h.elapsed(15)
  h.gmailRun(1, true)
  const transition = await (await h.get()).json()
  assert.equal(transition.evaluationOk, false)
  assert.equal(transition.reason, null)
  assert.equal(h.runs.at(-1).detail.outageKey, outageKey)

  h.elapsed(15)
  const later = await (await h.get()).json()
  assert.equal(later.reason, "consecutive-failures")
  assert.equal(later.sent, 0)
  assert.equal(h.runs.at(-1).detail.outageKey, outageKey)
  assert.equal(h.alerts.length, 1)
})

test("one healthy evaluation resets the episode and a new outage an hour later pages", async () => {
  const h = harness()
  h.gmailRun(61, true)
  assert.equal((await (await h.get()).json()).sent, 1)
  h.elapsed(15)
  h.gmailRun(1, true)
  const recovery = await (await h.get()).json()
  assert.equal(recovery.evaluationOk, true)
  assert.equal(recovery.reason, null)
  assert.equal(h.runs.at(-1).detail.outageKey, null)
  h.elapsed(60)
  assert.equal((await (await h.get()).json()).sent, 1)
  assert.equal(h.alerts.length, 2)
  assert.notEqual(h.alerts[0].dedupeKey, h.alerts[1].dedupeKey)
})

test("an ongoing outage adopts a page recorded before episode keys were introduced", async () => {
  const h = harness()
  h.gmailRun(120, true)
  h.legacyRun(45, true, "gmail-stale")
  h.legacyPage(44)
  h.legacyRun(15, true, "gmail-stale")
  assert.equal((await (await h.get()).json()).sent, 0)
  assert.equal(h.runs.at(-1).detail.outageKey, h.alerts[0].dedupeKey)
  assert.equal(h.alerts.length, 1)
})

test("a failure streak uses legacy checks after the last passing check", async () => {
  const h = harness()
  h.gmailRun(0, true)
  h.legacyRun(60, false, null)
  h.legacyRun(45, true, null)
  h.legacyRun(15, false, null)
  h.snapshot.ok = false
  assert.equal((await (await h.get()).json()).reason, null)
  h.elapsed(15)
  assert.equal((await (await h.get()).json()).sent, 1)
})

test("an episode can file its first page after notification persistence fails", async () => {
  const h = harness()
  h.gmailRun(61, true)
  h.failBeforeNotification()
  await assert.rejects(h.get(), /Notification database unavailable/)
  const firstKey = h.runs.at(-1).detail.outageKey
  h.elapsed(15)
  h.coldStart()
  assert.equal((await (await h.get()).json()).sent, 1)
  assert.equal(h.alerts[0].dedupeKey, firstKey)
  h.elapsed(15)
  assert.equal((await (await h.get()).json()).sent, 0)
  assert.equal(h.alerts.length, 1)
})

test("dead pages are refiled on the next alert and stop after four distinct attempts", async () => {
  const h = harness({ deliveryStatus: "dead" })
  h.gmailRun(61, true)
  assert.equal((await (await h.get()).json()).persisted, 1)
  const outageKey = h.runs.at(-1).detail.outageKey
  assert.equal(h.alerts[0].dedupeKey, outageKey)
  h.alerts.push({ ...h.alerts[0] }) // A second owner has the same attempt key.

  for (let attempt = 2; attempt <= 4; attempt++) {
    h.elapsed(15)
    assert.equal((await (await h.get()).json()).persisted, 1, `attempt ${attempt}`)
    const { runId } = h.runs.at(-1).detail
    assert.equal(h.alerts.at(-1).dedupeKey, `${outageKey}:${runId}`)
  }

  h.elapsed(15)
  assert.equal((await (await h.get()).json()).persisted, 0)
  assert.equal(new Set(h.alerts.map((alert) => alert.dedupeKey)).size, 4)
})

test("an in-flight page keeps the same outage from refiling", async () => {
  const h = harness({ deliveryStatus: "sending" })
  h.gmailRun(61, true)
  const first = await (await h.get()).json()
  assert.equal(first.persisted, 1)
  assert.equal(first.sent, 0)

  h.elapsed(15)
  assert.equal((await (await h.get()).json()).persisted, 0)
  assert.equal(h.alerts.length, 1)
})
