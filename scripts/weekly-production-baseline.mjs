// Read-only weekly operating baseline.
//
// Run with production environment variables, for example:
//   vercel env run -- node scripts/weekly-production-baseline.mjs
//
// The output contains aggregate counts only. It never prints connection
// details, credentials, customer names, contact details, or message bodies.
import { neon } from "@neondatabase/serverless"

const databaseUrl = process.env.DATABASE_URL_UNPOOLED?.trim()
  || process.env.DATABASE_URL?.trim()
const cronSecret = process.env.CRON_SECRET?.trim()
const productionUrl = (process.env.PRODUCTION_URL?.trim()
  || "https://musiccityspecialtywelding.com").replace(/\/$/, "")

if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is not configured.")
if (!cronSecret) throw new Error("CRON_SECRET is not configured.")

const sql = neon(databaseUrl)

const [healthResponse, periodRows, backlogRows, callRows, sourceRows, statusRows, notificationFailureRows] = await Promise.all([
  fetch(`${productionUrl}/api/health`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
    cache: "no-store",
  }),
  sql`
    WITH bounds AS MATERIALIZED (
      SELECT (now() AT TIME ZONE 'America/Chicago')::date AS today
    ), periods(name, starts_on, ends_before) AS (
      SELECT 'current_7d'::text, today - 7, today FROM bounds
      UNION ALL
      SELECT 'previous_7d'::text, today - 14, today - 7 FROM bounds
      UNION ALL
      SELECT 'current_28d'::text, today - 28, today FROM bounds
    ), eligible_leads AS MATERIALIZED (
      SELECT *
      FROM leads
      WHERE is_test = false AND status <> 'spam'
    )
    SELECT p.name, p.starts_on, p.ends_before,
      count(l.id)::int AS leads,
      count(l.id) FILTER (WHERE l.gclid <> '')::int AS paid_search_leads,
      count(l.id) FILTER (WHERE l.first_response_at IS NOT NULL)::int AS responded,
      round(percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (l.first_response_at - l.created_at)) / 60
      ) FILTER (WHERE l.first_response_at IS NOT NULL))::int AS median_first_response_minutes,
      count(l.id) FILTER (WHERE l.quoted_at IS NOT NULL)::int AS quoted,
      count(l.id) FILTER (WHERE l.won_at IS NOT NULL)::int AS won,
      count(l.id) FILTER (WHERE l.completed_at IS NOT NULL)::int AS work_finished,
      count(l.id) FILTER (WHERE l.handed_off_at IS NOT NULL)::int AS jobs_closed,
      count(l.id) FILTER (WHERE l.paid_at IS NOT NULL)::int AS paid_in_full,
      COALESCE(sum(l.paid_amount_cents) FILTER (WHERE l.paid_amount_cents > 0), 0::numeric)::bigint AS paid_cents
    FROM periods p
    LEFT JOIN eligible_leads l
      ON (l.created_at AT TIME ZONE 'America/Chicago')::date >= p.starts_on
      AND (l.created_at AT TIME ZONE 'America/Chicago')::date < p.ends_before
    GROUP BY p.name, p.starts_on, p.ends_before
    ORDER BY CASE p.name WHEN 'current_7d' THEN 1 WHEN 'previous_7d' THEN 2 ELSE 3 END`,
  sql`
    SELECT
      count(*) FILTER (
        WHERE is_test = false AND status NOT IN ('lost', 'spam')
          AND completed_at IS NULL AND handed_off_at IS NULL
      )::int AS active_jobs,
      count(*) FILTER (
        WHERE is_test = false AND status NOT IN ('lost', 'spam')
          AND completed_at IS NOT NULL AND handed_off_at IS NULL
      )::int AS ready_to_close,
      count(*) FILTER (
        WHERE is_test = false AND status NOT IN ('lost', 'spam')
          AND paid_at IS NULL AND COALESCE(invoice_total_cents, revenue_cents, estimate_value_cents, 0::bigint) > 0
      )::int AS unpaid_jobs,
      count(*) FILTER (
        WHERE is_test = false AND status NOT IN ('lost', 'spam')
          AND first_response_at IS NULL
      )::int AS missing_first_response_record
    FROM leads`,
  sql`
    WITH bounds AS MATERIALIZED (
      SELECT (now() AT TIME ZONE 'America/Chicago')::date AS today
    ), periods(name, starts_on, ends_before) AS (
      SELECT 'current_7d'::text, today - 7, today FROM bounds
      UNION ALL
      SELECT 'previous_7d'::text, today - 14, today - 7 FROM bounds
      UNION ALL
      SELECT 'current_28d'::text, today - 28, today FROM bounds
    ), eligible_calls AS MATERIALIZED (
      SELECT c.*
      FROM calls c
      LEFT JOIN leads l ON l.id = c.lead_id
      WHERE COALESCE(l.is_test, false) = false
        AND lower(COALESCE(c.detail->>'isTest', 'false')) <> 'true'
    )
    SELECT p.name, p.starts_on, p.ends_before,
      count(c.id) FILTER (WHERE c.direction = 'in')::int AS inbound,
      count(c.id) FILTER (
        WHERE c.direction = 'in'
          AND lower(c.status) = ANY(ARRAY['completed','answered','in-progress']::text[])
      )::int AS answered,
      count(c.id) FILTER (
        WHERE c.direction = 'in'
          AND lower(c.status) = ANY(ARRAY['busy','failed','no-answer','canceled']::text[])
      )::int AS missed,
      count(c.id) FILTER (WHERE c.direction = 'out')::int AS outbound
    FROM periods p
    LEFT JOIN eligible_calls c
      ON (c.started_at AT TIME ZONE 'America/Chicago')::date >= p.starts_on
      AND (c.started_at AT TIME ZONE 'America/Chicago')::date < p.ends_before
    GROUP BY p.name, p.starts_on, p.ends_before
    ORDER BY CASE p.name WHEN 'current_7d' THEN 1 WHEN 'previous_7d' THEN 2 ELSE 3 END`,
  sql`
    WITH bounds AS MATERIALIZED (
      SELECT (now() AT TIME ZONE 'America/Chicago')::date AS today
    )
    SELECT CASE
        WHEN btrim(gclid) <> '' OR (
          lower(btrim(utm_source)) IN ('google', 'google ads', 'google_ads', 'googleads')
          AND lower(btrim(utm_medium)) IN ('cpc', 'ppc', 'paid', 'paid search', 'paid_search')
        ) THEN 'google ads'
        WHEN lower(btrim(source)) IN ('phone-in', 'twilio-call', 'call') THEN 'phone-in'
        WHEN lower(btrim(source)) IN ('walkin', 'walk-in') THEN 'walk-in'
        WHEN lower(btrim(source)) IN ('twilio-sms', 'sms-in') THEN 'sms-in'
        WHEN lower(btrim(source)) IN ('gmail', 'email', 'email-in') THEN 'email-in'
        WHEN lower(btrim(source)) IN ('referral', 'referral-word-of-mouth') THEN 'referral'
        WHEN lower(btrim(source)) = 'repeat-customer' THEN 'repeat customer'
        WHEN lower(btrim(source)) IN ('website', 'web') THEN 'web'
        WHEN btrim(utm_source) <> '' THEN left(lower(btrim(utm_source)), 80::int)
        WHEN btrim(source) <> '' THEN left(lower(btrim(source)), 80::int)
        ELSE 'unknown'
      END AS source,
      count(*)::int AS leads,
      count(*) FILTER (WHERE first_response_at IS NOT NULL)::int AS responded,
      count(*) FILTER (WHERE won_at IS NOT NULL)::int AS won
    FROM leads, bounds
    WHERE is_test = false AND status <> 'spam'
      AND (created_at AT TIME ZONE 'America/Chicago')::date >= today - 7
      AND (created_at AT TIME ZONE 'America/Chicago')::date < today
    GROUP BY 1
    ORDER BY leads DESC, source ASC`,
  sql`
    SELECT status::text, count(*)::int AS leads
    FROM leads
    WHERE is_test = false AND handed_off_at IS NULL
    GROUP BY status
    ORDER BY leads DESC, status ASC`,
  sql`
    SELECT n.delivery_status::text, n.priority::text,
      count(*)::int AS notifications,
      min(n.created_at) AS oldest_at,
      max(n.created_at) AS newest_at,
      max(n.delivery_attempts)::int AS max_attempts
    FROM notifications n
    LEFT JOIN events e ON e.id = n.source_event_id
    LEFT JOIN leads l ON l.id = e.lead_id
    LEFT JOIN people p ON p.id = e.person_id
    WHERE n.read_at IS NULL
      AND n.delivery_status = ANY(ARRAY['dead','unknown']::text[])
      AND COALESCE(l.is_test, false) = false
      AND COALESCE(p.is_test, false) = false
      AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
    GROUP BY n.delivery_status, n.priority
    ORDER BY n.delivery_status, n.priority`,
])

