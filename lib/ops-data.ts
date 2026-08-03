import { getSql } from "@/lib/db"
import type { LeadEventRow, LeadRow, LeadStatus } from "@/lib/leads"
import { LEAD_STATUSES } from "@/lib/leads"

export type LeadFilter = {
  status?: LeadStatus | "all" | "open"
  includeTests?: boolean
  query?: string
  page?: number
}

const OPEN_STATUSES = ["new", "contacted", "qualified", "quoted"] as const

export const PAGE_SIZE = 100

export async function listLeads(filter: LeadFilter = {}): Promise<LeadRow[]> {
  const sql = getSql()
  const status = filter.status ?? "all"
  const includeTests = filter.includeTests ?? false
  const query = filter.query?.trim().slice(0, 80) ?? ""
  const page = Math.max(1, Math.floor(filter.page ?? 1))
  const offset = (page - 1) * PAGE_SIZE

  if (query) {
    const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`
    const rows = await sql`
      SELECT * FROM leads
      WHERE (${includeTests}::boolean OR is_test = false)
        AND (first_name ILIKE ${pattern} OR last_name ILIKE ${pattern}
          OR phone ILIKE ${pattern} OR email ILIKE ${pattern}
          OR service ILIKE ${pattern} OR message ILIKE ${pattern}
          OR notes ILIKE ${pattern} OR public_id ILIKE ${pattern})
      ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`
    return rows as LeadRow[]
  }

  if (status === "open") {
    const rows = await sql`
      SELECT * FROM leads
      WHERE status = ANY(${[...OPEN_STATUSES]})
        AND (${includeTests}::boolean OR is_test = false)
      ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`
    return rows as LeadRow[]
  }
  if (status !== "all" && (LEAD_STATUSES as readonly string[]).includes(status)) {
    const rows = await sql`
      SELECT * FROM leads
      WHERE status = ${status} AND (${includeTests}::boolean OR is_test = false)
      ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`
    return rows as LeadRow[]
  }
  const rows = await sql`
    SELECT * FROM leads
    WHERE (${includeTests}::boolean OR is_test = false)
    ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`
  return rows as LeadRow[]
}

export async function getLead(id: number): Promise<LeadRow | null> {
  const sql = getSql()
  const rows = (await sql`SELECT * FROM leads WHERE id = ${id} LIMIT 1`) as LeadRow[]
  return rows[0] ?? null
}

export async function getLeadEvents(id: number): Promise<LeadEventRow[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT * FROM lead_events WHERE lead_id = ${id} ORDER BY created_at ASC LIMIT 200`
  return rows as LeadEventRow[]
}

export type OpsStats = {
  totalLeads: number
  newLeads: number
  awaitingFirstResponse: number
  leadsLast30Days: number
  medianFirstResponseMinutes: number | null
  followUpsDue: number
  wonJobs: number
  totalRevenueCents: number
  openEstimateValueCents: number
  failedDeliveries: number
  sourceBreakdown: { source: string; count: number; won: number }[]
}

export async function getOpsStats(): Promise<OpsStats> {
  const sql = getSql()
  const [summary] = (await sql`
    SELECT
      count(*)::int AS total_leads,
      count(*) FILTER (WHERE status = 'new')::int AS new_leads,
      count(*) FILTER (WHERE first_response_at IS NULL
        AND status NOT IN ('spam', 'lost', 'won'))::int AS awaiting_first_response,
      count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS leads_30d,
      count(*) FILTER (WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= now()
        AND status NOT IN ('won', 'lost', 'spam'))::int AS follow_ups_due,
      count(*) FILTER (WHERE status = 'won')::int AS won_jobs,
      COALESCE(sum(revenue_cents) FILTER (WHERE status = 'won'), 0)::bigint AS total_revenue_cents,
      COALESCE(sum(estimate_value_cents)
        FILTER (WHERE status IN ('qualified', 'quoted')), 0)::bigint AS open_estimate_cents,
      count(*) FILTER (WHERE email_delivery_status = 'failed')::int AS failed_deliveries,
      (SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60.0)
        FROM leads
        WHERE first_response_at IS NOT NULL AND is_test = false
          AND first_response_at > created_at) AS median_response_minutes
    FROM leads
    WHERE is_test = false`) as Record<string, unknown>[]

  const sources = (await sql`
    SELECT source,
      count(*)::int AS count,
      count(*) FILTER (WHERE status = 'won')::int AS won
    FROM leads WHERE is_test = false
    GROUP BY source ORDER BY count DESC LIMIT 12`) as {
    source: string
    count: number
    won: number
  }[]

  return {
    totalLeads: Number(summary?.total_leads ?? 0),
    newLeads: Number(summary?.new_leads ?? 0),
    awaitingFirstResponse: Number(summary?.awaiting_first_response ?? 0),
    leadsLast30Days: Number(summary?.leads_30d ?? 0),
    medianFirstResponseMinutes:
      summary?.median_response_minutes === null || summary?.median_response_minutes === undefined
        ? null
        : Number(summary.median_response_minutes),
    followUpsDue: Number(summary?.follow_ups_due ?? 0),
    wonJobs: Number(summary?.won_jobs ?? 0),
    totalRevenueCents: Number(summary?.total_revenue_cents ?? 0),
    openEstimateValueCents: Number(summary?.open_estimate_cents ?? 0),
    failedDeliveries: Number(summary?.failed_deliveries ?? 0),
    sourceBreakdown: sources,
  }
}

// The "needs you now" strip: due follow-ups and unanswered fresh leads.
export async function getNeedsNow(): Promise<{ due: LeadRow[]; unanswered: LeadRow[] }> {
  const sql = getSql()
  const due = (await sql`
    SELECT * FROM leads
    WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= now()
      AND status NOT IN ('won', 'lost', 'spam') AND is_test = false
    ORDER BY next_follow_up_at ASC LIMIT 8`) as LeadRow[]
  const unanswered = (await sql`
    SELECT * FROM leads
    WHERE first_response_at IS NULL AND status NOT IN ('won', 'lost', 'spam')
      AND is_test = false
    ORDER BY created_at ASC LIMIT 8`) as LeadRow[]
  return { due, unanswered }
}

export async function getMonthRevenueCents(): Promise<number> {
  const sql = getSql()
  const rows = (await sql`
    SELECT COALESCE(sum(revenue_cents), 0)::bigint AS cents FROM leads
    WHERE status = 'won' AND won_at >= date_trunc('month', now())
      AND is_test = false`) as { cents: number }[]
  return Number(rows[0]?.cents ?? 0)
}

export async function getStatusCounts(includeTests: boolean): Promise<Record<string, number>> {
  const sql = getSql()
  const rows = (await sql`
    SELECT status, count(*)::int AS count FROM leads
    WHERE (${includeTests}::boolean OR is_test = false)
    GROUP BY status`) as { status: string; count: number }[]
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.status] = row.count
  counts.all = rows.reduce((sum, row) => sum + row.count, 0)
  counts.open = (counts.new ?? 0) + (counts.contacted ?? 0) + (counts.qualified ?? 0) + (counts.quoted ?? 0)
  return counts
}

export async function countFailedDeliveries(): Promise<number> {
  const sql = getSql()
  const rows = (await sql`
    SELECT count(*)::int AS count FROM leads
    WHERE email_delivery_status = 'failed' AND is_test = false`) as { count: number }[]
  return rows[0]?.count ?? 0
}

export async function latestAutomationRun(job: string): Promise<{ ran_at: string; ok: boolean } | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT ran_at, ok FROM automation_runs WHERE job = ${job}
    ORDER BY ran_at DESC LIMIT 1`) as { ran_at: string; ok: boolean }[]
  return rows[0] ?? null
}
