import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { automationRunIsStale } from "../lib/automation-health.ts"
import { buildHealthMonitorFailureAlert } from "../lib/health-monitor-alert.ts"

const minute = 60_000
const start = Date.parse("2026-11-21T17:59:00Z")
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

function harness() {
  let now = start
  let uuid = 0
  let probeCount = 0
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
      assert.match(query, /last_finished_at <= now\(\) - interval '10 minutes'/)
      if (current && (current.expiresAt > now || current.finishedAt > now - 10 * minute)) return []
      leases.set(job, { holder, expiresAt: now + 2 * minute })
      return [{ key: job }]
    }
    if (query.startsWith("UPDATE automation_leases")) {
      const [job, holder] = values
      assert.equal(leases.get(job).holder, holder)
      leases.set(job, { expiresAt: now, finishedAt: now })
      return []
    }
    if (query.startsWith("SELECT (SELECT ran_at")) {
      const [job, isTest] = values
      assert.match(query, /job = 'gmail-ingest'::text AND ok ORDER BY ran_at DESC LIMIT 1/)
      assert.match(query, /created_at > now\(\) - interval '6 hours'/)
      const success = runs.findLast((run) => run.job === "gmail-ingest" && run.ok)
      return [{
        last_gmail_success_at: success ? new Date(success.at).toISOString() : null,
        previous_ok: runs.findLast((run) => run.job === job)?.ok ?? null,
        recent_page: alerts.some((alert) => alert.isTest === isTest && alert.at > now - 360 * minute),
      }]
    }
    if (query.startsWith("INSERT INTO automation_runs")) {
      const [job, ok, detail] = values
      runs.push({ job, ok, at: now, detail: JSON.parse(detail) })
      return []
    }
    assert.fail(`Unexpected monitor SQL: ${query}`)
  }
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
  }
  const context = vm.createContext({ Request, Response, Date: FixedDate, process: { env: { VERCEL_ENV: "production" } } })
  const service = load(serviceModule, context, {
    "node:crypto": { randomUUID: () => `monitor-${++uuid}` },
    "@/lib/db": { getSql: () => sql },
    "@/lib/automation-health.ts": { automationRunIsStale },
    "@/lib/health-monitor-alert.ts": { buildHealthMonitorFailureAlert },
    "@/lib/notify": { notifyAll: async (alert) => {
      assert.equal(runs.at(-1).detail.reason, alert.actionDetail.reason, "evaluation persisted before the alert")
      assert.equal(alert.ownerOnly, true)
      assert.equal(alert.smsOnly, true)
      assert.equal(alert.capExempt, true)
      assert.equal(alert.quietHoursExempt, true)
      if (alerts.some(({ dedupeKey }) => alert.dedupeKey === dedupeKey)) return [{ id: 0, sent: false }]
      alerts.push({ ...alert, at: now })
      return [{ id: alerts.length, sent: true }]
    } },
    "@/lib/ops-auth": { isAuthorizedCron: (req) => req.headers.get("authorization") === secret },
  })
  const route = load(routeModule, context, {
    "@/lib/health-monitor": service,
    "../route": { GET: async () => {
      probeCount++
      return Response.json(snapshot, { status: snapshot.ok ? 200 : 503 })
    } },
  })
  return {
    alerts,
    runs,
    snapshot,
    elapsed: (minutes) => { now += minutes * minute },
    gmailRun: (age, ok) => runs.push({ job: "gmail-ingest", ok, at: now - age * minute }),
    probeCount: () => probeCount,
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

test("two distinct failed evaluations page, with simultaneous cron and backup calls coalesced", async () => {
  const h = harness()
  h.gmailRun(30, true)
  h.snapshot.ok = false
  const calls = await Promise.all([h.get(), h.get()])
  const results = await Promise.all(calls.map((response) => response.json()))
  assert.equal(results.filter(({ skipped }) => skipped).length, 1)
  assert.equal(h.probeCount(), 1)
  assert.equal(h.alerts.length, 0)
  h.elapsed(5)
  assert.equal((await (await h.get()).json()).skipped, true)
  h.elapsed(10)
  const second = await (await h.get()).json()
  assert.equal(second.reason, "consecutive-failures")
  assert.equal(second.sent, 1)
  assert.equal(h.alerts.length, 1)
})

test("rolling six-hour dedupe suppresses a second page across UTC bucket boundaries", async () => {
  const h = harness()
  h.gmailRun(61, true)
  await h.get()
  h.elapsed(15)
  assert.equal((await (await h.get()).json()).sent, 0)
  assert.equal(h.alerts.length, 1)
  h.elapsed(344)
  assert.equal((await (await h.get()).json()).sent, 0)
  assert.equal(h.alerts.length, 1)
  h.elapsed(15)
  assert.equal((await (await h.get()).json()).sent, 1)
  assert.equal(h.alerts.length, 2)
})
