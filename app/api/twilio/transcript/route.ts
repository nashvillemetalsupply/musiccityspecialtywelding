import { getSql } from "@/lib/db"
import { after } from "next/server"
import { processEvent } from "@/lib/extract"
import { processTranscriptEventIfUnclaimed } from "@/lib/transcript-extraction.ts"
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
    SELECT direction FROM calls WHERE recording_sid = ${recordingSid}::text LIMIT 1`) as { direction: string }[]
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
  const externalId = `${recordingSid}:transcript`
  // Live stop must see the event as soon as it sees a ready recording.
  const rows = (await sql`
    WITH updated_call AS (
      UPDATE calls SET
        transcript = COALESCE(NULLIF(${transcript}::text, ''), calls.transcript),
        transcript_status = CASE WHEN transcript_status = 'ready' THEN 'ready' ELSE ${transcript ? "ready" : "empty"}::text END
      WHERE recording_sid = ${recordingSid}::text
      RETURNING lead_id, person_id, twilio_sid,
        is_test OR mcsw_is_test_row(lead_id, person_id, NULL::bigint, twilio_sid, detail, ${transcript}::text) AS is_test
    ), receipt AS (
      INSERT INTO events (kind, lead_id, person_id, external_id, body, detail, is_test)
      SELECT 'call.transcript', lead_id, person_id,
        CASE WHEN EXISTS (
          SELECT 1 FROM events WHERE kind = 'call.transcript' AND external_id = ${externalId}::text AND body = ''
        ) THEN ${`${externalId}:speech`}::text ELSE ${externalId}::text END,
        ${transcript}::text,
        jsonb_build_object('callSid', twilio_sid, 'isTest', is_test) ||
          ${JSON.stringify({ deepgramRequestId: payload?.metadata?.request_id ?? null, segments })}::jsonb,
        is_test
      FROM updated_call WHERE ${transcript}::text <> '' LIMIT 1
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id
    )
    SELECT twilio_sid, (SELECT id FROM receipt) AS event_id FROM updated_call LIMIT 1`) as {
    event_id: number | null
    twilio_sid: string
  }[]
  const call = rows[0]
  if (call) {
    const eventId = Number(call.event_id)
    if (eventId) after(() => processTranscriptEventIfUnclaimed(
      eventId,
      async (sourceEventId) => {
        const claims = (await sql`SELECT id FROM claims WHERE source_event_id = ${sourceEventId}::bigint LIMIT 1`) as { id: number }[]
        return Boolean(claims[0])
      },
      processEvent,
    ).catch((error) => console.error("Transcript extraction failed:", error)))
    // The transcript is the whole call, so this is the moment the draft can be
    // read once. A call with no draft (an outbound call, or one already a job)
    // returns no-draft and costs nothing.
    if (transcript) after(() => summarizeCallDraft(call.twilio_sid).catch((error) => console.error("Call summary failed:", error)))
  }
  return Response.json({ ok: true })
}
