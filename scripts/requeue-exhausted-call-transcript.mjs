import { existsSync, readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

function databaseUrl() {
  if (process.env.DATABASE_URL_UNPOOLED?.trim()) return process.env.DATABASE_URL_UNPOOLED.trim()
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim()
  if (!existsSync(".env.local")) return ""
  const env = readFileSync(".env.local", "utf8")
  return env.match(/^DATABASE_URL_UNPOOLED="?([^"\r\n]+)/m)?.[1]
    ?? env.match(/^DATABASE_URL="?([^"\r\n]+)/m)?.[1]
    ?? ""
}

const idFlag = process.argv.indexOf("--call-id")
const callId = idFlag >= 0 ? Number(process.argv[idFlag + 1]) : Number.NaN
if (!Number.isSafeInteger(callId) || callId < 1) {
  throw new Error("Usage: node scripts/requeue-exhausted-call-transcript.mjs --call-id <positive integer>")
}

const url = databaseUrl()
if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is unavailable.")
const sql = neon(url)

const rows = await sql`
  UPDATE calls
  SET transcript_status = 'failed',
      transcript_attempts = 0,
      transcript_error = 'Manual retry staged after transcription credential replacement.',
      detail = COALESCE(detail, '{}'::jsonb) || jsonb_build_object(
        'transcriptRecovery', jsonb_build_object(
          'stagedAt', now(),
          'reason', 'credential-replacement',
          'previousAttempts', transcript_attempts,
          'previousError', transcript_error
        )
      ),
      updated_at = now() - interval '6 minutes'
  WHERE id = ${callId}::bigint
    AND recording_sid <> ''
    AND transcript_status = 'failed'
    AND transcript_attempts >= 8
    AND transcript_error ~* 'deepgram.+401'
  RETURNING id, transcript_status, transcript_attempts`

if (rows.length !== 1) {
  throw new Error(`Call ${callId} was not requeued because it did not match the exhausted Deepgram-401 guard.`)
}

console.log(JSON.stringify({ requeued: true, ...rows[0] }))
