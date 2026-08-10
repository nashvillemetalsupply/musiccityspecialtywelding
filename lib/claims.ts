import { getSql } from "@/lib/db"
import { createHash } from "node:crypto"

export type ClaimRow = {
  id: number
  created_at: string
  subject_type: "lead" | "person"
  subject_id: number
  predicate: string
  value: unknown
  confidence: number
  source_event_id: number
  extracted_by: string
  superseded_by: number | null
}

export async function addClaim(input: {
  subjectType: "lead" | "person"
  subjectId: number
  predicate: string
  value: unknown
  confidence: number
  sourceEventId: number
  extractedBy: string
  itemKey?: string
}): Promise<number> {
  const sql = getSql()
  const itemKey = input.itemKey || createHash("sha256").update(`${input.predicate}:${JSON.stringify(input.value)}`).digest("hex")
  const rows = (await sql`
    INSERT INTO claims (
      subject_type, subject_id, predicate, value, confidence,
      source_event_id, extracted_by, item_key
    ) VALUES (
      ${input.subjectType}::text,
      ${input.subjectId}::bigint,
      ${input.predicate}::text,
      ${JSON.stringify(input.value)}::jsonb,
      ${input.confidence}::real,
      ${input.sourceEventId}::bigint,
      ${input.extractedBy}::text,
      ${itemKey}::text
    ) ON CONFLICT (source_event_id, item_key) WHERE item_key <> '' DO NOTHING
    RETURNING id`) as { id: number }[]
  if (rows[0]) return Number(rows[0].id)
  const existing = (await sql`
    SELECT id FROM claims WHERE source_event_id = ${input.sourceEventId}::bigint AND item_key = ${itemKey}::text LIMIT 1`) as { id: number }[]
  return Number(existing[0].id)
}

export async function supersedeClaim(oldId: number, replacement: Parameters<typeof addClaim>[0]) {
  const newId = await addClaim(replacement)
  const sql = getSql()
  await sql`
    UPDATE claims SET superseded_by = ${newId}::bigint
    WHERE id = ${oldId}::bigint AND superseded_by IS NULL`
  return newId
}

export async function supersedeClaimWithExisting(oldId: number, newId: number) {
  const sql = getSql()
  await sql`
    UPDATE claims SET superseded_by = ${newId}::bigint
    WHERE id = ${oldId}::bigint AND superseded_by IS NULL`
}

export async function listActiveClaims(subjectType: "lead" | "person", subjectId: number) {
  const sql = getSql()
  return (await sql`
    SELECT * FROM claims
    WHERE subject_type = ${subjectType}::text
      AND subject_id = ${subjectId}::bigint
      AND superseded_by IS NULL
    ORDER BY created_at DESC`) as ClaimRow[]
}
