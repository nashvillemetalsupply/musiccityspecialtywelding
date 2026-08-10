import { escapeXml, isConfiguredTwilioNumber, readTwilioForm, twilioVoiceConfigured, twiml } from "@/lib/twilio"

export const runtime = "nodejs"

// Deliberately has no database dependency. This endpoint is useful for
// application-level testing only. The phone number's production fallback must
// point directly to provider-hosted TwiML so a full app outage still rings.
export async function POST(req: Request) {
  if (!twilioVoiceConfigured()) return twiml("<Say>The shop line is not configured.</Say>", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)
  if (!isConfiguredTwilioNumber(params.get("To") ?? "")) return twiml("", 403)
  return twiml(`<Dial answerOnBridge="true">${escapeXml(process.env.OWNER_CELL_PHONE!.trim())}</Dial>`)
}
