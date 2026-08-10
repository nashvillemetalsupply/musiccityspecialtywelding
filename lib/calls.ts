import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notify } from "@/lib/notify"

export type CallRow = { id: number; twilio_sid: string; direction: string; from_phone: string; to_phone: string; status: string; started_at: string; duration_sec: number | null; recording_sid: string; recording_url: string; transcript: string; crew_transcript: string | null; transcript_status: string; lead_id: number | null; person_id: number | null }
export async function listLeadCalls(leadId: number): Promise<CallRow[]> {
  const sql = getSql()
  return (await sql`SELECT * FROM (SELECT * FROM calls WHERE lead_id = ${leadId}::bigint ORDER BY started_at DESC, id DESC LIMIT 200) recent ORDER BY started_at ASC, id ASC`) as CallRow[]
}

/** Quarantines an outbound call whose provider handoff never produced a terminal response. Never auto-redials. */
export async function reconcileStaleOutboundCalls(limit = 20) {
  const sql = getSql()
  const rows = (await sql`
    UPDATE calls SET status = 'unknown',
      detail = COALESCE(detail, '{}'::jsonb) || '{"ambiguous":true,"reconciled":"stale-starting"}'::jsonb
    WHERE id IN (
      SELECT id FROM calls
      WHERE direction = 'out' AND status = 'starting'
        AND starting_started_at < now() - interval '10 minutes'
      ORDER BY starting_started_at ASC
      LIMIT ${Math.min(Math.max(limit, 1), 50)}::bigint
    )
    RETURNING id, twilio_sid, lead_id, person_id, operator_id`) as Array<{
      id: number; twilio_sid: string; lead_id: number | null; person_id: number | null; operator_id: number | null
    }>
  for (const row of rows) {
    const eventId = await recordEvent({
      kind: "call.out.unknown",
      actorType: "system",
      leadId: row.lead_id,
      personId: row.person_id,
      externalId: `call-out-unknown:${row.id}`,
      body: "Tracked call handoff needs verification before another call is placed.",
      crewBody: "Tracked call may have started. Verify before ringing again.",
      detail: { callId: row.id, sid: row.twilio_sid, ambiguous: true },
    })
    if (row.operator_id) await notify({
      operatorId: row.operator_id,
      priority: "digest",
      stock: "red",
      title: "Check this call before ringing again",
      body: "Twilio may have started it. Verify the call receipt first.",
      crewBody: "The call may have started. Verify before trying again.",
      url: row.lead_id ? `/ops/leads/${row.lead_id}#spike` : "/ops?view=updates#wire",
      sourceEventId: eventId,
      dedupeKey: `call-out-unknown:${row.id}`,
    })
  }
  return { reconciled: rows.length }
}
