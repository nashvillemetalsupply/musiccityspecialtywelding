import { getSql } from "@/lib/db"
import { escapeXml, readTwilioForm, twilioCallbackUrl, twilioLiveTranscriptionStart, twilioVoiceConfigured, twiml } from "@/lib/twilio"

export const runtime = "nodejs"

export async function POST(req: Request) {
  if (!twilioVoiceConfigured()) return twiml("", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)
  const intent = Number(new URL(req.url).searchParams.get("intent"))
  if (!Number.isInteger(intent) || intent <= 0) return twiml("", 400)
  const sql = getSql()
  const rows = (await sql`
    SELECT c.to_phone, l.first_name FROM calls c JOIN leads l ON l.id = c.lead_id
    WHERE c.id = ${intent}::bigint AND c.direction = 'out' LIMIT 1`) as { to_phone: string; first_name: string }[]
  if (!rows[0]) return twiml("<Say>That work order call is no longer available.</Say>", 404)
  const callSid = params.get("CallSid") ?? "outbound"
  return twiml(`<Say>Calling ${escapeXml(rows[0].first_name || "the customer")} through the shop line. The call is recorded for job notes.</Say>${twilioLiveTranscriptionStart({ callSid, direction: "out" })}<Dial answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${escapeXml(twilioCallbackUrl(`/api/twilio/recording?intent=${intent}`))}" action="${escapeXml(twilioCallbackUrl(`/api/twilio/outbound-status?intent=${intent}`))}"><Number url="${escapeXml(twilioCallbackUrl("/api/twilio/outbound-whisper"))}">${escapeXml(rows[0].to_phone)}</Number></Dial>`)
}
