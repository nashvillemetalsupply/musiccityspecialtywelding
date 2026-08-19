import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notify } from "@/lib/notify"

export type CommitmentStatus = "open" | "kept" | "broken" | "canceled" | "superseded"

export type CommitmentRow = {
  id: number
  created_at: string
  lead_id: number | null
  person_id: number | null
  direction: "we_promised" | "they_promised"
  operator_id: number | null
  summary: string
  crew_summary: string | null
  due_at: string | null
  status: CommitmentStatus
  status_changed_at: string | null
  status_source_event_id: number | null
  source_event_id: number
  confidence: number
  confirmed_by: number | null
  visible_on_glass: boolean
}

export async function addCommitment(input: {
  leadId?: number | null
  personId?: number | null
  direction: "we_promised" | "they_promised"
  operatorId?: number | null
  summary: string
  crewSummary?: string | null
  dueAt?: string | null
  sourceEventId: number
  confidence: number
  visibleOnGlass?: boolean
  itemKey?: string
}) {
  const sql = getSql()
  const itemKey = input.itemKey || `${input.direction}:${input.summary.trim().toLowerCase()}:${input.dueAt ?? ""}`
  const rows = (await sql`
    INSERT INTO commitments (
      lead_id, person_id, direction, operator_id, summary, crew_summary, due_at,
      source_event_id, confidence, visible_on_glass, item_key
    ) VALUES (
      ${input.leadId ?? null}::bigint,
      ${input.personId ?? null}::bigint,
      ${input.direction}::text,
      ${input.operatorId ?? null}::bigint,
      ${input.summary}::text,
      ${input.crewSummary ?? null}::text,
      ${input.dueAt ?? null}::timestamptz,
      ${input.sourceEventId}::bigint,
      ${input.confidence}::real,
      ${input.visibleOnGlass ?? false}::boolean,
      ${itemKey}::text
    ) ON CONFLICT (source_event_id, item_key) WHERE item_key <> '' DO NOTHING
    RETURNING id`) as { id: number }[]
  if (rows[0]) return Number(rows[0].id)
  const existing = (await sql`
    SELECT id FROM commitments WHERE source_event_id = ${input.sourceEventId}::bigint AND item_key = ${itemKey}::text LIMIT 1`) as { id: number }[]
  return Number(existing[0].id)
}

export async function listCommitments(input: {
  leadId?: number | null
  personId?: number | null
  status?: CommitmentStatus | null
  limit?: number
}): Promise<CommitmentRow[]> {
  const sql = getSql()
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 300)
  return (await sql`
    SELECT * FROM commitments
    WHERE (${input.leadId ?? null}::bigint IS NULL OR lead_id = ${input.leadId ?? null}::bigint)
      AND (${input.personId ?? null}::bigint IS NULL OR person_id = ${input.personId ?? null}::bigint)
      AND (${input.status ?? null}::text IS NULL OR status = ${input.status ?? null}::text)
    ORDER BY due_at ASC NULLS LAST, created_at DESC
    LIMIT ${limit}::bigint`) as CommitmentRow[]
}

export type PromiseSummary = {
  kept: number
  open: number
  broken: number
  overdue: {
    id: number
    leadId: number | null
    summary: string
    dueAt: string
    customerName: string
    service: string
  } | null
}

/**
 * The board's Promises block. Three deliberate boundaries:
 *
 * - `we_promised` only. This is the shop's own reliability; counting what a
 *   customer promised would put their flakiness in the owner's Broken column.
 * - Two axes, and the pane says so. Kept and broken are scoped to the current
 *   Central month by status_changed_at — this month's scorecard. Open is every
 *   open promise right now, because a promise made last month and still owed is
 *   still work, and scoping it would let the overdue callout name a promise the
 *   Open count said did not exist.
 * - `canceled` and `superseded` are counted nowhere. `superseded` is the
 *   correction mechanism, so counting it and its replacement double-counts one
 *   promise. Nothing on the pane claims the three sum to promises made.
 *
 * commitments carries no is_test of its own, so both possible owners are
 * checked: a test lead or a test person disqualifies the row.
 */
