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
