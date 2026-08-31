import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notify } from "@/lib/notify"
import type { OperatorRole } from "@/lib/operators"
import { projectCommitmentForRole } from "@/lib/visibility"

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
  // Two dedupe keys, because one message is not the unit of a promise.
  //
  // `ON CONFLICT (source_event_id, item_key)` only catches the same event
  // extracted twice. Extraction is handed the open commitments as context and
  // will happily restate one it was shown, so the same promise arrives again
  // under the next event id and that key never fires: Yiorgos's call produced
  // two promises, his follow-up text restated both, and the board printed four.
  // `item_key` cannot catch it either — it hashes the raw due-date string, so
  // the same instant written `…T16:00:00.000Z` and `…-05:00` hashes differently.
  //
  // So the real key is the promise itself: same customer, same direction, same
  // words, same due instant, still open. Nothing is lost by dropping the
  // restatement — a promise made twice is still one promise.
  //
  // The read below is not atomic with the insert, and extraction is NOT
  // serialized across events — a text, an email and a transcript can be
  // extracted at the same moment for one job, and both could pass this check.
  // So `commitments_open_promise_unique` (scripts/migrate.mjs) is the real
  // guard and this read is the cheap path that avoids hitting it. The insert
  // takes a bare ON CONFLICT DO NOTHING so losing that race is not an error.
  const restated = (await sql`
    SELECT id FROM commitments
    WHERE status = 'open'
      AND direction = ${input.direction}::text
      AND btrim(lower(summary)) = btrim(lower(${input.summary}::text))
      AND due_at IS NOT DISTINCT FROM ${input.dueAt ?? null}::timestamptz
      -- Both owners must match, not either. Matching on the person alone
      -- would collapse the same sentence across two of that customer's jobs,
      -- which are two real promises. A subjectless commitment (both null)
      -- matches nothing here and keeps only the same-event key below.
      AND (${input.leadId ?? null}::bigint IS NOT NULL OR ${input.personId ?? null}::bigint IS NOT NULL)
      AND lead_id IS NOT DISTINCT FROM ${input.leadId ?? null}::bigint
      AND person_id IS NOT DISTINCT FROM ${input.personId ?? null}::bigint
    ORDER BY id ASC LIMIT 1`) as { id: number }[]
  if (restated[0]) return Number(restated[0].id)
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
    ) ON CONFLICT DO NOTHING
    RETURNING id`) as { id: number }[]
  if (rows[0]) return Number(rows[0].id)
  // Nothing inserted: either this event was already extracted (same-event key)
  // or another event won the race and its row now holds the promise. Ask for
  // both, same-event first, and hand back whichever exists.
  const existing = (await sql`
    SELECT id FROM commitments
    WHERE (source_event_id = ${input.sourceEventId}::bigint AND item_key = ${itemKey}::text)
      OR (
        status = 'open'
        AND direction = ${input.direction}::text
        AND btrim(lower(summary)) = btrim(lower(${input.summary}::text))
        AND due_at IS NOT DISTINCT FROM ${input.dueAt ?? null}::timestamptz
        AND (${input.leadId ?? null}::bigint IS NOT NULL OR ${input.personId ?? null}::bigint IS NOT NULL)
        AND lead_id IS NOT DISTINCT FROM ${input.leadId ?? null}::bigint
        AND person_id IS NOT DISTINCT FROM ${input.personId ?? null}::bigint
      )
    ORDER BY (source_event_id = ${input.sourceEventId}::bigint) DESC, id ASC
    LIMIT 1`) as { id: number }[]
  return existing[0] ? Number(existing[0].id) : null
}

export async function listCommitments(input: {
  leadId?: number | null
  personId?: number | null
  status?: CommitmentStatus | null
  limit?: number
  includeTests?: boolean
}): Promise<CommitmentRow[]> {
  const sql = getSql()
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 300)
  const includeTests = input.includeTests ?? false
  return (await sql`
    SELECT c.* FROM commitments c
    LEFT JOIN leads l ON l.id = c.lead_id
    LEFT JOIN people p ON p.id = COALESCE(c.person_id, l.person_id)
    LEFT JOIN events source ON source.id = c.source_event_id
    LEFT JOIN leads source_lead ON source_lead.id = source.lead_id
    LEFT JOIN people source_person ON source_person.id = source.person_id
    WHERE (${input.leadId ?? null}::bigint IS NULL OR c.lead_id = ${input.leadId ?? null}::bigint)
      AND (${input.personId ?? null}::bigint IS NULL OR c.person_id = ${input.personId ?? null}::bigint)
      AND (${includeTests}::boolean OR (
        COALESCE(l.is_test, false) = false
        AND COALESCE(p.is_test, false) = false
        AND COALESCE(source_lead.is_test, false) = false
        AND COALESCE(source_person.is_test, false) = false
        AND lower(COALESCE(source.detail->>'isTest', 'false')) <> 'true'
      ))
      -- 'broken' is derived, not stored (see getPromiseSummary). Asked for it
      -- literally, this returned nothing forever, so Ask Jobs could answer
      -- "no broken promises" while the board showed several.
      -- 'open' stays every open promise, overdue included: the work order's
      -- promise list is built from it, and that is where an overdue promise
      -- gets handled. Open is a superset of broken here, deliberately.
      AND (
        ${input.status ?? null}::text IS NULL
        OR (${input.status ?? null}::text = 'broken'
            AND c.status = 'open' AND c.due_at IS NOT NULL AND c.due_at < now())
        OR (${input.status ?? null}::text <> 'broken'
            AND c.status = ${input.status ?? null}::text)
      )
    ORDER BY c.due_at ASC NULLS LAST, c.created_at DESC
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
 * - Two axes, and the pane says so. Kept is scoped to the current Central month
 *   by status_changed_at — this month's scorecard. Open and broken are both
 *   right now, because a promise made last month and still owed is still work,
 *   and scoping it would let the overdue callout name a promise the Open count
 *   said did not exist.
 * - Broken is derived, not stored. Nothing in this codebase ever wrote
 *   `status = 'broken'` — the counter read a status no path set, so the board
 *   reported a shop that had never missed once. A promise is broken when its
 *   date has passed and it is still owed: `open` and past due. Open counts the
 *   rest, so the two split every open promise and never double-count one.
 *   Keeping it late still moves it to `kept`, which is the truth — the shop did
 *   the thing. If lateness needs its own number, `status_changed_at > due_at`
 *   on a kept row is already the whole answer.
 * - `canceled` and `superseded` are counted nowhere. `superseded` is the
 *   correction mechanism, so counting it and its replacement double-counts one
 *   promise. Nothing on the pane claims the three sum to promises made.
 *
 * commitments carries no is_test of its own, so the commitment owners and its
 * source event owners are checked. A source detail or text marker also
 * disqualifies the row. The overdue callout is projected for the operator role
 * before this function returns anything to the board.
 */
