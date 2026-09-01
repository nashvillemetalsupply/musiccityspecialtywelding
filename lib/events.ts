import { getSql } from "@/lib/db"
import type { OperatorRole } from "@/lib/operators"
import { clampPageToTotal, normalizePage } from "@/lib/pagination"
import {
  OWNER_ONLY_EVENT_KINDS,
  OWNER_ONLY_EVENT_NAMESPACE_PATTERN,
  OWNER_ONLY_EVENT_SENSITIVITIES,
  projectEventForRole,
} from "@/lib/visibility"

export type ActorType = "operator" | "customer" | "system" | "ai"

export type EventRow = {
  id: number
  occurred_at: string
  recorded_at: string
  kind: string
  actor_type: ActorType
  actor_id: string
  lead_id: number | null
  person_id: number | null
  external_id: string
  body: string
  crew_body: string | null
  detail: Record<string, unknown> | null
  processed_at: string | null
  extraction_result: unknown | null
  extraction_status: string
  extraction_attempts: number
  extraction_last_error: string
  extraction_next_attempt_at: string | null
}

export type RecordEventInput = {
  kind: string
  occurredAt?: string | Date | null
  actorType?: ActorType
  actorId?: string | number | null
  leadId?: number | null
  personId?: number | null
  externalId?: string | null
  body?: string | null
  crewBody?: string | null
  detail?: Record<string, unknown> | null
}

// Immutable event writer. Provider retries are idempotent by (kind, external_id).
export async function recordEvent(input: RecordEventInput): Promise<number | null> {
  const sql = getSql()
  const occurredAt = input.occurredAt
    ? new Date(input.occurredAt).toISOString()
    : new Date().toISOString()
  const externalId = input.externalId?.trim() ?? ""
  const detail = input.detail ? JSON.stringify(input.detail) : null
  const rows = externalId
    ? ((await sql`
        INSERT INTO events (
          occurred_at, kind, actor_type, actor_id, lead_id, person_id,
          external_id, body, crew_body, detail
        ) VALUES (
          ${occurredAt}::timestamptz,
          ${input.kind}::text,
          ${input.actorType ?? "system"}::text,
          ${String(input.actorId ?? "")}::text,
          ${input.leadId ?? null}::bigint,
          ${input.personId ?? null}::bigint,
          ${externalId}::text,
          ${input.body ?? ""}::text,
          ${input.crewBody ?? null}::text,
          ${detail}::jsonb
        )
        ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
        RETURNING id`) as { id: number }[])
    : ((await sql`
        INSERT INTO events (
          occurred_at, kind, actor_type, actor_id, lead_id, person_id,
          external_id, body, crew_body, detail
        ) VALUES (
          ${occurredAt}::timestamptz,
          ${input.kind}::text,
          ${input.actorType ?? "system"}::text,
          ${String(input.actorId ?? "")}::text,
          ${input.leadId ?? null}::bigint,
          ${input.personId ?? null}::bigint,
          ''::text,
          ${input.body ?? ""}::text,
          ${input.crewBody ?? null}::text,
          ${detail}::jsonb
        ) RETURNING id`) as { id: number }[])
  return rows[0] ? Number(rows[0].id) : null
}

export async function getEvent(id: number): Promise<EventRow | null> {
  const sql = getSql()
  const rows = (await sql`SELECT * FROM events WHERE id = ${id}::bigint LIMIT 1`) as EventRow[]
  return rows[0] ?? null
}

export async function listLeadEvents(leadId: number, limit = 300): Promise<EventRow[]> {
  const sql = getSql()
  return (await sql`
    SELECT * FROM (
      SELECT e.* FROM events e
      LEFT JOIN leads routed_source ON routed_source.id = e.lead_id
      WHERE e.lead_id = ${leadId}::bigint
        OR routed_source.routed_to_lead_id = ${leadId}::bigint
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT ${Math.min(Math.max(limit, 1), 500)}::bigint
    ) recent ORDER BY occurred_at ASC, id ASC`) as EventRow[]
}