export async function getPromiseSummary(): Promise<PromiseSummary> {
  const sql = getSql()
  const [counts, overdue] = await Promise.all([
    sql`
      SELECT
        count(*) FILTER (
          WHERE c.status = 'kept'
            AND c.status_changed_at >= (date_trunc('month', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')
            AND c.status_changed_at < ((date_trunc('month', now() AT TIME ZONE 'America/Chicago') + interval '1 month') AT TIME ZONE 'America/Chicago')
        )::int AS kept,
        count(*) FILTER (
          WHERE c.status = 'broken'
            AND c.status_changed_at >= (date_trunc('month', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')
            AND c.status_changed_at < ((date_trunc('month', now() AT TIME ZONE 'America/Chicago') + interval '1 month') AT TIME ZONE 'America/Chicago')
        )::int AS broken,
        count(*) FILTER (WHERE c.status = 'open')::int AS open
      FROM commitments c
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN people p ON p.id = c.person_id
      WHERE c.direction = 'we_promised'
        AND (l.id IS NULL OR l.is_test = false)
        AND (p.id IS NULL OR p.is_test = false)`,
    sql`
      SELECT c.id, c.lead_id, c.summary, c.due_at,
        btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) AS customer_name,
        COALESCE(l.service, '') AS service
      FROM commitments c
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN people p ON p.id = c.person_id
      WHERE c.direction = 'we_promised'
        AND c.status = 'open'
        AND c.due_at IS NOT NULL AND c.due_at < now()
        AND (l.id IS NULL OR l.is_test = false)
        AND (p.id IS NULL OR p.is_test = false)
      ORDER BY c.due_at ASC
      LIMIT 1`,
  ])
  const summary = (counts as Array<{ kept: number; open: number; broken: number }>)[0]
  const late = (overdue as Array<{
    id: number; lead_id: number | null; summary: string; due_at: string; customer_name: string; service: string
  }>)[0]
  return {
    kept: Number(summary?.kept ?? 0),
    open: Number(summary?.open ?? 0),
    broken: Number(summary?.broken ?? 0),
    overdue: late
      ? {
          id: Number(late.id),
          leadId: late.lead_id === null ? null : Number(late.lead_id),
          summary: late.summary,
          dueAt: late.due_at,
          customerName: late.customer_name,
          service: late.service,
        }
      : null,
  }
}

export async function setCommitmentStatus(input: {
  id: number
  status: CommitmentStatus
  sourceEventId: number
  leadId?: number | null
  personId?: number | null
  confirmedBy?: number | null
}) {
  const sql = getSql()
  const rows = (await sql`
    UPDATE commitments SET
      status = ${input.status}::text,
      status_changed_at = now(),
      status_source_event_id = ${input.sourceEventId}::bigint,
      confirmed_by = COALESCE(${input.confirmedBy ?? null}::bigint, confirmed_by)
    WHERE id = ${input.id}::bigint
      AND status = 'open'
      AND (
        (${input.leadId ?? null}::bigint IS NOT NULL AND lead_id = ${input.leadId ?? null}::bigint)
        OR (${input.personId ?? null}::bigint IS NOT NULL AND person_id = ${input.personId ?? null}::bigint)
      )
    RETURNING id`) as { id: number }[]
  return Boolean(rows[0])
}

/** Quarantines interrupted HANDLE IT sends. A human must verify; the sweep never repeats the text. */
export async function reconcileStaleCommitmentReschedules(limit = 20) {
  const sql = getSql()
  const rows = (await sql`
    UPDATE commitment_reschedules SET status = 'unknown', resolved_at = now()
    WHERE id IN (
      SELECT id FROM commitment_reschedules
      WHERE status = 'sending' AND sending_started_at < now() - interval '10 minutes'
      ORDER BY sending_started_at ASC
      LIMIT ${Math.min(Math.max(limit, 1), 50)}::bigint
    )
    RETURNING id, lead_id, commitment_id, source_event_id, created_by`) as Array<{
      id: number; lead_id: number; commitment_id: number; source_event_id: number; created_by: number
    }>
  for (const row of rows) {
    const leads = (await sql`SELECT person_id, is_test FROM leads WHERE id = ${row.lead_id}::bigint LIMIT 1`) as Array<{ person_id: number | null; is_test: boolean }>
    const eventId = await recordEvent({
      kind: "commitment.reschedule-unknown",
      actorType: "system",
      leadId: row.lead_id,
      personId: leads[0]?.person_id,
      externalId: `reschedule-unknown:${row.id}`,
      body: "Promise update text handoff needs verification.",
      crewBody: "Promise update may have sent. Verify before trying again.",
      detail: { rescheduleId: row.id, commitmentId: row.commitment_id, sourceEventId: row.source_event_id, isTest: leads[0]?.is_test ?? false },
    })
    if (!leads[0]?.is_test) await notify({
      operatorId: row.created_by,
      priority: "digest",
      stock: "red",
      title: "Check this promise text",
      body: "It may have sent. Keep the public date unchanged until verified.",
      crewBody: "The promise text may have sent. Verify before trying again.",
      url: `/ops/leads/${row.lead_id}#promise-${row.commitment_id}`,
      sourceEventId: eventId,
      dedupeKey: `reschedule-unknown:${row.id}`,
    })
  }
  return { reconciled: rows.length }
}
