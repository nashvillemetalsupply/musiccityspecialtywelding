import { randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"
import { automationRunIsStale } from "@/lib/automation-health.ts"
import { buildHealthMonitorFailureAlert } from "@/lib/health-monitor-alert.ts"
import { notifyAll } from "@/lib/notify"
import { notificationDedupePrefix } from "@/lib/notification-dedupe"
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

export async function handleHealthMonitor(req: Request, readHealth: () => Promise<Response>, { logRun = false } = {}) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: responseHeaders })
  }

  let job: string | undefined
  let result: Awaited<ReturnType<typeof runHealthMonitor>> | undefined
  try {
    const input = req.method === "POST"
      ? await req.json().catch(() => null) as { runId?: unknown; isTest?: unknown } | null
      : { runId: randomUUID() }
    const runId = String(input?.runId ?? "").trim()
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(runId)) {
      return Response.json({ error: "A valid runId is required." }, { status: 400, headers: responseHeaders })
    }
    const isTest = input?.isTest === true || process.env.VERCEL_ENV !== "production"
    job = isTest ? "health-monitor-test" : "health-monitor"
    result = await runHealthMonitor(readHealth, runId, isTest, job)
    return result.response
  } finally {
    if (logRun) {
      console.info(JSON.stringify({ event: "health-monitor-run", job, ...(result?.outcome ?? { error: true }) }))
    }
  }
}

async function runHealthMonitor(readHealth: () => Promise<Response>, runId: string, isTest: boolean, job: string) {
  const holder = randomUUID()
  const sql = getSql()
  const dedupePrefix = notificationDedupePrefix()
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
    return {
      response: Response.json({ ok: true, skipped: true }, { status: 202, headers: responseHeaders }),
      outcome: { skipped: true },
    }
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
        WHEN NOT previous.ok OR previous.detail->>'reason' IS NOT NULL THEN COALESCE(
          previous.detail->>'outageKey', (
            SELECT substr(notice.dedupe_key, ${dedupePrefix.length + 1}::int) FROM notifications AS notice
            WHERE notice.is_test = ${isTest}::boolean
              AND starts_with(notice.dedupe_key, ${`${dedupePrefix}health-monitor:`}::text)
              AND notice.created_at >= (SELECT min(ran_at) FROM automation_runs WHERE job = ${job}::text)
              AND notice.created_at > COALESCE((
                SELECT max(recovered.ran_at) FROM automation_runs AS recovered
                WHERE recovered.job = ${job}::text AND recovered.ok = true AND recovered.detail->>'reason' IS NULL
              ), '-infinity'::timestamptz)
            ORDER BY notice.created_at, notice.id LIMIT 1
          )
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
  const unhealthy = !health.ok || reason !== null
  const outageKey = unhealthy ? (state.outage_key ?? candidateAlert?.dedupeKey ?? null) : null
  await sql`
    INSERT INTO automation_runs (job, ok, detail)
    VALUES (${job}::text, ${health.ok}::boolean,
      ${JSON.stringify({ runId, isTest, reason, lastGmailSuccessAt, status: health.status, firstFailedAt, outageKey })}::jsonb)`

  let deliveries: Awaited<ReturnType<typeof notifyAll>> = []
  if (candidateAlert && outageKey) {
    const [page] = (await sql`
      SELECT (count(*) FILTER (WHERE delivery_status <> 'dead'))::int AS live,
        count(DISTINCT dedupe_key)::int AS attempts
      FROM notifications
      WHERE is_test = ${isTest}::boolean AND starts_with(dedupe_key, ${dedupePrefix + outageKey}::text)`) as { live: number; attempts: number }[]
    if (page.live === 0 && page.attempts < 4) {
      const dedupeKey = page.attempts === 0 ? outageKey : `${outageKey}:r${page.attempts}`
      const alert = { ...candidateAlert, dedupeKey }
      deliveries = await notifyAll(alert)
    }
  }
  return {
    response: Response.json({
      ok: true,
      evaluationOk: health.ok,
      reason,
      persisted: deliveries.filter((delivery) => delivery.id > 0).length,
      sent: deliveries.filter((delivery) => delivery.sent).length,
      isTest,
    }, { status: 202, headers: responseHeaders }),
    outcome: { evaluationOk: health.ok, status: health.status, reason, isTest, paged: deliveries.some((delivery) => delivery.sent) },
  }
}