// One visibility-safe query for the short receipt trail behind every board
// row. Rank newest-first so the limit keeps the right four, then return each
// lead's retained slice oldest-first for chronological rendering.
export async function listBoardEventTrails(
  leadIds: readonly number[],
  role: OperatorRole,
  limit = 4,
  includeTests = false,
): Promise<Map<number, EventRow[]>> {
  const byLead = new Map<number, EventRow[]>()
  const ids = [...new Set(leadIds.filter((id) => Number.isInteger(id) && id > 0).map(Number))]
  if (!ids.length) return byLead

  const sql = getSql()
  const bounded = Math.min(Math.max(Math.floor(limit), 1), 12)
  const rows = (await sql`
    WITH ranked AS (
      SELECT e.*,
        COALESCE(l.routed_to_lead_id, e.lead_id) AS projected_lead_id,
        row_number() OVER (
          PARTITION BY COALESCE(l.routed_to_lead_id, e.lead_id)
          ORDER BY e.occurred_at DESC, e.id DESC
        ) AS trail_rank
      FROM events e
      JOIN leads l ON l.id = e.lead_id
      LEFT JOIN people p ON p.id = e.person_id
      LEFT JOIN people lead_person ON lead_person.id = l.person_id
      WHERE COALESCE(l.routed_to_lead_id, e.lead_id) = ANY(${ids}::bigint[])
        AND (${includeTests}::boolean OR (
          l.is_test = false
          AND COALESCE(p.is_test, false) = false
          AND COALESCE(lead_person.is_test, false) = false
          AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
          AND concat_ws(' ', l.first_name, l.last_name, l.service, l.message, l.notes,
            p.display_name, p.company, p.phones::text, p.emails::text,
            lead_person.display_name, lead_person.company,
            lead_person.phones::text, lead_person.emails::text,
            e.body, e.crew_body, e.detail::text) NOT ILIKE '%[INTERNAL TEST]%'
        ))
        AND (${role}::text = 'owner' OR (
          NOT (lower(e.kind) = ANY(${[...OWNER_ONLY_EVENT_KINDS]}::text[]))
          AND lower(e.kind) !~ ${OWNER_ONLY_EVENT_NAMESPACE_PATTERN}::text
          AND NOT (lower(COALESCE(e.detail->>'sensitivity', '')) = ANY(${[...OWNER_ONLY_EVENT_SENSITIVITIES]}::text[]))
        ))
    )
    SELECT * FROM ranked
    WHERE trail_rank <= ${bounded}::bigint
    ORDER BY projected_lead_id ASC, occurred_at ASC, id ASC`) as Array<EventRow & { projected_lead_id: number; trail_rank: number }>

  for (const { trail_rank, projected_lead_id, ...event } of rows) {
    void trail_rank
    const projected = projectEventForRole({ ...event, lead_id: Number(projected_lead_id) }, role)
    if (!projected || projected.lead_id === null) continue
    const leadId = Number(projected.lead_id)
    const trail = byLead.get(leadId) ?? []
    trail.push(projected)
    byLead.set(leadId, trail)
  }
  return byLead
}

export type TodayEventRow = EventRow & { customer: string | null }

const TODAY_CALL_KINDS = new Set([
  "call.in",
  "call.answered",
  "call.missed",
  "call.out",
  "call.recording",
  "call.transcript",
])

function todayCallKey(event: TodayEventRow) {
  if (!TODAY_CALL_KINDS.has(event.kind)) return ""
  const detailSid = typeof event.detail?.callSid === "string" ? event.detail.callSid.trim() : ""
  if (detailSid) return detailSid
  const externalId = event.external_id.trim()
  if (["call.answered", "call.missed", "call.out"].includes(event.kind)) {
    return externalId.replace(/:(?:answered|missed|completed)$/i, "")
  }
  return event.kind === "call.in" ? externalId : ""
}

