import { getSql } from "@/lib/db"
import type { OperatorRole } from "@/lib/operators"
import { clampPageToTotal, normalizePage } from "@/lib/pagination"
import {
  OWNER_ONLY_EVENT_KINDS,
  OWNER_ONLY_EVENT_NAMESPACE_PATTERN,
  OWNER_ONLY_EVENT_SENSITIVITIES,
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
      SELECT * FROM events WHERE lead_id = ${leadId}::bigint
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${Math.min(Math.max(limit, 1), 500)}::bigint
    ) recent ORDER BY occurred_at ASC, id ASC`) as EventRow[]
}

export async function listLeadEventPage(leadId: number, page = 1, limit = 25, role: OperatorRole = "owner"): Promise<{ items: EventRow[]; total: number; page: number; pageSize: number }> {
  const sql = getSql()
  const pageSize = Math.min(Math.max(limit, 1), 25)
  const safePage = normalizePage(page)
  const offset = (safePage - 1) * pageSize
  const rows = (await sql`
    SELECT e.*, count(*) OVER()::int AS full_count
    FROM events e
    WHERE e.lead_id = ${leadId}::bigint
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
        SELECT count(*)::int AS count FROM events
        WHERE lead_id = ${leadId}::bigint
          AND (${role}::text = 'owner' OR (
            NOT (lower(kind) = ANY(${[...OWNER_ONLY_EVENT_KINDS]}::text[]))
            AND lower(kind) !~ ${OWNER_ONLY_EVENT_NAMESPACE_PATTERN}::text
            AND NOT (lower(COALESCE(detail->>'sensitivity', '')) = ANY(${[...OWNER_ONLY_EVENT_SENSITIVITIES]}::text[]))
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
