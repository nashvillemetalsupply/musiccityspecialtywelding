import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"

/**
 * Joins receipts that were allowed to land before a call became a saved job.
 * Every update is idempotent so a retry can safely resume after any provider
 * or database interruption.
 */
export async function attachRecoveredCallArtifacts(
  callSid: string,
  leadId: number,
  personId: number | null,
  isTest: boolean
) {
  const sql = getSql()
  await sql`
    WITH call_events AS (
      UPDATE events e SET lead_id = ${leadId}::bigint, person_id = ${personId}::bigint,
        actor_id = CASE WHEN e.kind IN ('call.in','call.missed') AND e.actor_id = '' AND ${personId}::bigint IS NOT NULL THEN ${personId === null ? "" : String(personId)}::text ELSE e.actor_id END,
        detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ isTest })}::jsonb,
        processed_at = CASE WHEN e.kind = 'call.transcript' AND e.lead_id IS NULL THEN NULL ELSE e.processed_at END,
        extraction_status = CASE WHEN e.kind = 'call.transcript' AND e.lead_id IS NULL THEN 'pending' ELSE e.extraction_status END,
        extraction_next_attempt_at = CASE WHEN e.kind = 'call.transcript' AND e.lead_id IS NULL THEN NULL ELSE e.extraction_next_attempt_at END
      WHERE e.external_id IN (${callSid}::text, ${`${callSid}:missed`}::text)
        OR e.detail->>'callSid' = ${callSid}::text
      RETURNING id, kind
    ), auto_reply AS (
      UPDATE messages SET lead_id = ${leadId}::bigint, person_id = ${personId}::bigint
      WHERE idempotency_key = ${`missed-call:${callSid}:auto-reply`}::text
      RETURNING id
    ), message_events AS (
      UPDATE events e SET lead_id = ${leadId}::bigint, person_id = ${personId}::bigint,
        detail = COALESCE(e.detail, '{}'::jsonb) || ${JSON.stringify({ isTest })}::jsonb
      WHERE EXISTS (SELECT 1 FROM auto_reply m WHERE e.detail->>'messageId' = m.id::text)
      RETURNING id
    )
    UPDATE notifications n SET url = ${`/ops/leads/${leadId}#spike`}::text
    WHERE n.source_event_id IN (
      SELECT id FROM call_events UNION ALL SELECT id FROM message_events
    ) AND (n.url = '/ops' OR n.url LIKE '/ops/intake/%')`

  const calls = (await sql`
    SELECT direction, status, COALESCE(duration_sec, 0)::int AS duration_sec
    FROM calls WHERE twilio_sid = ${callSid}::text LIMIT 1`) as Array<{
      direction: string
      status: string
      duration_sec: number
    }>
  const call = calls[0]
  if (call?.direction === "in" && ["answered", "completed"].includes(call.status) && call.duration_sec > 0) {
    const owners = (await sql`
      SELECT id FROM operators WHERE active = true AND role = 'owner' ORDER BY id LIMIT 1`) as { id: number }[]
    let answeredEventId = await recordEvent({
      kind: "call.answered",
      actorType: "operator",
      actorId: owners[0]?.id ?? "",
      leadId,
      personId,
      externalId: `${callSid}:answered`,
      body: "The shop answered the customer call",
      crewBody: "The shop answered the customer call",
      detail: { durationSec: call.duration_sec, recovered: true, isTest },
    })
    if (!answeredEventId) {
      const prior = (await sql`
        SELECT id FROM events WHERE kind = 'call.answered' AND external_id = ${`${callSid}:answered`}::text LIMIT 1`) as { id: number }[]
      answeredEventId = Number(prior[0]?.id) || null
      if (answeredEventId) await sql`
        UPDATE events SET lead_id = ${leadId}::bigint, person_id = ${personId}::bigint,
          detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ isTest })}::jsonb
        WHERE id = ${answeredEventId}::bigint`
    }
    await sql`
      UPDATE leads SET first_response_at = COALESCE(first_response_at, now()),
        first_response_channel = CASE WHEN first_response_at IS NULL THEN 'phone' ELSE first_response_channel END,
        status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
        updated_at = now()
      WHERE id = ${leadId}::bigint`
  }
}
