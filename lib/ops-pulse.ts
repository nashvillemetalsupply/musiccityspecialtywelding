import {
  OWNER_ONLY_EVENT_KINDS,
  OWNER_ONLY_EVENT_NAMESPACE_PATTERN,
  OWNER_ONLY_EVENT_SENSITIVITIES,
} from "./event-visibility.ts"

function firstRow(rows) {
  return Array.isArray(rows) ? rows[0] ?? {} : {}
}

function timestamp(value) {
  if (value == null || value === "") return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function readOpsPulse(sql, role, operatorId = null) {
  const rows = await sql`
    WITH latest_visible_events AS (
      SELECT e.id, e.kind, e.body, e.crew_body, e.detail, e.occurred_at,
        e.processed_at, e.extraction_status
      FROM events e
      LEFT JOIN leads l ON l.id = e.lead_id
      LEFT JOIN people p ON p.id = e.person_id
      LEFT JOIN people lead_person ON lead_person.id = l.person_id
      WHERE ${role}::text = 'owner' OR (
        COALESCE(l.is_test, false) = false
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
      )
      ORDER BY e.id DESC
      LIMIT 20
    ), latest_calls AS (
      SELECT DISTINCT ON (c.id) c.id, c.twilio_sid, c.status, c.duration_sec, c.updated_at
      FROM calls c
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN people p ON p.id = c.person_id
      LEFT JOIN call_intake_drafts d ON d.call_sid = c.twilio_sid
      WHERE ${role}::text = 'owner' OR (
        lower(COALESCE(c.detail->>'isTest', 'false')) <> 'true'
        AND COALESCE(l.is_test, false) = false
        AND COALESCE(p.is_test, false) = false
        AND COALESCE(d.is_test, false) = false
        AND COALESCE(c.detail->>'callerName', '') NOT ILIKE '%[INTERNAL TEST]%'
      )
      ORDER BY c.id DESC
      LIMIT 20
    ), latest_sketches AS (
      SELECT s.call_sid, s.status, s.observed_through_sequence, s.updated_at
      FROM call_sketches s
      JOIN calls c ON c.twilio_sid = s.call_sid
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN people p ON p.id = c.person_id
      LEFT JOIN call_intake_drafts d ON d.call_sid = c.twilio_sid
      WHERE ${role}::text = 'owner' OR (
        lower(COALESCE(c.detail->>'isTest', 'false')) <> 'true'
        AND COALESCE(l.is_test, false) = false
        AND COALESCE(p.is_test, false) = false
        AND COALESCE(d.is_test, false) = false
        AND COALESCE(c.detail->>'callerName', '') NOT ILIKE '%[INTERNAL TEST]%'
      )
      ORDER BY s.updated_at DESC NULLS LAST, s.call_sid DESC
      LIMIT 20
    ), latest_transcript_items AS (
      SELECT ls.call_sid, item.sequence_id, item.track, item.is_final, item.transcript,
        item.stability, item.confidence, item.provider_timestamp
      FROM latest_sketches ls
      JOIN LATERAL (
        SELECT sequence_id, track, is_final, transcript, stability, confidence, provider_timestamp
        FROM call_live_transcript_items
        WHERE call_sid = ls.call_sid
        ORDER BY sequence_id DESC, track ASC
        LIMIT 400
      ) item ON true
    ), latest_drafts AS (
      SELECT d.call_sid, d.status, d.summary, d.updated_at
      FROM call_intake_drafts d
      JOIN calls c ON c.twilio_sid = d.call_sid
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN people p ON p.id = c.person_id
      WHERE (${role}::text = 'owner' OR (
        lower(COALESCE(c.detail->>'isTest', 'false')) <> 'true'
        AND COALESCE(l.is_test, false) = false
        AND COALESCE(p.is_test, false) = false
        AND COALESCE(d.is_test, false) = false
        AND COALESCE(c.detail->>'callerName', '') NOT ILIKE '%[INTERNAL TEST]%'
      ))
      ORDER BY d.updated_at DESC NULLS LAST, d.call_sid DESC
      LIMIT 20
    ), visible_notifications AS (
      SELECT n.id, n.created_at, n.priority, n.stock, n.title, n.body, n.url,
        n.sent_at, n.read_at, n.source_event_id, n.owner_only, n.action_kind,
        n.action_detail, n.action_status, n.delivery_status, n.delivery_error,
        n.coalesced
      FROM notifications n
      LEFT JOIN events e ON e.id = n.source_event_id
      LEFT JOIN leads l ON l.id = e.lead_id
      LEFT JOIN people p ON p.id = e.person_id
      LEFT JOIN people lead_person ON lead_person.id = l.person_id
      WHERE (n.operator_id IS NULL OR n.operator_id = ${operatorId}::bigint)
        AND (${role}::text = 'owner' OR (
          n.owner_only = false
          AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
          AND COALESCE(l.is_test, false) = false
          AND COALESCE(p.is_test, false) = false
          AND COALESCE(lead_person.is_test, false) = false
          AND lower(COALESCE(e.kind, '')) <> ALL(${OWNER_ONLY_EVENT_KINDS}::text[])
          AND lower(COALESCE(e.kind, '')) !~ ${OWNER_ONLY_EVENT_NAMESPACE_PATTERN}::text
          AND lower(COALESCE(e.detail->>'sensitivity', '')) <> ALL(${OWNER_ONLY_EVENT_SENSITIVITIES}::text[])
          AND concat_ws(' ', n.title, n.body, e.body, e.crew_body, e.detail::text,
            l.first_name, l.last_name, l.service, l.message, l.notes,
            p.display_name, p.company, p.phones::text, p.emails::text,
            lead_person.display_name, lead_person.company, lead_person.phones::text,
            lead_person.emails::text) NOT ILIKE '%[INTERNAL TEST]%'
        ))
    )
    SELECT
      (SELECT id::text FROM latest_visible_events ORDER BY id DESC LIMIT 1) AS event_id,
      (SELECT md5(COALESCE(string_agg(
          CASE WHEN ${role}::text = 'owner'
            THEN jsonb_build_array(id, kind, body, crew_body, detail, occurred_at, processed_at, extraction_status)::text
            ELSE jsonb_build_array(id, kind, crew_body, occurred_at, processed_at, extraction_status)::text
          END,
          ',' ORDER BY id DESC), '')) FROM latest_visible_events) AS events_signature,
      (SELECT c.updated_at
        FROM calls c
        LEFT JOIN leads l ON l.id = c.lead_id
        LEFT JOIN people p ON p.id = c.person_id
        LEFT JOIN call_intake_drafts d ON d.call_sid = c.twilio_sid
        WHERE ${role}::text = 'owner' OR (
          lower(COALESCE(c.detail->>'isTest', 'false')) <> 'true'
          AND COALESCE(l.is_test, false) = false
          AND COALESCE(p.is_test, false) = false
          AND COALESCE(d.is_test, false) = false
          AND COALESCE(c.detail->>'callerName', '') NOT ILIKE '%[INTERNAL TEST]%'
        )
        ORDER BY c.updated_at DESC NULLS LAST, c.id DESC LIMIT 1) AS calls_updated_at,
      (SELECT md5(COALESCE(string_agg(
          jsonb_build_array(id, status, duration_sec, updated_at)::text,
          ',' ORDER BY id DESC), '')) FROM latest_calls) AS calls_signature,
      (SELECT max(updated_at) FROM latest_sketches) AS call_sketches_updated_at,
      (SELECT md5(COALESCE(string_agg(
          jsonb_build_array(call_sid, status, observed_through_sequence, updated_at)::text,
          ',' ORDER BY updated_at DESC NULLS LAST, call_sid DESC), '')) FROM latest_sketches) AS call_sketches_signature,
      (SELECT md5(COALESCE(string_agg(
          jsonb_build_array(call_sid, sequence_id, track, is_final, transcript, stability, confidence, provider_timestamp)::text,
          ',' ORDER BY call_sid, sequence_id DESC, track ASC), '')) FROM latest_transcript_items) AS call_transcript_signature,
      (SELECT md5(COALESCE(string_agg(
          jsonb_build_array(call_sid, status, summary, updated_at)::text,
          ',' ORDER BY updated_at DESC NULLS LAST, call_sid DESC), '')) FROM latest_drafts) AS call_drafts_signature,
      (SELECT count(*)::int FROM visible_notifications WHERE read_at IS NULL) AS unread_notifications,
      (SELECT md5(COALESCE(string_agg(
          jsonb_build_array(id, priority, stock, title, body, url, sent_at, read_at,
            source_event_id, action_kind, action_detail, action_status, delivery_status,
            delivery_error, coalesced)::text,
          ',' ORDER BY created_at DESC NULLS LAST, id DESC), ''))
        FROM (SELECT * FROM visible_notifications
          ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 50) recent_notifications) AS notifications_signature`

  const row = firstRow(rows)
  return {
    eventId: row.event_id == null ? null : String(row.event_id),
    eventsSignature: row.events_signature == null ? null : String(row.events_signature),
    callsUpdatedAt: timestamp(row.calls_updated_at),
    callsSignature: row.calls_signature == null ? null : String(row.calls_signature),
    callSketchesUpdatedAt: timestamp(row.call_sketches_updated_at),
    callSketchesSignature: row.call_sketches_signature == null ? null : String(row.call_sketches_signature),
    callTranscriptSignature: row.call_transcript_signature == null ? null : String(row.call_transcript_signature),
    callDraftsSignature: row.call_drafts_signature == null ? null : String(row.call_drafts_signature),
    unreadNotifications: Number(row.unread_notifications ?? 0),
    notificationsSignature: row.notifications_signature == null ? null : String(row.notifications_signature),
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
      const pulse = await readOpsPulse(getSql(), operator.role, operator.id ?? null)
      return Response.json(pulse, { headers: { "Cache-Control": "no-store" } })
    } catch {
      return Response.json({ error: "Pulse unavailable." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      })
    }
  }
}
