import { getSql } from "@/lib/db"
import type { LeadEventRow, LeadRow, LeadStatus } from "@/lib/leads"
import { LEAD_STATUSES } from "@/lib/leads"
import type { OperatorRole } from "@/lib/operators"
import { clampPageToTotal, normalizePage } from "@/lib/pagination"
import { redactCrewText } from "@/lib/visibility"

export type LeadFilter = {
  status?: LeadStatus | "all" | "open"
  includeTests?: boolean
  query?: string
  page?: number
  pageSize?: number
  includeNext?: boolean
}

export const JOB_BOARD_STAGES = ["board", "attention", "shop", "waiting", "ready"] as const
export type JobBoardStage = (typeof JOB_BOARD_STAGES)[number]
export type BoardJobRow = LeadRow & {
  board_stage: Exclude<JobBoardStage, "board">
  board_reason: string
  board_since: string
}

export type BoardJobPage = {
  items: BoardJobRow[]
  counts: Record<JobBoardStage, number>
  resultTotal: number
  page: number
  pageSize: number
  hasNext: boolean
}

const OPEN_STATUSES = ["new", "contacted", "qualified", "quoted"] as const

// Jobs is a dispatch surface, not an archive. Keep each query bounded;
// search and status filters expose the full history without an endless rail.
export const PAGE_SIZE = 16

export function projectLeadForRole<T extends LeadRow>(lead: T, role: OperatorRole): T {
  if (role === "owner") return lead
  return {
    ...lead,
    estimate_value_cents: null,
    revenue_cents: null,
    paid_amount_cents: null,
    invoice_total_cents: null,
    invoice_number: "",
    invoice_pay_url: "",
    invoiced_at: null,
    invoice_due_at: null,
    paid_at: null,
    service: redactCrewText(lead.service),
    status_reason: redactCrewText(lead.status_reason),
    message: redactCrewText(lead.crew_message || "MCSW Jobs is preparing the crew-safe job request."),
    notes: redactCrewText(lead.crew_notes || "MCSW Jobs is preparing the crew-safe shop notes."),
    email_delivery_error: redactCrewText(lead.email_delivery_error),
    glass_caption_draft: redactCrewText(lead.glass_caption_draft),
    photos: lead.photos.map((photo, index) => ({ ...photo, name: `Job photo ${index + 1}` })),
  }
}

