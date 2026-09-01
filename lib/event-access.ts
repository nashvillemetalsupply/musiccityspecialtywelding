import { getSql } from "@/lib/db"
import type { EventRow } from "@/lib/events"
import type { OperatorRole } from "@/lib/operators"
import { projectEventForRole } from "@/lib/visibility"

// Direct receipt ids are untrusted input. Resolve the test partition before
// returning a role projection so guessed ids cannot opt crew into owner-only
// synthetic work.
export async function listReadableEventsById(ids: number[], role: OperatorRole): Promise<EventRow[]> {
  const readableIds = [...new Set(ids
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))]
    .slice(0, 30)
  if (!readableIds.length) return []

  const sql = getSql()
  const rows = (await sql`
    SELECT e.*
    FROM events e
    LEFT JOIN leads event_lead ON event_lead.id = e.lead_id
    LEFT JOIN people event_person ON event_person.id = e.person_id
    LEFT JOIN people lead_person ON lead_person.id = event_lead.person_id
    WHERE e.id = ANY(${readableIds}::bigint[])
      AND (${role}::text = 'owner' OR (
        COALESCE(event_lead.is_test, false) = false
        AND COALESCE(event_person.is_test, false) = false
        AND COALESCE(lead_person.is_test, false) = false
        AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
        AND concat_ws(' ', e.body, e.crew_body, e.detail::text) NOT ILIKE '%[INTERNAL TEST]%'
      ))
    ORDER BY e.occurred_at ASC, e.id ASC`) as EventRow[]

  return rows
    .map((event) => projectEventForRole(event, role))
    .filter((event): event is EventRow => Boolean(event))
}

export async function getReadableEventById(id: number, role: OperatorRole): Promise<EventRow | null> {
  return (await listReadableEventsById([id], role))[0] ?? null
}
