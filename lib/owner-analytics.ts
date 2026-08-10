import { getSql } from "@/lib/db"
import type { OperatorRole } from "@/lib/operators"

export const OWNER_ANALYTICS_RANGES = [30, 90, 365] as const

export type OwnerAnalyticsRange = (typeof OWNER_ANALYTICS_RANGES)[number]
export type OwnerAnalyticsPeriodKey = "current" | "prior"

export type OwnerAnalyticsPeriod = {
  key: OwnerAnalyticsPeriodKey
  startAt: string
  endAt: string
  leads: number
  bookedJobs: number
  conversionRate: number | null
  revenueCents: number
  paidCents: number
  unpaidCents: number
  medianFirstResponseMinutes: number | null
}

export type OwnerAnalyticsSource = {
  source: string
  currentLeads: number
  currentBookedJobs: number
  priorLeads: number
  priorBookedJobs: number
}

export type OwnerAnalytics = {
  generatedAt: string
  days: OwnerAnalyticsRange
  current: OwnerAnalyticsPeriod
  prior: OwnerAnalyticsPeriod
  sources: OwnerAnalyticsSource[]
}

type SummaryRow = {
  period: OwnerAnalyticsPeriodKey
  start_at: string
  end_at: string
  leads: number | string
  booked_jobs: number | string
  revenue_cents: number | string
  paid_cents: number | string
  unpaid_cents: number | string
  median_response_minutes: number | string | null
}

type SourceRow = {
  period: OwnerAnalyticsPeriodKey
  source: string
  leads: number | string
  booked_jobs: number | string
}