export async function listLeads(filter: LeadFilter = {}, role: OperatorRole = "crew"): Promise<LeadRow[]> {
  const sql = getSql()
  const status = filter.status ?? "all"
  const includeTests = filter.includeTests ?? false
  const query = filter.query?.trim().slice(0, 80) ?? ""
  const page = Math.max(1, Math.floor(filter.page ?? 1))
  const pageSize = Math.min(Math.max(Math.floor(filter.pageSize ?? PAGE_SIZE), 1), 50)
  const limit = pageSize + (filter.includeNext ? 1 : 0)
  const offset = (page - 1) * pageSize

  if (query) {
    const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`
    const rows = await sql`
      SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name
      FROM leads l LEFT JOIN operators o ON o.id = l.assigned_operator_id
      WHERE (${includeTests}::boolean OR l.is_test = false)
        AND (
          ${status}::text = 'all'
          OR (${status}::text = 'open' AND (l.status = ANY(${[...OPEN_STATUSES]}::text[]) OR (l.status = 'won' AND l.completed_at IS NULL)))
          OR (${status}::text = 'won' AND l.completed_at IS NOT NULL)
          OR (${status}::text NOT IN ('all','open','won') AND l.status = ${status}::text)
        )
        AND (l.first_name ILIKE ${pattern}::text OR l.last_name ILIKE ${pattern}::text
          OR l.phone ILIKE ${pattern}::text OR l.email ILIKE ${pattern}::text
          OR l.service ILIKE ${pattern}::text
          OR (CASE WHEN ${role}::text = 'owner' THEN l.message ELSE COALESCE(l.crew_message, '') END) ILIKE ${pattern}::text
          OR (CASE WHEN ${role}::text = 'owner' THEN l.notes ELSE COALESCE(l.crew_notes, '') END) ILIKE ${pattern}::text
          OR l.public_id ILIKE ${pattern}::text)
      ORDER BY
        (l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at <= now()) DESC,
        (l.first_response_at IS NULL) DESC,
        l.updated_at DESC
      LIMIT ${limit}::bigint OFFSET ${offset}::bigint`
    return (rows as LeadRow[]).map((lead) => projectLeadForRole(lead, role))
  }

  if (status === "open") {
    const rows = await sql`
      SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name
      FROM leads l LEFT JOIN operators o ON o.id = l.assigned_operator_id
      WHERE (l.status = ANY(${[...OPEN_STATUSES]}::text[]) OR (l.status = 'won' AND l.completed_at IS NULL))
        AND (${includeTests}::boolean OR l.is_test = false)
      ORDER BY
        (l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at <= now()) DESC,
        (l.first_response_at IS NULL) DESC,
        l.updated_at DESC
      LIMIT ${limit}::bigint OFFSET ${offset}::bigint`
    return (rows as LeadRow[]).map((lead) => projectLeadForRole(lead, role))
  }
  if (status === "won") {
    const rows = await sql`
      SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name
      FROM leads l LEFT JOIN operators o ON o.id = l.assigned_operator_id
      WHERE l.completed_at IS NOT NULL AND (${includeTests}::boolean OR l.is_test = false)
      ORDER BY l.completed_at DESC LIMIT ${limit}::bigint OFFSET ${offset}::bigint`
    return (rows as LeadRow[]).map((lead) => projectLeadForRole(lead, role))
  }
  if (status !== "all" && (LEAD_STATUSES as readonly string[]).includes(status)) {
    const rows = await sql`
      SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name
      FROM leads l LEFT JOIN operators o ON o.id = l.assigned_operator_id
      WHERE l.status = ${status}::text AND (${includeTests}::boolean OR l.is_test = false)
      ORDER BY l.created_at DESC LIMIT ${limit}::bigint OFFSET ${offset}::bigint`
    return (rows as LeadRow[]).map((lead) => projectLeadForRole(lead, role))
  }
  const rows = await sql`
    SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name
    FROM leads l LEFT JOIN operators o ON o.id = l.assigned_operator_id
    WHERE (${includeTests}::boolean OR l.is_test = false)
    ORDER BY l.created_at DESC LIMIT ${limit}::bigint OFFSET ${offset}::bigint`
  return (rows as LeadRow[]).map((lead) => projectLeadForRole(lead, role))
}

// The board vocabulary is intentionally operational rather than a mirror of
// the CRM status column. Every label below is derived from durable facts:
// unanswered work is Attention, started/booked work is In Shop, contacted or
// quoted work is Waiting, and completed work is Ready for its final handoff.
export async function listBoardJobs(
  options: {
    stage?: JobBoardStage
    includeTests?: boolean
    query?: string
    page?: number
    pageSize?: number
  } = {},
  role: OperatorRole = "crew"
): Promise<BoardJobPage> {
  const sql = getSql()
  const stage = JOB_BOARD_STAGES.includes(options.stage ?? "board") ? options.stage ?? "board" : "board"
  const includeTests = options.includeTests ?? false
  const query = options.query?.trim().slice(0, 80) ?? ""
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? 5), 1), 12)
  const offset = (page - 1) * pageSize

  const rows = (await sql`
    WITH comms AS (
      SELECT e.lead_id,
        max(e.occurred_at) FILTER (
          WHERE e.kind = ANY(ARRAY['sms.in','email.in','call.missed','glass.uploaded']::text[])
        ) AS inbound_at,
        max(e.occurred_at) FILTER (
          WHERE e.kind = ANY(ARRAY['call.answered','call.out']::text[])
            OR (e.actor_type = 'operator' AND e.kind = ANY(ARRAY['contact.logged','contact.first-response']::text[]))
            OR (e.actor_type = 'operator' AND e.kind = ANY(ARRAY['sms.out','email.out']::text[]))
        ) AS outbound_at
      FROM events e
      WHERE e.lead_id IS NOT NULL
        AND e.kind = ANY(ARRAY[
          'sms.in','email.in','call.missed','glass.uploaded','sms.out','email.out',
          'contact.logged','contact.first-response','call.answered','call.out'
        ]::text[])
      GROUP BY e.lead_id
    ), candidates AS (
      SELECT c.lead_id,
        CASE (
          SELECT e2.kind FROM events e2
          WHERE e2.lead_id = c.lead_id
            AND e2.kind = ANY(ARRAY['sms.in','email.in','call.missed','glass.uploaded']::text[])
          ORDER BY e2.occurred_at DESC, e2.id DESC LIMIT 1
        )
          WHEN 'sms.in' THEN 'Customer text waiting'
          WHEN 'email.in' THEN 'Customer email waiting'
          WHEN 'glass.uploaded' THEN 'New files waiting'
          ELSE 'Missed call'
        END AS reason,
        c.inbound_at AS waiting_since,
        0 AS priority
      FROM comms c
      WHERE c.inbound_at <= now() - interval '30 minutes'
        AND (c.outbound_at IS NULL OR c.outbound_at < c.inbound_at)
      UNION ALL
      SELECT c.lead_id, 'Promise overdue'::text, c.due_at, 1
      FROM commitments c WHERE c.status = 'open' AND c.due_at < now()
      UNION ALL
      SELECT l.id, 'Follow-up due'::text, l.next_follow_up_at, 2
      FROM leads l WHERE l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at <= now()
      UNION ALL
      SELECT l.id, 'Needs a call'::text, l.created_at, 3
      FROM leads l WHERE l.first_response_at IS NULL
      UNION ALL
      SELECT l.id, 'Email did not deliver'::text, l.updated_at, 4
      FROM leads l WHERE l.email_delivery_status = 'failed'
    ), needs AS (
      SELECT DISTINCT ON (lead_id) lead_id, reason, waiting_since
      FROM candidates
      ORDER BY lead_id, priority, waiting_since ASC
    ), board AS (
      SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name,
        CASE
          WHEN l.completed_at IS NOT NULL THEN 'ready'
          WHEN n.lead_id IS NOT NULL THEN 'attention'
          WHEN l.work_started_at IS NOT NULL OR l.status = 'won' THEN 'shop'
          ELSE 'waiting'
        END AS board_stage,
        CASE
          WHEN l.completed_at IS NOT NULL AND l.review_received THEN 'Review received'
          WHEN l.completed_at IS NOT NULL AND l.review_requested_at IS NOT NULL THEN 'Review requested'
          WHEN l.completed_at IS NOT NULL THEN 'Ready for customer'
          WHEN n.lead_id IS NOT NULL THEN n.reason
          WHEN l.work_started_at IS NOT NULL THEN 'Work underway'
          WHEN l.status = 'won' THEN 'Booked'
          WHEN l.status = 'quoted' THEN 'Quote sent'
          WHEN l.status = 'qualified' THEN 'Pricing next'
          WHEN l.status = 'contacted' THEN 'Customer contacted'
          ELSE 'Waiting'
        END AS board_reason,
        COALESCE(n.waiting_since, l.completed_at, l.work_started_at, l.updated_at, l.created_at) AS board_since
      FROM leads l
      LEFT JOIN operators o ON o.id = l.assigned_operator_id
      LEFT JOIN needs n ON n.lead_id = l.id
      WHERE l.status NOT IN ('lost','spam')
        AND (
          l.completed_at IS NULL
          OR (l.completed_at IS NOT NULL AND l.handed_off_at IS NULL)
        )
        AND (${includeTests}::boolean OR l.is_test = false)
    ), board_counts AS (
      SELECT
        count(*)::int AS board_count,
        count(*) FILTER (WHERE board_stage = 'attention')::int AS attention_count,
        count(*) FILTER (WHERE board_stage = 'shop')::int AS shop_count,
        count(*) FILTER (WHERE board_stage = 'waiting')::int AS waiting_count,
        count(*) FILTER (WHERE board_stage = 'ready')::int AS ready_count
      FROM board
    ), filtered AS (
      SELECT b.* FROM board b
      WHERE (${stage}::text = 'board' OR b.board_stage = ${stage}::text)
        AND (
          ${query}::text = ''
          OR b.first_name ILIKE ${pattern}::text
          OR b.last_name ILIKE ${pattern}::text
          OR b.phone ILIKE ${pattern}::text
          OR b.email ILIKE ${pattern}::text
          OR b.service ILIKE ${pattern}::text
          OR (CASE WHEN ${role}::text = 'owner' THEN b.message ELSE COALESCE(b.crew_message, '') END) ILIKE ${pattern}::text
          OR (CASE WHEN ${role}::text = 'owner' THEN b.notes ELSE COALESCE(b.crew_notes, '') END) ILIKE ${pattern}::text
          OR b.public_id ILIKE ${pattern}::text
        )
    ), result_count AS (
      SELECT count(*)::int AS result_total FROM filtered
    ), paged AS (
      SELECT f.* FROM filtered f
      ORDER BY
        CASE f.board_stage WHEN 'attention' THEN 0 WHEN 'shop' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,
        CASE WHEN f.board_stage = 'attention' THEN f.board_since END ASC NULLS LAST,
        f.updated_at DESC,
        f.id DESC
      LIMIT ${pageSize + 1}::int OFFSET ${offset}::int
    )
    SELECT p.*, bc.*, rc.result_total
    FROM board_counts bc
    CROSS JOIN result_count rc
    LEFT JOIN paged p ON true`) as Array<BoardJobRow & {
      board_count: number
      attention_count: number
      shop_count: number
      waiting_count: number
      ready_count: number
      result_total: number
    }>

  const countRow = rows[0]
  const resultTotal = Number(countRow?.result_total ?? 0)
  const lastPage = Math.max(1, Math.ceil(resultTotal / pageSize))
  if (page > lastPage) {
    return listBoardJobs({ ...options, page: lastPage, pageSize }, role)
  }
  const items = rows
    .filter((row) => Number.isInteger(Number(row.id)) && Number(row.id) > 0)
    .slice(0, pageSize)
    .map((row) => projectLeadForRole(row, role))
  return {
    items,
    counts: {
      board: Number(countRow?.board_count ?? 0),
      attention: Number(countRow?.attention_count ?? 0),
      shop: Number(countRow?.shop_count ?? 0),
      waiting: Number(countRow?.waiting_count ?? 0),
      ready: Number(countRow?.ready_count ?? 0),
    },
    resultTotal,
    page,
    pageSize,
    hasNext: rows.filter((row) => Number.isInteger(Number(row.id)) && Number(row.id) > 0).length > pageSize,
  }
}

export async function getLead(id: number, role: OperatorRole = "crew"): Promise<LeadRow | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name,
      CASE WHEN l.person_id IS NULL THEN 1 ELSE (
        SELECT count(*)::int FROM leads sibling
        WHERE sibling.person_id = l.person_id AND sibling.is_test = l.is_test
      ) END AS person_job_count
    FROM leads l LEFT JOIN operators o ON o.id = l.assigned_operator_id
    WHERE l.id = ${id}::bigint LIMIT 1`) as LeadRow[]
  return rows[0] ? projectLeadForRole(rows[0], role) : null
}

