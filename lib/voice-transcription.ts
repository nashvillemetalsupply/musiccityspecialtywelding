import { get } from "@vercel/blob"
import { getSql } from "@/lib/db"

type VoiceIntent = {
  id: string
  content_type: string
  blob_path: string
  status: string
  transcript: string
}

export function voiceTranscriptionConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY?.trim() && process.env.BLOB_READ_WRITE_TOKEN?.trim())
}

export async function transcribeVoiceIntent(id: string, suppliedBytes?: Buffer) {
  const key = process.env.DEEPGRAM_API_KEY?.trim()
  if (!key) throw new Error("Voice needs DEEPGRAM_API_KEY.")
  const sql = getSql()
  const claimed = (await sql`
    UPDATE voice_transcription_intents SET
      status = 'submitting', attempts = attempts + 1, last_error = '', updated_at = now()
    WHERE id = ${id}::text
      AND blob_path <> ''
      AND attempts < 8
      AND (status IN ('queued','failed') OR (status = 'submitting' AND updated_at < now() - interval '10 minutes'))
    RETURNING id, content_type, blob_path, status, transcript`) as VoiceIntent[]
  if (!claimed[0]) {
    const existing = (await sql`SELECT id, content_type, blob_path, status, transcript FROM voice_transcription_intents WHERE id = ${id}::text LIMIT 1`) as VoiceIntent[]
    if (existing[0]?.status === "completed" && existing[0].transcript) return existing[0].transcript
    throw new Error("That voice note is already being handled.")
  }
  try {
    let bytes = suppliedBytes
    if (!bytes) {
      const stored = await get(claimed[0].blob_path, { access: "private" })
      if (!stored || stored.statusCode !== 200 || !stored.stream) throw new Error("Stored voice note could not be read.")
      bytes = Buffer.from(await new Response(stored.stream).arrayBuffer())
    }
    const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=en-US", {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": claimed[0].content_type },
      body: new Uint8Array(bytes).buffer,
      cache: "no-store",
    })
    const data = await response.json().catch(() => null) as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }; err_msg?: string } | null
    const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ""
    if (!response.ok || !transcript) throw new Error(data?.err_msg || "Voice transcription failed.")
    await sql`
      UPDATE voice_transcription_intents SET status = 'completed', transcript = ${transcript}::text,
        last_error = '', updated_at = now()
      WHERE id = ${id}::text`
    return transcript
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voice transcription failed."
    await sql`
      UPDATE voice_transcription_intents SET status = 'failed', last_error = ${message.slice(0, 500)}::text, updated_at = now()
      WHERE id = ${id}::text`
    throw error
  }
}

export async function retryVoiceTranscriptions(limit = 8) {
  const sql = getSql()
  const rows = (await sql`
    SELECT id FROM voice_transcription_intents
    WHERE blob_path <> '' AND attempts < 8
      AND status IN ('queued','failed','submitting')
      AND updated_at < now() - interval '5 minutes'
    ORDER BY updated_at ASC LIMIT ${Math.min(Math.max(limit, 1), 20)}::bigint`) as { id: string }[]
  let completed = 0
  for (const row of rows) {
    if (await transcribeVoiceIntent(row.id).then(() => true).catch(() => false)) completed += 1
  }
  return { attempted: rows.length, completed }
}
