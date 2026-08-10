import { getSql } from "@/lib/db"
import { twilioCallbackUrl } from "@/lib/twilio"

export function deepgramCallbackSecretConfigured() {
  return Buffer.byteLength(process.env.DEEPGRAM_CALLBACK_SECRET?.trim() ?? "", "utf8") >= 32
}

export function callTranscriptionConfigured() {
  return Boolean(
    process.env.DEEPGRAM_API_KEY?.trim() &&
    deepgramCallbackSecretConfigured() &&
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN?.trim()
  )
}

export async function submitCallRecording(recordingSid: string) {
  if (!callTranscriptionConfigured()) throw new Error("Call transcription callback is not configured.")
  const sql = getSql()
  const rows = (await sql`
    UPDATE calls SET transcript_status = 'submitting', transcript_attempts = transcript_attempts + 1,
      transcript_error = '', updated_at = now()
    WHERE recording_sid = ${recordingSid}::text
      AND recording_url <> ''
      AND transcript_attempts < 8
      AND (
        transcript_status IN ('queued','failed')
        OR (transcript_status = 'submitting' AND updated_at < now() - interval '10 minutes')
        OR (transcript_status = 'submitted' AND transcript_submitted_at < now() - interval '30 minutes')
      )
    RETURNING recording_url`) as { recording_url: string }[]
  if (!rows[0]) return false
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!.trim()
    const authToken = process.env.TWILIO_AUTH_TOKEN!.trim()
    const media = await fetch(`${rows[0].recording_url}.mp3?RequestedChannels=2`, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
      cache: "no-store",
    })
    if (!media.ok) throw new Error(`Twilio recording fetch failed (${media.status}).`)
    const callback = twilioCallbackUrl(`/api/twilio/transcript?token=${encodeURIComponent(process.env.DEEPGRAM_CALLBACK_SECRET!.trim())}&recording=${encodeURIComponent(recordingSid)}`)
    const submitted = await fetch(
      `https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&diarize=true&multichannel=true&utterances=true&callback=${encodeURIComponent(callback)}`,
      {
        method: "POST",
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY!.trim()}`, "Content-Type": media.headers.get("content-type") || "audio/mpeg" },
        body: await media.arrayBuffer(),
        cache: "no-store",
      }
    )
    if (!submitted.ok) throw new Error(`Deepgram submission failed (${submitted.status}): ${(await submitted.text()).slice(0, 300)}`)
    await sql`
      UPDATE calls SET transcript_status = 'submitted', transcript_submitted_at = now(), transcript_error = '', updated_at = now()
      WHERE recording_sid = ${recordingSid}::text AND transcript_status = 'submitting'`
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : "Call transcription submission failed."
    const transitioned = (await sql`
      UPDATE calls SET transcript_status = 'failed', transcript_error = ${message.slice(0, 500)}::text,
        detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ transcriptError: message })}::jsonb,
        updated_at = now()
      WHERE recording_sid = ${recordingSid}::text AND transcript_status = 'submitting'
      RETURNING id`) as { id: number }[]
    if (!transitioned[0]) {
      const current = (await sql`
        SELECT transcript_status FROM calls WHERE recording_sid = ${recordingSid}::text LIMIT 1`) as {
        transcript_status: string
      }[]
      if (["ready", "empty"].includes(current[0]?.transcript_status ?? "")) return true
    }
    throw error
  }
}

export async function retryCallTranscriptions(limit = 8) {
  if (!callTranscriptionConfigured()) return { configured: false, attempted: 0, submitted: 0 }
  const sql = getSql()
  const rows = (await sql`
    SELECT recording_sid FROM calls
    WHERE recording_sid <> '' AND transcript_attempts < 8
      AND (
        (transcript_status IN ('queued','failed','submitting') AND updated_at < now() - interval '5 minutes')
        OR (transcript_status = 'submitted' AND transcript_submitted_at < now() - interval '30 minutes')
      )
    ORDER BY updated_at ASC LIMIT ${Math.min(Math.max(limit, 1), 20)}::bigint`) as { recording_sid: string }[]
  let submitted = 0
  for (const row of rows) if (await submitCallRecording(row.recording_sid).catch(() => false)) submitted += 1
  return { configured: true, attempted: rows.length, submitted }
}
