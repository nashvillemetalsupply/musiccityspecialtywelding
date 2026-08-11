import { getSql } from "@/lib/db"
import { after } from "next/server"
import { recordEvent } from "@/lib/events"
import { readTwilioForm, twilioVoiceConfigured, twiml } from "@/lib/twilio"
import { callTranscriptionConfigured, submitCallRecording } from "@/lib/call-transcription"

export const runtime = "nodejs"

export async function POST(req: Request) {
  if (!twilioVoiceConfigured()) return twiml("", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)
  const callSid = params.get("CallSid") ?? ""
  const recordingSid = params.get("RecordingSid") ?? ""
  const recordingUrl = params.get("RecordingUrl") ?? ""
  if (!callSid || !recordingSid || !recordingUrl) return twiml("", 400)
  const sql = getSql()
  const intent = Number(new URL(req.url).searchParams.get("intent"))
  const transcriptStatus = callTranscriptionConfigured() ? "queued" : "unavailable"
  const rows = (await sql`
    UPDATE calls SET
      recording_sid = ${recordingSid}::text,
      recording_url = ${recordingUrl}::text,
      transcript_status = CASE
        WHEN recording_sid = ${recordingSid}::text THEN transcript_status
        WHEN transcript_status = 'ready' AND transcript <> '' THEN 'ready'
        ELSE ${transcriptStatus}::text
      END
    WHERE (twilio_sid = ${callSid}::text OR id = ${Number.isInteger(intent) && intent > 0 ? intent : null}::bigint)
    RETURNING lead_id, person_id,
      lower(COALESCE(detail->>'isTest', 'false')) = 'true' AS is_test`) as { lead_id: number | null; person_id: number | null; is_test: boolean }[]
  if (!rows[0]) return twiml("")
  await recordEvent({
    kind: "call.recording",
    actorType: "system",
    leadId: rows[0]?.lead_id,
    personId: rows[0]?.person_id,
    externalId: recordingSid,
    body: "Call recording captured",
    detail: { callSid, isTest: rows[0].is_test },
  })

  if (callTranscriptionConfigured()) after(() => submitCallRecording(recordingSid).catch((error) => console.error("Call transcription submission failed:", error)))
  return twiml("")
}
