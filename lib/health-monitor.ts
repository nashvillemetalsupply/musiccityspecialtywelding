import { randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"
import { automationRunIsStale } from "@/lib/automation-health.ts"
import { buildHealthMonitorFailureAlert } from "@/lib/health-monitor-alert.ts"
import { notifyAll } from "@/lib/notify"
import { isAuthorizedCron } from "@/lib/ops-auth"

const responseHeaders = { "Cache-Control": "no-store" }
const gmailPageAgeMs = 60 * 60_000
const failedHealthPageAgeMs = 30 * 60_000

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
  // The fixed lease outlives the function's 60-second runtime and coalesces
  // nearby triggers. Its expiration avoids a release write on every run.
  const [lease] = (await sql`
    INSERT INTO automation_leases (key, holder, lease_expires_at, updated_at)
    VALUES (${job}::text, ${holder}::text, now() + interval '10 minutes', now())
    ON CONFLICT (key) DO UPDATE SET
      holder = EXCLUDED.holder, lease_expires_at = EXCLUDED.lease_expires_at, updated_at = now()
    WHERE automation_leases.lease_expires_at <= now()
    RETURNING key`) as { key: string }[]
  if (!lease) {
    return Response.json({ ok: true, skipped: true }, { status: 202, headers: responseHeaders })
  }

  const health = await evaluateHealth(readHealth)
  // Older runs lack the carried state. Reconstruct their failure streak and
  // adopt a recorded page only if there has been no recovery since it filed.
  const [state] = (await sql`
    WITH previous AS (
      SELECT ok, detail FROM automation_runs WHERE job = ${job}::text
      ORDER BY ran_at DESC, id DESC LIMIT 1
    ), last_pass AS (
      SELECT ran_at, id FROM automation_runs WHERE job = ${job}::text AND ok
      ORDER BY ran_at DESC, id DESC LIMIT 1
    )
    SELECT
      COALESCE((SELECT ran_at FROM automation_runs WHERE job = 'gmail-ingest'::text AND ok
        ORDER BY ran_at DESC LIMIT 1), (previous.detail->>'lastGmailSuccessAt')::timestamptz) AS last_gmail_success_at,
      CASE WHEN NOT previous.ok THEN COALESCE((previous.detail->>'firstFailedAt')::timestamptz,
        (SELECT failed.ran_at FROM automation_runs AS failed
          WHERE failed.job = ${job}::text AND NOT failed.ok AND NOT EXISTS (
            SELECT 1 FROM last_pass WHERE (failed.ran_at, failed.id) <= (last_pass.ran_at, last_pass.id)
          ) ORDER BY failed.ran_at, failed.id LIMIT 1)) END AS first_failed_at,
      CASE
        WHEN previous.detail ? 'outageKey' THEN previous.detail->>'outageKey'
        WHEN previous.detail->>'reason' IS NOT NULL THEN (
          SELECT notice.dedupe_key FROM notifications AS notice
          WHERE notice.is_test = ${isTest}::boolean AND notice.dedupe_key LIKE 'health-monitor:%'
            AND notice.created_at >= (SELECT min(ran_at) FROM automation_runs WHERE job = ${job}::text)
            AND NOT EXISTS (
              SELECT 1 FROM automation_runs AS recovered WHERE recovered.job = ${job}::text
                AND recovered.ran_at >= notice.created_at AND recovered.detail->>'reason' IS NULL
            )
          ORDER BY notice.created_at DESC LIMIT 1
        )
      END AS outage_key
    FROM (SELECT 1) AS anchor LEFT JOIN previous ON true`) as {
    last_gmail_success_at: string | null
    first_failed_at: string | null
    outage_key: string | null
  }[]
  const now = new Date()
  const lastGmailSuccessAt = state.last_gmail_success_at
  const firstFailedAt = health.ok ? null : state.first_failed_at ?? now.toISOString()
  const reason = lastGmailSuccessAt && automationRunIsStale(lastGmailSuccessAt, gmailPageAgeMs, now.getTime())
    ? "gmail-stale"
    : firstFailedAt && now.getTime() - new Date(firstFailedAt).getTime() >= failedHealthPageAgeMs
      ? "consecutive-failures" : null
  const candidateAlert = reason ? buildHealthMonitorFailureAlert(runId, { episodeId: holder, isTest, reason }) : null
  const outageKey = candidateAlert ? state.outage_key ?? candidateAlert.dedupeKey : null
  await sql`
    INSERT INTO automation_runs (job, ok, detail)
    VALUES (${job}::text, ${health.ok}::boolean,
      ${JSON.stringify({ runId, isTest, reason, lastGmailSuccessAt, status: health.status, firstFailedAt, outageKey })}::jsonb)`

  const alert = candidateAlert && outageKey ? { ...candidateAlert, dedupeKey: outageKey } : null
  let pageRecorded = false
  if (alert && state.outage_key) {
    // A crash before notification persistence leaves this episode eligible to
    // page on the next evaluation. The notification key guards its SMS intent.
    const [page] = (await sql`
      SELECT EXISTS (SELECT 1 FROM notifications
        WHERE is_test = ${isTest}::boolean AND dedupe_key = ${alert.dedupeKey}::text) AS recorded`) as { recorded: boolean }[]
    pageRecorded = page.recorded
  }
  const deliveries = alert && !pageRecorded ? await notifyAll(alert) : []
  return Response.json({
    ok: true,
    evaluationOk: health.ok,
    reason,
    persisted: deliveries.filter((delivery) => delivery.id > 0).length,
    sent: deliveries.filter((delivery) => delivery.sent).length,
    isTest,
  }, { status: 202, headers: responseHeaders })
}
