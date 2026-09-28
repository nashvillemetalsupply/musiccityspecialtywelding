import { getSql } from "@/lib/db"

export async function resolveProjectionLeadId(sourceLeadId: number | null): Promise<number | null> {
  if (!sourceLeadId) return null
  const sql = getSql()
  const rows = (await sql`
    SELECT COALESCE(routed_to_lead_id, id) AS projection_lead_id
    FROM leads
    WHERE id = ${sourceLeadId}::bigint
    LIMIT 1`) as Array<{ projection_lead_id: number }>
  return rows[0]?.projection_lead_id ? Number(rows[0].projection_lead_id) : sourceLeadId
}

// Routing and AI extraction can overlap. The route's atomic move handles
// everything visible in its transaction; this idempotent sweep catches a
// projection that committed while that transaction was in flight.
export async function reconcileRoutedLeadProjections(
  sourceLeadId: number,
  expectedTargetLeadId?: number | null,
): Promise<number | null> {
  const sql = getSql()
  const rows = (await sql`
    WITH pair AS (
      SELECT source.id AS source_id, source.routed_to_lead_id AS target_id
      FROM leads source
      WHERE source.id = ${sourceLeadId}::bigint
        AND source.routed_to_lead_id IS NOT NULL
        AND (
          ${expectedTargetLeadId ?? null}::bigint IS NULL
          OR source.routed_to_lead_id = ${expectedTargetLeadId ?? null}::bigint
        )
    ), moved_messages AS (
      UPDATE messages message
      SET lead_id = pair.target_id
      FROM pair
      WHERE message.lead_id = pair.source_id
      RETURNING message.id
    ), moved_attachments AS (
      UPDATE ingest_attachments attachment
      SET lead_id = pair.target_id, updated_at = now()
      FROM pair
      WHERE attachment.lead_id = pair.source_id
      RETURNING attachment.id
    ), duplicate_commitments AS (
      UPDATE commitments source_commitment
      SET status = 'superseded', status_changed_at = now(), glass_primary = false
      FROM pair
      WHERE source_commitment.lead_id = pair.source_id
        AND source_commitment.status = 'open'
        AND EXISTS (
          SELECT 1 FROM commitments target_commitment
          WHERE target_commitment.lead_id = pair.target_id
            AND target_commitment.status = 'open'
            AND target_commitment.direction = source_commitment.direction
            AND btrim(lower(target_commitment.summary)) = btrim(lower(source_commitment.summary))
            AND target_commitment.due_at IS NOT DISTINCT FROM source_commitment.due_at
        )
      RETURNING source_commitment.id
    ), moved_commitments AS (
      UPDATE commitments commitment
      SET lead_id = pair.target_id,
        glass_primary = CASE WHEN commitment.glass_primary AND EXISTS (
          SELECT 1 FROM commitments target_primary
          WHERE target_primary.lead_id = pair.target_id
            AND target_primary.glass_primary = true
            AND target_primary.status = 'open'
        ) THEN false ELSE commitment.glass_primary END
      FROM pair
      WHERE commitment.lead_id = pair.source_id
        AND NOT EXISTS (
          SELECT 1 FROM duplicate_commitments duplicate
          WHERE duplicate.id = commitment.id
        )
      RETURNING commitment.id
    ), claim_candidates AS MATERIALIZED (
      SELECT claim.*, pair.target_id
      FROM claims claim CROSS JOIN pair
      WHERE claim.subject_type = 'lead'
        AND claim.subject_id = pair.source_id
        AND claim.superseded_by IS NULL
    ), replacement_claims AS (
      INSERT INTO claims (
        subject_type, subject_id, predicate, value, confidence,
        source_event_id, extracted_by, item_key, is_test
      )
      SELECT candidate.subject_type, candidate.target_id, candidate.predicate,
        candidate.value, candidate.confidence, candidate.source_event_id,
        candidate.extracted_by,
        CASE WHEN candidate.item_key = '' THEN 'routed:'::text
          ELSE candidate.item_key || ':routed:'::text END ||
          candidate.target_id::text || ':'::text || candidate.id::text,
        mcsw_is_test_row(candidate.target_id, NULL::bigint, candidate.source_event_id,
          NULL::text, NULL::jsonb, candidate.value::text)
      FROM claim_candidates candidate
      RETURNING id, source_event_id, item_key
    ), moved_claims AS (
      UPDATE claims prior SET superseded_by = replacement.id
      FROM claim_candidates candidate
      JOIN replacement_claims replacement
        ON replacement.source_event_id = candidate.source_event_id
        AND replacement.item_key = CASE WHEN candidate.item_key = '' THEN 'routed:'::text
          ELSE candidate.item_key || ':routed:'::text END ||
          candidate.target_id::text || ':'::text || candidate.id::text
      WHERE prior.id = candidate.id AND prior.superseded_by IS NULL
      RETURNING prior.id
    )
    SELECT target_id,
      (SELECT count(*)::int FROM moved_messages) AS moved_messages,
      (SELECT count(*)::int FROM moved_attachments) AS moved_attachments,
      (SELECT count(*)::int FROM moved_commitments) AS moved_commitments,
      (SELECT count(*)::int FROM moved_claims) AS moved_claims
    FROM pair
    LIMIT 1`) as Array<{ target_id: number }>
  return rows[0]?.target_id ? Number(rows[0].target_id) : null
}