export function normalizeOwnerAnalyticsRange(value: string | number | null | undefined): OwnerAnalyticsRange {
  const parsed = Number(value)
  return OWNER_ANALYTICS_RANGES.includes(parsed as OwnerAnalyticsRange)
    ? parsed as OwnerAnalyticsRange
    : 30
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toPeriod(row: SummaryRow): OwnerAnalyticsPeriod {
  const leads = Math.max(0, finiteNumber(row.leads))
  const bookedJobs = Math.max(0, finiteNumber(row.booked_jobs))
  const median = row.median_response_minutes === null
    ? null
    : finiteNumber(row.median_response_minutes, Number.NaN)
  return {
    key: row.period,
    startAt: String(row.start_at),
    endAt: String(row.end_at),
    leads,
    bookedJobs,
    conversionRate: leads > 0 ? (bookedJobs / leads) * 100 : null,
    revenueCents: Math.max(0, finiteNumber(row.revenue_cents)),
    paidCents: Math.max(0, finiteNumber(row.paid_cents)),
    unpaidCents: Math.max(0, finiteNumber(row.unpaid_cents)),
    medianFirstResponseMinutes: median !== null && Number.isFinite(median) ? Math.max(0, median) : null,
  }
}

function emptyPeriod(key: OwnerAnalyticsPeriodKey, anchor: string, days: OwnerAnalyticsRange): OwnerAnalyticsPeriod {
  const end = new Date(anchor)
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  if (key === "prior") {
    end.setTime(start.getTime())
    start.setTime(end.getTime() - days * 24 * 60 * 60 * 1000)
  }
  return {
    key,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    leads: 0,
    bookedJobs: 0,
    conversionRate: null,
    revenueCents: 0,
    paidCents: 0,
    unpaidCents: 0,
    medianFirstResponseMinutes: null,
  }
}

export async function getOwnerAnalytics(
  operatorRole: OperatorRole,
  requestedDays: string | number | null | undefined
): Promise<OwnerAnalytics> {
  // Keep this guard before getSql: a restricted caller must never start a
  // financial query, even if a future page accidentally calls this function.
  if (operatorRole !== "owner") throw new Error("Owner access is required for analytics.")

  const days = normalizeOwnerAnalyticsRange(requestedDays)
  const anchor = new Date().toISOString()
  const sql = getSql()

  const [summaryRows, sourceRows] = await Promise.all([
    sql`
      WITH params AS (
        SELECT ${anchor}::timestamptz AS current_end, ${days}::int AS day_count
      ), periods AS (
        SELECT 'current'::text AS period,
          current_end - (day_count * interval '1 day') AS start_at,
          current_end AS end_at
        FROM params
        UNION ALL
        SELECT 'prior'::text AS period,
          current_end - ((day_count * 2::int) * interval '1 day') AS start_at,
          current_end - (day_count * interval '1 day') AS end_at
        FROM params
      )
      SELECT p.period, p.start_at, p.end_at,
        count(l.id)::int AS leads,
        count(l.id) FILTER (WHERE l.won_at IS NOT NULL OR l.status = 'won')::int AS booked_jobs,
        COALESCE(sum(COALESCE(l.revenue_cents, 0::bigint))
          FILTER (WHERE l.id IS NOT NULL), 0::numeric)::bigint AS revenue_cents,
        COALESCE(sum(COALESCE(l.paid_amount_cents, 0::bigint))
          FILTER (WHERE l.id IS NOT NULL), 0::numeric)::bigint AS paid_cents,
        COALESCE(sum(GREATEST(
          COALESCE(l.invoice_total_cents, 0::bigint) - COALESCE(l.paid_amount_cents, 0::bigint),
          0::bigint
        )) FILTER (WHERE l.id IS NOT NULL), 0::numeric)::bigint AS unpaid_cents,
        (percentile_cont(0.5::double precision) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (l.first_response_at - l.created_at)) / 60.0::numeric
        ) FILTER (
          WHERE l.first_response_at IS NOT NULL AND l.first_response_at >= l.created_at
        ))::double precision AS median_response_minutes
      FROM periods p
      LEFT JOIN leads l ON l.created_at >= p.start_at AND l.created_at < p.end_at
        AND l.is_test = false AND l.status <> 'spam'
      GROUP BY p.period, p.start_at, p.end_at
      ORDER BY CASE p.period WHEN 'current' THEN 0 ELSE 1 END
    `,
    sql`
      WITH params AS (
        SELECT ${anchor}::timestamptz AS current_end, ${days}::int AS day_count
      ), periods AS (
        SELECT 'current'::text AS period,
          current_end - (day_count * interval '1 day') AS start_at,
          current_end AS end_at
        FROM params
        UNION ALL
        SELECT 'prior'::text AS period,
          current_end - ((day_count * 2::int) * interval '1 day') AS start_at,
          current_end - (day_count * interval '1 day') AS end_at
        FROM params
      ), source_counts AS (
        SELECT p.period,
          CASE
            WHEN btrim(l.utm_source) <> '' THEN left(lower(btrim(l.utm_source)), 80::int)
            WHEN btrim(l.gclid) <> '' THEN 'google ads'::text
            WHEN btrim(l.source) <> '' THEN left(lower(btrim(l.source)), 80::int)
            ELSE 'unknown'::text
          END AS source_label,
          count(l.id)::int AS leads,
          count(l.id) FILTER (WHERE l.won_at IS NOT NULL OR l.status = 'won')::int AS booked_jobs
        FROM periods p
        JOIN leads l ON l.created_at >= p.start_at AND l.created_at < p.end_at
          AND l.is_test = false AND l.status <> 'spam'
        GROUP BY p.period, source_label
      ), top_sources AS (
        SELECT source_label
        FROM source_counts
        GROUP BY source_label
        ORDER BY sum(leads) DESC, source_label ASC
        LIMIT 7::bigint
      )
      SELECT sc.period,
        CASE WHEN ts.source_label IS NULL THEN 'other'::text ELSE sc.source_label END AS source,
        sum(sc.leads)::int AS leads,
        sum(sc.booked_jobs)::int AS booked_jobs
      FROM source_counts sc
      LEFT JOIN top_sources ts ON ts.source_label = sc.source_label
      GROUP BY sc.period, CASE WHEN ts.source_label IS NULL THEN 'other'::text ELSE sc.source_label END
      ORDER BY sum(sc.leads) DESC, source ASC, sc.period ASC
    `,
  ])

  const summaries = (summaryRows as SummaryRow[]).map(toPeriod)
  const current = summaries.find((period) => period.key === "current") ?? emptyPeriod("current", anchor, days)
  const prior = summaries.find((period) => period.key === "prior") ?? emptyPeriod("prior", anchor, days)
  const sourcesByName = new Map<string, OwnerAnalyticsSource>()

  for (const row of sourceRows as SourceRow[]) {
    const source = row.source || "unknown"
    const item = sourcesByName.get(source) ?? {
      source,
      currentLeads: 0,
      currentBookedJobs: 0,
      priorLeads: 0,
      priorBookedJobs: 0,
    }
    if (row.period === "current") {
      item.currentLeads = Math.max(0, finiteNumber(row.leads))
      item.currentBookedJobs = Math.max(0, finiteNumber(row.booked_jobs))
    } else {
      item.priorLeads = Math.max(0, finiteNumber(row.leads))
      item.priorBookedJobs = Math.max(0, finiteNumber(row.booked_jobs))
    }
    sourcesByName.set(source, item)
  }

  const sources = [...sourcesByName.values()].sort((a, b) => {
    if (a.source === "other") return 1
    if (b.source === "other") return -1
    return (b.currentLeads + b.priorLeads) - (a.currentLeads + a.priorLeads) || a.source.localeCompare(b.source)
  })

  return { generatedAt: anchor, days, current, prior, sources }
}