export async function getRepeatJobCounts(personIds: Array<number | null>) {
  const ids = [...new Set(personIds.filter((id): id is number => Number.isInteger(id) && Number(id) > 0).map(Number))]
  if (!ids.length) return new Map<number, number>()
  const sql = getSql()
  const rows = (await sql`
    SELECT person_id, count(*)::int AS job_count FROM leads
    WHERE person_id = ANY(${ids}::bigint[]) AND is_test = false
    GROUP BY person_id`) as { person_id: number; job_count: number }[]
  return new Map(rows.map((row) => [Number(row.person_id), Number(row.job_count)]))
}

export async function listTodayJobs(role: OperatorRole = "crew", limit = 8): Promise<LeadRow[]> {
  const sql = getSql()
  const bounded = Math.min(Math.max(Math.floor(limit), 1), 12)
  const rows = (await sql`
    SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name
    FROM leads l LEFT JOIN operators o ON o.id = l.assigned_operator_id
    WHERE l.scheduled_at >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')
      AND l.scheduled_at < ((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '1 day') AT TIME ZONE 'America/Chicago')
      AND l.completed_at IS NULL AND l.status NOT IN ('lost','spam') AND l.is_test = false
    ORDER BY l.scheduled_at ASC, l.updated_at DESC
    LIMIT ${bounded}::bigint`) as LeadRow[]
  return rows.map((lead) => projectLeadForRole(lead, role))
}

