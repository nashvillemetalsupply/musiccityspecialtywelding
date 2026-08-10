import { readTwilioForm, twilioVoiceConfigured, twiml } from "@/lib/twilio"

export const runtime = "nodejs"
export async function POST(req: Request) {
  if (!twilioVoiceConfigured()) return twiml("", 503)
  const { valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)
  return twiml("<Say>Music City Specialty Welding. This call may be recorded for job notes.</Say>")
}