export async function getPromiseSummary(role: OperatorRole): Promise<PromiseSummary> {
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
          WHERE c.status = 'open' AND c.due_at IS NOT NULL AND c.due_at < now()
        )::int AS broken,
        count(*) FILTER (
          WHERE c.status = 'open' AND (c.due_at IS NULL OR c.due_at >= now())
        )::int AS open
      FROM commitments c
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN people p ON p.id = COALESCE(c.person_id, l.person_id)
      LEFT JOIN events source ON source.id = c.source_event_id
      LEFT JOIN leads source_lead ON source_lead.id = source.lead_id
      LEFT JOIN people source_person ON source_person.id = COALESCE(source.person_id, source_lead.person_id)
      WHERE c.direction = 'we_promised'
        AND COALESCE(l.is_test, false) = false
        AND COALESCE(p.is_test, false) = false
        AND COALESCE(source_lead.is_test, false) = false
        AND COALESCE(source_person.is_test, false) = false
        AND lower(COALESCE(source.detail->>'isTest', 'false')) <> 'true'
        AND concat_ws(' ',
          c.summary, c.crew_summary,
          l.first_name, l.last_name, l.service, l.message, l.notes,
          p.display_name, p.company,
          source_lead.first_name, source_lead.last_name, source_lead.service,
          source_lead.message, source_lead.notes,
          source_person.display_name, source_person.company,
          source.body, source.crew_body, source.detail::text
        ) NOT ILIKE '%[INTERNAL TEST]%'`,
    sql`
      SELECT c.*,
        btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) AS customer_name,
        COALESCE(l.service, '') AS service
      FROM commitments c
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN people p ON p.id = COALESCE(c.person_id, l.person_id)
      LEFT JOIN events source ON source.id = c.source_event_id
      LEFT JOIN leads source_lead ON source_lead.id = source.lead_id
      LEFT JOIN people source_person ON source_person.id = COALESCE(source.person_id, source_lead.person_id)
      WHERE c.direction = 'we_promised'
        AND c.status = 'open'
        AND c.due_at IS NOT NULL AND c.due_at < now()
        AND COALESCE(l.is_test, false) = false
        AND COALESCE(p.is_test, false) = false
        AND COALESCE(source_lead.is_test, false) = false
        AND COALESCE(source_person.is_test, false) = false
        AND lower(COALESCE(source.detail->>'isTest', 'false')) <> 'true'
        AND concat_ws(' ',
          c.summary, c.crew_summary,
          l.first_name, l.last_name, l.service, l.message, l.notes,
          p.display_name, p.company,
          source_lead.first_name, source_lead.last_name, source_lead.service,
          source_lead.message, source_lead.notes,
          source_person.display_name, source_person.company,
          source.body, source.crew_body, source.detail::text
        ) NOT ILIKE '%[INTERNAL TEST]%'
      ORDER BY c.due_at ASC
      LIMIT 1`,
  ])
  const summary = (counts as Array<{ kept: number; open: number; broken: number }>)[0]
  const late = (overdue as Array<CommitmentRow & { customer_name: string; service: string }>)[0]
  const projectedLate = late ? projectCommitmentForRole(late, role) : null
  return {
    kept: Number(summary?.kept ?? 0),
    open: Number(summary?.open ?? 0),
    broken: Number(summary?.broken ?? 0),
    overdue: late
      ? {
          id: Number(late.id),
          leadId: late.lead_id === null ? null : Number(late.lead_id),
          summary: projectedLate?.summary ?? "Promise detail is unavailable.",
          dueAt: late.due_at!,
          customerName: role === "owner" ? late.customer_name : "",
          service: role === "owner" ? late.service : "",
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
