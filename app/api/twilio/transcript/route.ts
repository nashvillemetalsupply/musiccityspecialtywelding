import { getSql } from "@/lib/db"
import { after } from "next/server"
import { recordEvent } from "@/lib/events"
import { processEvent } from "@/lib/extract"
import { summarizeCallDraft } from "@/lib/call-summary"
import { safeSecretMatch } from "@/lib/ops-auth"
import { deepgramCallbackSecretConfigured } from "@/lib/call-transcription"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const url = new URL(req.url)
  const supplied = url.searchParams.get("token") ?? ""
  const expected = process.env.DEEPGRAM_CALLBACK_SECRET?.trim() || ""
  if (!deepgramCallbackSecretConfigured() || !safeSecretMatch(supplied, expected)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const payload = (await req.json().catch(() => null)) as {
    results?: {
      channels?: Array<{ alternatives?: Array<{ transcript?: string; words?: Array<{ speaker?: number; word?: string; start?: number; end?: number }> }> }>
      utterances?: Array<{ speaker?: number; transcript?: string; start?: number; end?: number }>
    }
    metadata?: { request_id?: string }
  } | null
  const recordingSid = url.searchParams.get("recording") ?? ""
  if (!recordingSid) return Response.json({ ok: false, error: "Missing recording." }, { status: 400 })
  const sql = getSql()
  const existing = (await sql`
    SELECT direction, lower(COALESCE(detail->>'isTest', 'false')) = 'true' AS is_test
    FROM calls WHERE recording_sid = ${recordingSid}::text LIMIT 1`) as { direction: string; is_test: boolean }[]
  const direction = existing[0]?.direction ?? "in"
  const channels = payload?.results?.channels ?? []
  const channelText = channels.map((channel, index) => {
    const alternative = channel.alternatives?.[0]
    const label = direction === "out"
      ? (index === 0 ? "Shop" : "Customer")
      : (index === 0 ? "Customer" : "Shop")
    const body = alternative?.transcript?.trim() ?? ""
    const words = alternative?.words ?? []
    return body ? { channel: index, label, body, start: words[0]?.start ?? 0, end: words.at(-1)?.end ?? null } : null
  }).filter((item): item is { channel: number; label: string; body: string; start: number; end: number | null } => Boolean(item))
  const speakerText = (payload?.results?.utterances ?? []).map((item) => ({
    speaker: item.speaker ?? 0,
    label: `Speaker ${(item.speaker ?? 0) + 1}`,
    body: item.transcript?.trim() ?? "",
    start: item.start ?? null,
    end: item.end ?? null,
  })).filter((item) => item.body)
  const segments = channelText.length > 1 ? channelText : speakerText
  const transcript = segments.length
    ? segments.map((item) => `${item.label}: ${item.body}`).join("\n")
    : channels[0]?.alternatives?.[0]?.transcript?.trim() ?? ""
  const rows = (await sql`
    UPDATE calls SET
      transcript = ${transcript}::text,
      transcript_status = ${transcript ? "ready" : "empty"}::text
    WHERE recording_sid = ${recordingSid}::text
    RETURNING lead_id, person_id, twilio_sid`) as {
    lead_id: number | null
    person_id: number | null
    twilio_sid: string
  }[]
  const call = rows[0]
  if (call) {
    const eventId = await recordEvent({
      kind: "call.transcript",
      actorType: "system",
      leadId: call.lead_id,
      personId: call.person_id,
      externalId: `${recordingSid}:transcript`,
      body: transcript,
      detail: { callSid: call.twilio_sid, isTest: existing[0]?.is_test ?? false, deepgramRequestId: payload?.metadata?.request_id ?? null, segments },
    })
    if (eventId) after(() => processEvent(eventId).catch((error) => console.error("Transcript extraction failed:", error)))
    // The transcript is the whole call, so this is the moment the draft can be
    // read once. A call with no draft (an outbound call, or one already a job)
    // returns no-draft and costs nothing.
    if (transcript) after(() => summarizeCallDraft(call.twilio_sid).catch((error) => console.error("Call summary failed:", error)))
  }
  return Response.json({ ok: true })
}
