import { randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"
import { automationRunIsStale } from "@/lib/automation-health.ts"
import { buildHealthMonitorFailureAlert } from "@/lib/health-monitor-alert.ts"
import { notifyAll } from "@/lib/notify"
import { isAuthorizedCron } from "@/lib/ops-auth"

const responseHeaders = { "Cache-Control": "no-store" }
const gmailPageAgeMs = 60 * 60_000

type HealthSnapshot = {
  ok?: boolean
  leadsAccepted?: boolean
  delivery?: { recentErrors?: unknown[] }
  googleAds?: { conversionConfigured?: boolean; phoneConversionConfigured?: boolean }
  googleAnalytics?: { measurementConfigured?: boolean }
  shopBrain?: { ready?: boolean; durableFailures?: { healthy?: boolean }; inboundCallReceipts?: { silent?: boolean } }
}

async function evaluateHealth(readHealth: () => Promise<Response>) {
  try {
    const response = await readHealth()
    const health = await response.json() as HealthSnapshot
    return {
      status: response.status,
      ok: response.status === 200 && health.ok === true && health.leadsAccepted === true &&
        health.shopBrain?.ready === true && health.shopBrain.durableFailures?.healthy === true &&
        health.shopBrain.inboundCallReceipts?.silent !== true && health.delivery?.recentErrors?.length === 0 &&
        health.googleAds?.conversionConfigured === true && health.googleAds?.phoneConversionConfigured === true &&
        health.googleAnalytics?.measurementConfigured === true,
    }
  } catch {
    return { status: null, ok: false }
  }
}

export async function handleHealthMonitor(req: Request, readHealth: () => Promise<Response>) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: responseHeaders })
  }
  const input = req.method === "POST"
    ? await req.json().catch(() => null) as { runId?: unknown; isTest?: unknown } | null
    : { runId: randomUUID() }
  const runId = String(input?.runId ?? "").trim()
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(runId)) {
    return Response.json({ error: "A valid runId is required." }, { status: 400, headers: responseHeaders })
  }
  const isTest = input?.isTest === true || process.env.VERCEL_ENV !== "production"
  const job = isTest ? "health-monitor-test" : "health-monitor"
  const holder = randomUUID()
  const sql = getSql()
  // Both schedulers share one lease. The cooldown collapses delayed duplicate
  // calls so one failing probe cannot count as two consecutive evaluations.
  const [lease] = (await sql`
    INSERT INTO automation_leases (key, holder, lease_expires_at, updated_at)
    VALUES (${job}::text, ${holder}::text, now() + interval '2 minutes', now())
    ON CONFLICT (key) DO UPDATE SET
      holder = EXCLUDED.holder, lease_expires_at = EXCLUDED.lease_expires_at, updated_at = now()
    WHERE automation_leases.lease_expires_at <= now()
      AND (automation_leases.last_finished_at IS NULL
        OR automation_leases.last_finished_at <= now() - interval '10 minutes')
    RETURNING key`) as { key: string }[]
  if (!lease) {
    return Response.json({ ok: true, skipped: true }, { status: 202, headers: responseHeaders })
  }

  try {
    const health = await evaluateHealth(readHealth)
    const [state] = (await sql`
      SELECT
        (SELECT ran_at FROM automation_runs WHERE job = 'gmail-ingest'::text AND ok
          ORDER BY ran_at DESC LIMIT 1) AS last_gmail_success_at,
        (SELECT ok FROM automation_runs WHERE job = ${job}::text
          ORDER BY ran_at DESC, id DESC LIMIT 1) AS previous_ok,
        EXISTS (SELECT 1 FROM notifications
          WHERE is_test = ${isTest}::boolean AND dedupe_key LIKE 'health-monitor:%'
            AND created_at > now() - interval '6 hours') AS recent_page`) as {
      last_gmail_success_at: string | null
      previous_ok: boolean | null
      recent_page: boolean
    }[]
    const now = new Date()
    const lastGmailSuccessAt = state.last_gmail_success_at
    // A missing success timestamp has no age. The health gate can still fail
    // and page once a second independent evaluation also fails.
    const reason = lastGmailSuccessAt && automationRunIsStale(lastGmailSuccessAt, gmailPageAgeMs, now.getTime())
      ? "gmail-stale"
      : !health.ok && state.previous_ok === false ? "consecutive-failures" : null
    await sql`
      INSERT INTO automation_runs (job, ok, detail)
      VALUES (${job}::text, ${health.ok}::boolean,
        ${JSON.stringify({ runId, isTest, reason, lastGmailSuccessAt, status: health.status })}::jsonb)`

    const alert = reason && !state.recent_page ? buildHealthMonitorFailureAlert(runId, { isTest, reason }, now) : null
    // notifyAll persists the deduplicated owner SMS before the provider send.
    const deliveries = alert ? await notifyAll(alert) : []
    return Response.json({
      ok: true,
      evaluationOk: health.ok,
      reason,
      persisted: deliveries.filter((delivery) => delivery.id > 0).length,
      sent: deliveries.filter((delivery) => delivery.sent).length,
      isTest,
    }, { status: 202, headers: responseHeaders })
  } finally {
    await sql`
      UPDATE automation_leases SET holder = ''::text, lease_expires_at = now(),
        last_finished_at = now(), updated_at = now()
      WHERE key = ${job}::text AND holder = ${holder}::text`
  }
}
