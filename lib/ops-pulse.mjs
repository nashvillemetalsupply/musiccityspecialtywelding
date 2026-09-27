import {
  OWNER_ONLY_EVENT_KINDS,
  OWNER_ONLY_EVENT_NAMESPACE_PATTERN,
  OWNER_ONLY_EVENT_SENSITIVITIES,
} from "./event-visibility.mjs"

function firstRow(rows) {
  return Array.isArray(rows) ? rows[0] ?? {} : {}
}

function timestamp(value) {
  if (value == null || value === "") return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function readOpsPulse(sql, role) {
  const rows = role === "owner"
    ? await sql`
      SELECT
        (SELECT e.id::text FROM events e ORDER BY e.id DESC LIMIT 1) AS event_id,
        (SELECT c.updated_at FROM calls c ORDER BY c.updated_at DESC NULLS LAST, c.id DESC LIMIT 1) AS calls_updated_at`
    : await sql`
      SELECT
        (SELECT e.id::text
          FROM events e
          LEFT JOIN leads l ON l.id = e.lead_id
          LEFT JOIN people p ON p.id = e.person_id
          LEFT JOIN people lead_person ON lead_person.id = l.person_id
          WHERE COALESCE(l.is_test, false) = false
            AND COALESCE(p.is_test, false) = false
            AND COALESCE(lead_person.is_test, false) = false
            AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
            AND concat_ws(' ', l.first_name, l.last_name, l.service, l.message, l.notes,
              p.display_name, p.company, p.phones::text, p.emails::text,
              lead_person.display_name, lead_person.company,
              lead_person.phones::text, lead_person.emails::text,
              e.body, e.crew_body, e.detail::text) NOT ILIKE '%[INTERNAL TEST]%'
            AND lower(e.kind) <> ALL(${OWNER_ONLY_EVENT_KINDS}::text[])
            AND lower(e.kind) !~ ${OWNER_ONLY_EVENT_NAMESPACE_PATTERN}::text
            AND lower(COALESCE(e.detail->>'sensitivity', '')) <> ALL(${OWNER_ONLY_EVENT_SENSITIVITIES}::text[])
          ORDER BY e.id DESC LIMIT 1) AS event_id,
        (SELECT c.updated_at
          FROM calls c
          LEFT JOIN leads l ON l.id = c.lead_id
          LEFT JOIN people p ON p.id = c.person_id
          LEFT JOIN call_intake_drafts d ON d.call_sid = c.twilio_sid
          WHERE lower(COALESCE(c.detail->>'isTest', 'false')) <> 'true'
            AND COALESCE(l.is_test, false) = false
            AND COALESCE(p.is_test, false) = false
            AND COALESCE(d.is_test, false) = false
            AND COALESCE(c.detail->>'callerName', '') NOT ILIKE '%[INTERNAL TEST]%'
          ORDER BY c.updated_at DESC NULLS LAST, c.id DESC LIMIT 1) AS calls_updated_at`

  const row = firstRow(rows)
  return {
    eventId: row.event_id == null ? null : String(row.event_id),
    callsUpdatedAt: timestamp(row.calls_updated_at),
  }
}

export function createOpsPulseGetHandler({ getOperator, getSql }) {
  return async function GET() {
    const operator = await getOperator()
    if (!operator || (operator.role !== "owner" && operator.role !== "crew")) {
      return Response.json({ error: "Sign in required." }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      })
    }

    try {
      const pulse = await readOpsPulse(getSql(), operator.role)
      return Response.json(pulse, { headers: { "Cache-Control": "no-store" } })
    } catch {
      return Response.json({ error: "Pulse unavailable." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      })
    }
  }
}
