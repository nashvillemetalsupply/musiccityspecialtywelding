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
    WITH stale AS MATERIALIZED (
      SELECT id, status
      FROM calls
      WHERE direction = 'out' AND (
        (status = 'persisted' AND started_at < now() - interval '10 minutes')
        OR (status = 'starting' AND starting_started_at < now() - interval '10 minutes')
      )
      ORDER BY COALESCE(starting_started_at, started_at) ASC
      LIMIT ${Math.min(Math.max(limit, 1), 50)}::bigint
      FOR UPDATE SKIP LOCKED
    )
    UPDATE calls c SET
      status = CASE WHEN stale.status = 'persisted' THEN 'failed' ELSE 'unknown' END,
      detail = COALESCE(c.detail, '{}'::jsonb) || CASE WHEN stale.status = 'persisted'
        THEN '{"ambiguous":false,"reconciled":"stale-persisted"}'::jsonb
        ELSE '{"ambiguous":true,"reconciled":"stale-starting"}'::jsonb END
    FROM stale
    WHERE c.id = stale.id
    RETURNING c.id, c.twilio_sid, c.lead_id, c.person_id, c.operator_id,
      stale.status AS prior_status`) as Array<{
      id: number; twilio_sid: string; lead_id: number | null; person_id: number | null; operator_id: number | null; prior_status: string
    }>
  for (const row of rows) {
    const providerHandoffStarted = row.prior_status === "starting"
    const eventId = await recordEvent({
      kind: providerHandoffStarted ? "call.out.unknown" : "call.out.failed",
      actorType: "system",
      leadId: row.lead_id,
      personId: row.person_id,
      externalId: `call-out-${providerHandoffStarted ? "unknown" : "failed"}:${row.id}`,
      body: providerHandoffStarted
        ? "Tracked call handoff needs verification before another call is placed."
        : "Tracked call intent expired before the provider handoff began.",
      crewBody: providerHandoffStarted
        ? "Tracked call may have started. Verify before ringing again."
        : "Tracked call never started. It is safe to try again.",
      detail: { callId: row.id, sid: row.twilio_sid, ambiguous: providerHandoffStarted },
    })
    if (row.operator_id) await notify({
      operatorId: row.operator_id,
      priority: "digest",
      stock: "red",
      title: providerHandoffStarted ? "Check this call before ringing again" : "Tracked call did not start",
      body: providerHandoffStarted ? "Twilio may have started it. Verify the call receipt first." : "No provider handoff began. Open the work order and try again.",
      crewBody: providerHandoffStarted ? "The call may have started. Verify before trying again." : "The call never started. Open the work order and try again.",
      url: row.lead_id ? `/ops/leads/${row.lead_id}#spike` : "/board/updates#wire",
      sourceEventId: eventId,
      dedupeKey: `call-out-${providerHandoffStarted ? "unknown" : "failed"}:${row.id}`,
    })
  }
  return { reconciled: rows.length }
}
