import { getSql } from "@/lib/db"
import { after } from "next/server"
import { recordEvent } from "@/lib/events"
import { prepareInboundCallIntake } from "@/lib/job-intake"
import { notifyAll } from "@/lib/notify"
import { normalizePhone } from "@/lib/people"
import { escapeXml, isConfiguredTwilioNumber, readTwilioForm, twilioCallbackUrl, twilioLiveTranscriptionStart, twilioVoiceConfigured, twiml } from "@/lib/twilio"

export const runtime = "nodejs"

export async function POST(req: Request) {
  if (!twilioVoiceConfigured()) return twiml("<Say>The shop line is not configured.</Say>", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)
  const sid = params.get("CallSid") ?? ""
  const from = params.get("From") ?? "anonymous"
  const to = params.get("To") ?? ""
  if (!sid) return twiml("", 400)
  if (!isConfiguredTwilioNumber(to)) return twiml("", 403)

  const callerName = params.get("CallerName") || ""
  const isTestCall = callerName.includes("[INTERNAL TEST]")
  const ownerCell = process.env.OWNER_CELL_PHONE!.trim()
  // The raw provider receipt must land before the call forwards. On a database
  // failure Twilio receives 503 and invokes the number-level fallback URL,
  // which rings the owner without falsely claiming the CRM captured the call.
  try {
    const sql = getSql()
    await sql`
      INSERT INTO calls (twilio_sid, direction, from_phone, to_phone, status, detail)
      VALUES (${sid}::text, 'in', ${from}::text, ${to}::text, 'ringing', ${JSON.stringify({ callerName: callerName || null, privateCaller: !normalizePhone(from), isTest: isTestCall })}::jsonb)
      ON CONFLICT (twilio_sid) DO NOTHING`
  } catch (error) {
    console.error("Call receipt failed; asking Twilio to use the configured fallback:", error)
    return twiml("", 503)
  }
  const response = twiml(
      `<Say voice="man">Music City Specialty Welding. This call may be recorded for job notes.</Say>` +
      twilioLiveTranscriptionStart({ callSid: sid, direction: "in" }) +
      `<Dial answerOnBridge="true" record="record-from-answer-dual" ` +
      `recordingStatusCallback="${escapeXml(twilioCallbackUrl("/api/twilio/recording"))}" ` +
      `action="${escapeXml(twilioCallbackUrl("/api/twilio/voice-status"))}">${escapeXml(ownerCell)}</Dial>`
  )
  // The public phone line must ring even during a database outage. Signed
  // Twilio traffic receives TwiML first; Shop Brain catches up after response.
  after(async () => {
    try {
      const prepared = await prepareInboundCallIntake({
        callSid: sid,
        phone: from,
        callerName,
        isTest: isTestCall,
      })
      const person = prepared.person
      const normalized = normalizePhone(from)
      const name = person?.display_name || callerName || (normalized ? `Caller ${normalized.slice(-4)}` : "Private caller")
      const leadId = prepared.kind === "existing" ? prepared.leadId : null
      const eventId = await recordEvent({
        kind: "call.in",
        actorType: "customer",
        actorId: person?.id ?? "",
        leadId,
        personId: person?.id ?? null,
        externalId: sid,
        body: `${name} called the shop`,
        crewBody: `${name} called the shop`,
        detail: { isTest: person?.is_test ?? isTestCall, intake: prepared.kind },
      })
      if (eventId && !isTestCall && !person?.is_test && !(prepared.kind === "draft" && prepared.draft.is_test)) await notifyAll({
        priority: "interrupt",
        stock: "white",
        title: `${name} calling`,
        body: prepared.kind === "draft" ? "Tap now for the live call sketch. Confirm it after hangup, then Save Job." : "Their active job is ready.",
        crewBody: prepared.kind === "draft" ? "The call is safe. Tap after you hang up, then Save Job." : "Their active job is ready.",
        url: prepared.kind === "draft" ? `/ops/intake/${prepared.draft.public_id}` : `/ops/leads/${prepared.leadId}`,
        sourceEventId: eventId,
        capExempt: prepared.kind === "draft",
        quietHoursExempt: prepared.kind === "draft",
        smsFallback: prepared.kind === "draft",
      })
    } catch (error) {
      console.error("Call forwarded; Shop Brain persistence failed:", error)
    }
  })
  return response
}
