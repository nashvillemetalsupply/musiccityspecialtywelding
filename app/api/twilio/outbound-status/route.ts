import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { readTwilioForm, twilioVoiceConfigured, twiml } from "@/lib/twilio"

export const runtime = "nodejs"
export async function POST(req: Request) {
  if (!twilioVoiceConfigured()) return twiml("", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)
  const intent = Number(new URL(req.url).searchParams.get("intent"))
  const customerLeg = params.has("DialCallStatus")
  const status = customerLeg ? params.get("DialCallStatus") || "unknown" : params.get("CallStatus") || "unknown"
  const callSid = params.get("CallSid")?.trim() ?? ""
  const duration = customerLeg ? Number(params.get("DialCallDuration") || 0) : 0
  if (!Number.isInteger(intent) || intent <= 0) return twiml("", 400)
  const sql = getSql()
  if (!customerLeg) {
    if (!callSid) return twiml("", 400)
    await sql`
      UPDATE calls SET
        twilio_sid = CASE WHEN twilio_sid LIKE 'pending:%' AND ${callSid}::text <> '' THEN ${callSid}::text ELSE twilio_sid END,
        status = CASE
          WHEN status IN ('completed', 'busy', 'failed', 'no-answer', 'canceled') THEN status
          WHEN ${status}::text IN ('completed', 'busy', 'failed', 'no-answer', 'canceled') THEN ${status}::text
          WHEN (
            CASE ${status}::text
              WHEN 'queued' THEN 0 WHEN 'initiated' THEN 1 WHEN 'ringing' THEN 2 WHEN 'in-progress' THEN 3
              ELSE -1
            END
          ) >= (
            CASE status
              WHEN 'queued' THEN 0 WHEN 'initiated' THEN 1 WHEN 'ringing' THEN 2 WHEN 'in-progress' THEN 3
              ELSE -1
            END
          ) THEN ${status}::text
          ELSE status
        END,
        detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ operatorLegStatus: status })}::jsonb
      WHERE id = ${intent}::bigint AND direction = 'out'
        AND (twilio_sid LIKE 'pending:%' OR twilio_sid = ${callSid}::text)`
    await sql`
      UPDATE notifications SET read_at = COALESCE(read_at, now())
      WHERE read_at IS NULL AND source_event_id IN (
        SELECT id FROM events
        WHERE kind = 'call.out.unknown'
          AND detail->>'callId' = ${String(intent)}::text
      )`
    return twiml("")
  }
  const rows = (await sql`
    UPDATE calls SET status = ${status}::text, duration_sec = GREATEST(COALESCE(duration_sec, 0), ${duration}::int)
    WHERE id = ${intent}::bigint AND direction = 'out'
    RETURNING lead_id, person_id, operator_id, twilio_sid`) as { lead_id: number | null; person_id: number | null; operator_id: number | null; twilio_sid: string }[]
  const call = rows[0]
  if (call?.lead_id && status === "completed" && duration > 0) {
    await recordEvent({ kind: "call.out", actorType: "operator", actorId: call.operator_id ?? "", leadId: call.lead_id, personId: call.person_id, externalId: `${call.twilio_sid}:completed`, body: "Shop completed a tracked customer call", crewBody: "Shop completed a tracked customer call", detail: { callId: intent, durationSec: duration } })
    await sql`
      UPDATE leads SET first_response_at = COALESCE(first_response_at, now()),
        first_response_channel = CASE WHEN first_response_at IS NULL THEN 'phone' ELSE first_response_channel END,
        status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END, updated_at = now()
      WHERE id = ${call.lead_id}::bigint`
  }
  return twiml("")
}
