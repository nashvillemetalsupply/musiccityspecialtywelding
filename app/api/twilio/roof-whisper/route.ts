import { escapeXml, readTwilioForm, roofLineByBusiness, twiml } from "@/lib/twilio"

export const runtime = "nodejs"

// Played to the owner only, after he answers a roof-line call. Fails open: a
// non-200 here drops his leg of the call, so a bad signature or an unknown line
// connects the caller without the cue instead. Unlike the welding whisper this
// is app-hosted, so a 5xx or timeout still drops his leg; acceptable because an
// app outage already sends the call to the provider-hosted fallback, which
// dials him directly and never requests this route.
export async function POST(req: Request) {
  const { valid } = await readTwilioForm(req)
  const business = new URL(req.url).searchParams.get("line") ?? ""
  const line = valid ? roofLineByBusiness(business) : null
  if (!line) console.warn("roof-whisper: cue skipped", { valid, business })
  return twiml(line ? `<Say voice="man">${escapeXml(`Call for ${line.greeting}`)}</Say>` : "")
}
