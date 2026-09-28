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
  const sql = getSql()
  const itemKey = replacement.itemKey || createHash("sha256")
    .update(`${replacement.predicate}:${JSON.stringify(replacement.value)}`)
    .digest("hex")
  const rows = (await sql`
    WITH claim_input AS MATERIALIZED (
      SELECT ${replacement.subjectType}::text AS subject_type,
        ${replacement.subjectId}::bigint AS subject_id,
        ${replacement.predicate}::text AS predicate,
        ${JSON.stringify(replacement.value)}::jsonb AS value,
        ${replacement.confidence}::real AS confidence,
        ${replacement.sourceEventId}::bigint AS source_event_id,
        ${replacement.extractedBy}::text AS extracted_by,
        ${itemKey}::text AS item_key
    ), claim_write AS (
      INSERT INTO claims (subject_type, subject_id, predicate, value, confidence, source_event_id, extracted_by, item_key)
      SELECT subject_type, subject_id, predicate, value, confidence, source_event_id, extracted_by, item_key
      FROM claim_input
      ON CONFLICT (source_event_id, item_key) WHERE item_key <> ''
      DO UPDATE SET item_key = EXCLUDED.item_key
      RETURNING id
    ), supersede_write AS MATERIALIZED (
      UPDATE claims old SET superseded_by = claim_write.id
      FROM claim_write
      WHERE old.id = ${oldId}::bigint AND old.id <> claim_write.id
        AND old.superseded_by IS NULL
      RETURNING old.id
    )
    SELECT claim_write.id FROM claim_write
    CROSS JOIN (SELECT count(*) FROM supersede_write) linked LIMIT 1`) as { id: number }[]
  if (!rows[0]) throw new Error("The replacement claim could not be saved.")
  return Number(rows[0].id)
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
