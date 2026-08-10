import { randomUUID } from "node:crypto"
import { put } from "@vercel/blob"
import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { transcribeVoiceIntent } from "@/lib/voice-transcription"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (!process.env.DEEPGRAM_API_KEY?.trim() || !process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return Response.json({ error: "Voice transcription is not configured." }, { status: 503 })
  }
  const contentType = (req.headers.get("content-type") || "audio/webm").slice(0, 120)
  if (!contentType.toLowerCase().startsWith("audio/")) return Response.json({ error: "That is not an audio note." }, { status: 400 })
  const bytes = Buffer.from(await req.arrayBuffer())
  if (!bytes.byteLength || bytes.byteLength > 15 * 1024 * 1024) return Response.json({ error: "That recording is empty or too large." }, { status: 400 })

  const requestedId = req.headers.get("x-voice-intent-id")?.trim() ?? ""
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId) ? requestedId : randomUUID()
  const recoveryKey = (req.headers.get("x-voice-recovery-key") ?? "voice").replace(/[^a-z0-9:_-]/gi, "-").slice(0, 120)
  const leadMatch = recoveryKey.match(/^(?:done|spike):(\d+)/)
  const leadId = leadMatch ? Number(leadMatch[1]) : null
  const sql = getSql()
  // Database intent precedes Blob storage and the transcription provider.
  await sql`
    INSERT INTO voice_transcription_intents (id, operator_id, content_type, status, recovery_key, lead_id)
    VALUES (${id}::text, ${operator.id}::bigint, ${contentType}::text, 'persisted', ${recoveryKey}::text, ${leadId}::bigint)
    ON CONFLICT (id) DO NOTHING`
  const existing = (await sql`
    SELECT status, transcript, blob_path FROM voice_transcription_intents
    WHERE id = ${id}::text AND operator_id = ${operator.id}::bigint LIMIT 1`) as { status: string; transcript: string; blob_path: string }[]
  if (!existing[0]) return Response.json({ error: "Voice intent belongs to another operator." }, { status: 409 })
  if (existing[0].status === "completed" && existing[0].transcript) return Response.json({ transcript: existing[0].transcript, intentId: id })
  try {
    let suppliedBytes: Buffer | undefined = bytes
    if (!existing[0].blob_path) {
      const extension = contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") ? "m4a" : "webm"
      const blob = await put(`voice-notes/${operator.id}/${id}.${extension}`, bytes, { access: "private", contentType, allowOverwrite: true })
      await sql`
        UPDATE voice_transcription_intents SET blob_path = ${blob.pathname}::text,
          status = 'queued', updated_at = now() WHERE id = ${id}::text AND operator_id = ${operator.id}::bigint`
    } else {
      suppliedBytes = undefined
      await sql`UPDATE voice_transcription_intents SET status = 'queued', updated_at = now() WHERE id = ${id}::text AND operator_id = ${operator.id}::bigint AND status = 'failed'`
    }
    const transcript = await transcribeVoiceIntent(id, suppliedBytes)
    return Response.json({ transcript, intentId: id })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voice transcription failed."
    await sql`
      UPDATE voice_transcription_intents SET status = 'failed', last_error = ${message.slice(0, 500)}::text, updated_at = now()
      WHERE id = ${id}::text AND status <> 'completed'`
    return Response.json({ error: message, intentId: id, retryable: true }, { status: 502 })
  }
}

export async function GET(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  const id = new URL(req.url).searchParams.get("id") ?? ""
  const sql = getSql()
  const rows = (await sql`
    SELECT status, transcript, last_error, attempts FROM voice_transcription_intents
    WHERE id = ${id}::text AND operator_id = ${operator.id}::bigint LIMIT 1`) as { status: string; transcript: string; last_error: string; attempts: number }[]
  if (!rows[0]) return Response.json({ error: "Voice note not found." }, { status: 404 })
  if (["queued", "failed"].includes(rows[0].status) && rows[0].attempts < 8) {
    const transcript = await transcribeVoiceIntent(id).catch(() => "")
    if (transcript) return Response.json({ status: "completed", transcript, last_error: "", attempts: rows[0].attempts + 1 })
  }
  const latest = (await sql`
    SELECT status, transcript, last_error, attempts FROM voice_transcription_intents
    WHERE id = ${id}::text AND operator_id = ${operator.id}::bigint LIMIT 1`) as { status: string; transcript: string; last_error: string; attempts: number }[]
  return Response.json(latest[0])
}