// A call produces several immutable receipts: ring, answer, recording and
// notes. Those receipts remain separate in the full record, but printing each
// as a separate Today item makes one real-world interaction look like four
// jobs. Collapse only the short board projection, keyed by the provider call
// id, and keep the newest receipt as the list position.
function collapseTodayCalls(events: TodayEventRow[]): TodayEventRow[] {
  const grouped = new Map<string, TodayEventRow[]>()
  for (const event of events) {
    const callKey = todayCallKey(event)
    const key = callKey ? `call:${callKey}` : `event:${event.id}`
    const group = grouped.get(key) ?? []
    group.push(event)
    grouped.set(key, group)
  }

  return [...grouped.values()].map((group) => {
    if (group.length === 1 || !todayCallKey(group[0])) return group[0]
    const kinds = new Set(group.map((event) => event.kind))
    const representative = group.find((event) => event.kind === "call.missed")
      ?? group.find((event) => event.kind === "call.answered")
      ?? group.find((event) => event.kind === "call.out")
      ?? group.find((event) => event.kind === "call.in")
      ?? group[0]
    const durationSec = group
      .map((event) => Number(event.detail?.durationSec))
      .find((value) => Number.isFinite(value) && value > 0)
    const summary = [
      kinds.has("call.missed") ? "Missed" : kinds.has("call.answered") ? "Answered" : kinds.has("call.out") ? "Completed" : "Call filed",
      durationSec ? `${Math.max(1, Math.round(durationSec / 60))} min` : "",
      kinds.has("call.transcript") ? "notes saved" : "",
      kinds.has("call.recording") ? "recording saved" : "",
    ].filter(Boolean).join(" · ")
    const newest = group[0]
    return {
      ...representative,
      id: newest.id,
      occurred_at: newest.occurred_at,
      recorded_at: newest.recorded_at,
      body: summary,
      crew_body: summary,
      customer: group.find((event) => event.customer)?.customer ?? null,
    }
  })
}

// The trail prints one line per event, and several kinds carry a fixed body —
// a handoff always reads "Pickup or delivery handoff recorded." So four jobs
// handed off in a minute rendered as the same sentence four times, which reads
// as a duplication bug and hides which four jobs moved. The customer is the
// only thing that tells them apart, so it travels with the row.
export async function listTodayEvents(role: OperatorRole = "crew", limit = 4): Promise<TodayEventRow[]> {
  const sql = getSql()
  const bounded = Math.min(Math.max(Math.floor(limit), 1), 12)
  // Pull enough receipts to return `bounded` real-world interactions even
  // when the newest call generated four or five rows of immutable evidence.
  const fetchLimit = Math.min(bounded * 12, 144)
  const rows = (await sql`
    SELECT e.*, NULLIF(btrim(COALESCE(
      NULLIF(btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')), ''),
      NULLIF(btrim(p.display_name), ''),
      ''
    )), '') AS customer
    FROM events e
    LEFT JOIN leads l ON l.id = e.lead_id
    LEFT JOIN people p ON p.id = e.person_id
    WHERE e.occurred_at >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')
      AND e.occurred_at < ((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '1 day') AT TIME ZONE 'America/Chicago')
      AND COALESCE(l.is_test, false) = false
      AND (l.id IS NULL OR l.status <> 'spam')
      AND COALESCE(p.is_test, false) = false
      AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
      -- The marker check the per-job trail already does. Without it a
      -- marker-only test identity reaches the live board, and this row now
      -- prints the customer's name.
      AND concat_ws(' ', l.first_name, l.last_name, l.service, l.message, l.notes,
        e.body, e.crew_body, e.detail::text) NOT ILIKE '%[INTERNAL TEST]%'
      AND (${role}::text = 'owner' OR (
        NOT (lower(e.kind) = ANY(${[...OWNER_ONLY_EVENT_KINDS]}::text[]))
        AND lower(e.kind) !~ ${OWNER_ONLY_EVENT_NAMESPACE_PATTERN}::text
        AND NOT (lower(COALESCE(e.detail->>'sensitivity', '')) = ANY(${[...OWNER_ONLY_EVENT_SENSITIVITIES]}::text[]))
      ))
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT ${fetchLimit}::bigint`) as TodayEventRow[]

  const projected = rows
    .map((event) => {
      const projected = projectEventForRole(event, role)
      return projected ? { ...projected, customer: event.customer } : null
    })
    .filter((event): event is TodayEventRow => Boolean(event))
  return collapseTodayCalls(projected).slice(0, bounded)
}