export type TodayLeadSummary = {
  total: number
  awaitingFirstResponse: number
  contacted: number
  booked: number
  medianFirstResponseMinutes: number | null
  sources: { source: string; count: number }[]
}

export async function getTodayLeadSummary(): Promise<TodayLeadSummary> {
  const sql = getSql()
  const [summaryRows, sourceRows] = await Promise.all([
    sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (
          WHERE first_response_at IS NULL AND status <> 'lost'
        )::int AS awaiting_first_response,
        count(*) FILTER (WHERE first_response_at IS NOT NULL)::int AS contacted,
        count(*) FILTER (WHERE won_at IS NOT NULL OR status = 'won')::int AS booked,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60.0
        ) FILTER (
          WHERE first_response_at IS NOT NULL AND first_response_at >= created_at
        ) AS median_response_minutes
      FROM leads
      WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')
        AND created_at < ((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '1 day') AT TIME ZONE 'America/Chicago')
        AND is_test = false AND status <> 'spam'`,
    sql`
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
        count(*)::int AS count
      FROM leads
      WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')
        AND created_at < ((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '1 day') AT TIME ZONE 'America/Chicago')
        AND is_test = false AND status <> 'spam'
      GROUP BY 1
      ORDER BY count DESC, source ASC`,
  ])

  const summary = (summaryRows as Record<string, unknown>[])[0]
  const median = summary?.median_response_minutes
  const sourceCounts = (sourceRows as { source: string; count: number | string }[]).map((row) => ({
    source: row.source || "unknown",
    count: Number(row.count),
  }))
  const sources = sourceCounts.slice(0, 6)
  const otherCount = sourceCounts.slice(6).reduce((total, source) => total + source.count, 0)
  if (otherCount > 0) sources.push({ source: "other", count: otherCount })
  return {
    total: Number(summary?.total ?? 0),
    awaitingFirstResponse: Number(summary?.awaiting_first_response ?? 0),
    contacted: Number(summary?.contacted ?? 0),
    booked: Number(summary?.booked ?? 0),
    medianFirstResponseMinutes: median === null || median === undefined ? null : Number(median),
    sources,
  }
}

export async function getLeadEvents(id: number): Promise<LeadEventRow[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT le.id, le.lead_id, le.created_at,
      COALESCE(NULLIF(o.name, ''), le.actor) AS actor,
      le.type, le.detail
    FROM lead_events le
    LEFT JOIN operators o ON o.id::text = le.actor
    WHERE le.id IN (
      SELECT id FROM lead_events WHERE lead_id = ${id}::bigint
      ORDER BY created_at DESC, id DESC LIMIT 200
    )
    ORDER BY le.created_at ASC, le.id ASC`
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
  totalRevenueCents: number | null
  openEstimateValueCents: number | null
  failedDeliveries: number
  sourceBreakdown: { source: string; count: number; won: number }[]
}

export async function getOpsStats(role: OperatorRole = "crew"): Promise<OpsStats> {
  const sql = getSql()
  const [summary] = (await sql`
    SELECT
      count(*)::int AS total_leads,
      count(*) FILTER (WHERE status = 'new')::int AS new_leads,
      count(*) FILTER (WHERE first_response_at IS NULL AND completed_at IS NULL
        AND status NOT IN ('spam', 'lost'))::int AS awaiting_first_response,
      count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS leads_30d,
      count(*) FILTER (WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= now()
        AND completed_at IS NULL AND status NOT IN ('lost', 'spam'))::int AS follow_ups_due,
      count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS won_jobs,
      COALESCE(sum(revenue_cents), 0)::bigint AS total_revenue_cents,
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
      count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS won
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
    totalRevenueCents: role === "owner" ? Number(summary?.total_revenue_cents ?? 0) : null,
    openEstimateValueCents: role === "owner" ? Number(summary?.open_estimate_cents ?? 0) : null,
    failedDeliveries: Number(summary?.failed_deliveries ?? 0),
    sourceBreakdown: sources,
  }
}

export type NeedsNowRow = LeadRow & { reason: string; waiting_since: string }

// Response state is event-based. A customer can need an answer even after the
// first call-back, so compare the latest inbound receipt to the latest reply.
export async function getNeedsNow(options: { page?: number; pageSize?: number } = {}, role: OperatorRole = "crew"): Promise<{ items: NeedsNowRow[]; total: number; page: number; pageSize: number }> {
  const sql = getSql()
  const requestedPage = normalizePage(options.page)
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? 8), 1), 50)
  const offset = (requestedPage - 1) * pageSize
  const items = (await sql`
    WITH comms AS (
      SELECT e.lead_id,
        max(e.occurred_at) FILTER (WHERE e.kind = ANY(ARRAY['sms.in','email.in','call.missed','glass.uploaded']::text[])) AS inbound_at,
        max(e.occurred_at) FILTER (
          WHERE e.kind = ANY(ARRAY['call.answered','call.out']::text[])
            OR (e.actor_type = 'operator' AND e.kind = ANY(ARRAY['contact.logged','contact.first-response']::text[]))
            OR (
              e.actor_type = 'operator' AND e.kind = 'sms.out'
              AND EXISTS (
                SELECT 1 FROM messages m
                WHERE m.id = CASE WHEN e.detail->>'messageId' ~ '^\d+$' THEN (e.detail->>'messageId')::bigint ELSE NULL END
                  AND m.status = ANY(ARRAY['queued','accepted','sent','delivered']::text[])
              )
            )
            OR (
              e.actor_type = 'operator' AND e.kind = 'email.out'
              AND (
                e.detail->>'deliveryStatus' = 'delivered'
                OR (
                  EXISTS (SELECT 1 FROM events accepted WHERE accepted.kind = ANY(ARRAY['email.accepted','email.delivered']::text[]) AND accepted.detail->>'sourceEventId' = e.id::text)
                  AND NOT EXISTS (SELECT 1 FROM events failed WHERE failed.kind = 'email.failed' AND failed.detail->>'sourceEventId' = e.id::text)
                )
              )
            )
        ) AS outbound_at
      FROM events e
      WHERE e.lead_id IS NOT NULL
        AND e.kind = ANY(ARRAY['sms.in','email.in','call.missed','glass.uploaded','sms.out','email.out','contact.logged','contact.first-response','call.answered','call.out']::text[])
      GROUP BY e.lead_id
    ), candidates AS (
      SELECT c.lead_id,
        CASE (
          SELECT e2.kind FROM events e2
          WHERE e2.lead_id = c.lead_id AND e2.kind = ANY(ARRAY['sms.in','email.in','call.missed','glass.uploaded']::text[])
          ORDER BY e2.occurred_at DESC LIMIT 1
        )
          WHEN 'sms.in' THEN 'customer text waiting'
          WHEN 'email.in' THEN 'customer email waiting'
          WHEN 'glass.uploaded' THEN 'customer files waiting'
          ELSE 'missed call waiting'
        END AS reason,
        c.inbound_at AS waiting_since, 0 AS priority
      FROM comms c
      WHERE c.inbound_at <= now() - interval '30 minutes'
        AND (c.outbound_at IS NULL OR c.outbound_at < c.inbound_at)
      UNION ALL
      SELECT c.lead_id, 'overdue promise'::text, c.due_at, 1
      FROM commitments c WHERE c.status = 'open' AND c.due_at < now()
      UNION ALL
      SELECT l.id, 'follow-up due'::text, l.next_follow_up_at, 2
      FROM leads l WHERE l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at <= now()
      UNION ALL
      SELECT l.id, 'no call back yet'::text, l.created_at, 3
      FROM leads l WHERE l.first_response_at IS NULL
    ), ranked AS (
      SELECT DISTINCT ON (lead_id) lead_id, reason, waiting_since, priority
      FROM candidates
      ORDER BY lead_id, priority, waiting_since ASC
    )
    SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name,
      r.reason, r.waiting_since, count(*) OVER()::int AS total_count
    FROM ranked r
    JOIN leads l ON l.id = r.lead_id
    LEFT JOIN operators o ON o.id = l.assigned_operator_id
    WHERE l.completed_at IS NULL AND l.status NOT IN ('lost','spam') AND l.is_test = false
    ORDER BY r.priority ASC, r.waiting_since ASC
    LIMIT ${pageSize}::bigint OFFSET ${offset}::bigint`) as Array<NeedsNowRow & { total_count: number }>
  const total = Number(items[0]?.total_count ?? 0)
  if (items.length === 0 && requestedPage > 1) {
    const firstPage = await getNeedsNow({ page: 1, pageSize: 1 }, role)
    if (firstPage.total === 0) return { items: [], total: 0, page: 1, pageSize }
    return getNeedsNow({ page: clampPageToTotal(requestedPage, firstPage.total, pageSize), pageSize }, role)
  }
  return { items: items.map((lead) => projectLeadForRole(lead, role)), total, page: requestedPage, pageSize }
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
    SELECT status, (completed_at IS NOT NULL) AS completed, count(*)::int AS count FROM leads
    WHERE (${includeTests}::boolean OR is_test = false)
    GROUP BY status, (completed_at IS NOT NULL)`) as { status: string; completed: boolean; count: number }[]
  const counts: Record<string, number> = {}
  let paidButOpen = 0
  for (const row of rows) {
    if (row.status === "won" && !row.completed) paidButOpen += row.count
    else counts[row.status] = (counts[row.status] ?? 0) + row.count
  }
  counts.all = rows.reduce((sum, row) => sum + row.count, 0)
  counts.open = (counts.new ?? 0) + (counts.contacted ?? 0) + (counts.qualified ?? 0) + (counts.quoted ?? 0) + paidButOpen
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
    SELECT ran_at, ok FROM automation_runs WHERE job = ${job}::text
    ORDER BY ran_at DESC LIMIT 1`) as { ran_at: string; ok: boolean }[]
  return rows[0] ?? null
}