const health = await healthResponse.json()

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value)
}

const output = {
  generatedAt: new Date().toISOString(),
  health: {
    httpStatus: healthResponse.status,
    ok: health.ok,
    leadsAccepted: health.leadsAccepted,
    email: health.email,
    database: health.database,
    delivery: health.delivery,
    automation: health.automation,
    shopBrain: health.shopBrain,
    googleAds: health.googleAds,
    googleAnalytics: health.googleAnalytics,
    reviews: health.reviews,
    launchGate: health.launchGate,
  },
  funnel: periodRows.map((row) => ({
    period: row.name,
    startsOn: row.starts_on,
    endsBefore: row.ends_before,
    leads: Number(row.leads),
    paidSearchLeads: Number(row.paid_search_leads),
    responded: Number(row.responded),
    medianFirstResponseMinutes: numberOrNull(row.median_first_response_minutes),
    quoted: Number(row.quoted),
    won: Number(row.won),
    workFinished: Number(row.work_finished),
    jobsClosed: Number(row.jobs_closed),
    paidInFull: Number(row.paid_in_full),
    paidCents: Number(row.paid_cents),
  })),
  currentBacklog: Object.fromEntries(
    Object.entries(backlogRows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
  ),
  calls: callRows.map((row) => ({
    period: row.name,
    startsOn: row.starts_on,
    endsBefore: row.ends_before,
    inbound: Number(row.inbound),
    answered: Number(row.answered),
    missed: Number(row.missed),
    outbound: Number(row.outbound),
  })),
  current7dBySource: sourceRows.map((row) => ({
    source: row.source,
    leads: Number(row.leads),
    responded: Number(row.responded),
    won: Number(row.won),
  })),
  currentOpenByStatus: statusRows.map((row) => ({
    status: row.status,
    leads: Number(row.leads),
  })),
  unresolvedNotificationDelivery: notificationFailureRows.map((row) => ({
    status: row.delivery_status,
    priority: row.priority,
    notifications: Number(row.notifications),
    oldestAt: row.oldest_at,
    newestAt: row.newest_at,
    maxAttempts: Number(row.max_attempts),
  })),
}

console.log(JSON.stringify(output, null, 2))
if (!healthResponse.ok) process.exitCode = 1