export async function listLeadEventPage(leadId: number, page = 1, limit = 25, role: OperatorRole = "owner"): Promise<{ items: EventRow[]; total: number; page: number; pageSize: number }> {
  const sql = getSql()
  const pageSize = Math.min(Math.max(limit, 1), 25)
  const safePage = normalizePage(page)
  const offset = (safePage - 1) * pageSize
  const rows = (await sql`
    SELECT e.*, count(*) OVER()::int AS full_count
    FROM events e
    LEFT JOIN leads routed_source ON routed_source.id = e.lead_id
    WHERE (e.lead_id = ${leadId}::bigint OR routed_source.routed_to_lead_id = ${leadId}::bigint)
      AND (${role}::text = 'owner' OR (
        NOT (lower(e.kind) = ANY(${[...OWNER_ONLY_EVENT_KINDS]}::text[]))
        AND lower(e.kind) !~ ${OWNER_ONLY_EVENT_NAMESPACE_PATTERN}::text
        AND NOT (lower(COALESCE(e.detail->>'sensitivity', '')) = ANY(${[...OWNER_ONLY_EVENT_SENSITIVITIES]}::text[]))
      ))
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT ${pageSize}::int OFFSET ${offset}::int`) as Array<EventRow & { full_count: number }>
  const totalRows = rows.length
    ? Number(rows[0].full_count)
    : Number(((await sql`
        SELECT count(*)::int AS count FROM events e
        LEFT JOIN leads routed_source ON routed_source.id = e.lead_id
        WHERE (e.lead_id = ${leadId}::bigint OR routed_source.routed_to_lead_id = ${leadId}::bigint)
          AND (${role}::text = 'owner' OR (
            NOT (lower(e.kind) = ANY(${[...OWNER_ONLY_EVENT_KINDS]}::text[]))
            AND lower(e.kind) !~ ${OWNER_ONLY_EVENT_NAMESPACE_PATTERN}::text
            AND NOT (lower(COALESCE(e.detail->>'sensitivity', '')) = ANY(${[...OWNER_ONLY_EVENT_SENSITIVITIES]}::text[]))
           ))`) as { count: number }[])[0]?.count ?? 0)
  const clampedPage = clampPageToTotal(safePage, totalRows, pageSize)
  if (clampedPage !== safePage) return listLeadEventPage(leadId, clampedPage, pageSize, role)
  return {
    items: rows.map(({ full_count, ...event }) => { void full_count; return event }),
    total: totalRows,
    page: clampedPage,
    pageSize,
  }
}

export async function searchEvents(input: {
  query: string
  leadId?: number | null
  personId?: number | null
  kinds?: string[]
  since?: string | null
  limit?: number
  includeTests?: boolean
  role?: OperatorRole
}): Promise<EventRow[]> {
  const sql = getSql()
  const query = input.query.trim().slice(0, 240)
  const kinds = input.kinds?.slice(0, 20) ?? []
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
  const role = input.role ?? "owner"
  return (await sql`
    SELECT e.* FROM events e
    LEFT JOIN leads l ON l.id = e.lead_id
    LEFT JOIN people p ON p.id = e.person_id
    WHERE (${input.leadId ?? null}::bigint IS NULL OR e.lead_id = ${input.leadId ?? null}::bigint)
      AND (${input.personId ?? null}::bigint IS NULL OR e.person_id = ${input.personId ?? null}::bigint)
      AND (${input.includeTests ?? false}::boolean OR (
        COALESCE(l.is_test, false) = false
        AND COALESCE(p.is_test, false) = false
        AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
      ))
      AND (${kinds.length === 0}::boolean OR e.kind = ANY(${kinds}::text[]))
      AND (${input.since ?? null}::timestamptz IS NULL OR e.occurred_at >= ${input.since ?? null}::timestamptz)
      AND (${role}::text = 'owner' OR (
        NOT (lower(e.kind) = ANY(${[...OWNER_ONLY_EVENT_KINDS]}::text[]))
        AND lower(e.kind) !~ ${OWNER_ONLY_EVENT_NAMESPACE_PATTERN}::text
        AND NOT (lower(COALESCE(e.detail->>'sensitivity', '')) = ANY(${[...OWNER_ONLY_EVENT_SENSITIVITIES]}::text[]))
      ))
      AND (
        ${query}::text = '' OR
        (CASE WHEN ${role}::text = 'owner' THEN e.tsv ELSE e.crew_tsv END)
          @@ websearch_to_tsquery('english', ${query}::text) OR
        (CASE WHEN ${role}::text = 'owner' THEN e.body ELSE COALESCE(e.crew_body, '') END)
          % ${query}::text
      )
    ORDER BY
      CASE WHEN ${query}::text = '' THEN 0
        ELSE ts_rank(
          CASE WHEN ${role}::text = 'owner' THEN e.tsv ELSE e.crew_tsv END,
          websearch_to_tsquery('english', ${query}::text)
        ) END DESC,
      e.occurred_at DESC
    LIMIT ${limit}::bigint`) as EventRow[]
}

export async function markEventProcessed(id: number) {
  const sql = getSql()
  await sql`UPDATE events SET processed_at = now(), extraction_status = 'done', extraction_next_attempt_at = NULL WHERE id = ${id}::bigint`
}
