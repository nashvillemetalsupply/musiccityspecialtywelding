import { existsSync, readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

function databaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim()
  if (existsSync(".env.local")) {
    const match = readFileSync(".env.local", "utf8").match(/^DATABASE_URL="?([^"\r\n]+)/m)
    if (match) return match[1]
  }
  throw new Error("DATABASE_URL not found")
}

const sql = neon(databaseUrl())
const result = await sql`
  INSERT INTO events (
    occurred_at, kind, actor_type, actor_id, lead_id, person_id,
    external_id, body, detail, processed_at
  )
  SELECT
    le.created_at,
    CASE le.type
      WHEN 'created' THEN 'form.quote'
      WHEN 'status_changed' THEN 'status.changed'
      WHEN 'notes_saved' THEN 'note.text'
      WHEN 'interaction' THEN 'contact.logged'
      ELSE 'lead.' || replace(le.type, '_', '.')
    END,
    CASE WHEN le.actor = 'system' THEN 'system' ELSE 'operator' END,
    CASE WHEN le.actor = 'system' THEN '' ELSE le.actor END,
    le.lead_id,
    l.person_id,
    'lead_event:' || le.id::text,
    COALESCE(le.detail->>'note', le.detail->>'message', le.detail->>'reason', ''),
    COALESCE(le.detail, '{}'::jsonb) || jsonb_build_object('legacyType', le.type),
    le.created_at
  FROM lead_events le
  JOIN leads l ON l.id = le.lead_id
  ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
  RETURNING id`

console.log(`Event backfill complete. Added ${result.length} event(s).`)
