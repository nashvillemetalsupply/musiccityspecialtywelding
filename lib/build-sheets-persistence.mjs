export async function persistObservedBuildFacts({
  sql,
  leadId,
  callSid,
  sourceEventId,
  facts,
}) {
  const inserted = []
  for (const item of facts) {
    const decisionKey = `observed:${callSid}:${item.itemKey}`
    const rows = await sql`
      WITH lead_scope AS (
        SELECT l.id AS lead_id, owner.id AS actor_id
        FROM leads l
        JOIN LATERAL (
          SELECT id FROM operators WHERE role = 'owner' AND active = true
          ORDER BY created_at ASC LIMIT 1
        ) owner ON true
        WHERE l.id = ${leadId}::bigint AND l.is_test = true
      ), event_scope AS (
        SELECT e.id, e.occurred_at, e.lead_id
        FROM events e JOIN lead_scope scope ON scope.lead_id = e.lead_id
        WHERE e.id = ${sourceEventId}::bigint
      ), claim_write AS (
        INSERT INTO claims (
        subject_type, subject_id, predicate, value, confidence,
        source_event_id, extracted_by, item_key
      )
      SELECT 'lead'::text, event.lead_id, 'build_fact'::text, ${JSON.stringify(item.fact)}::jsonb,
        ${item.fact.certainty === "corrected" ? 1 : 0.85}::real,
        event.id, 'build-sheets'::text, ${item.itemKey}::text
      FROM event_scope event
      ON CONFLICT (source_event_id, item_key) WHERE item_key <> '' DO NOTHING
      RETURNING id, subject_id, source_event_id
      ), claim_scope AS (
        SELECT id, subject_id, source_event_id FROM claim_write
        UNION ALL
        SELECT c.id, c.subject_id, c.source_event_id FROM claims c
        JOIN event_scope event ON event.id = c.source_event_id
        WHERE c.item_key = ${item.itemKey}::text
          AND NOT EXISTS (SELECT 1 FROM claim_write)
        LIMIT 1
      ), decision_write AS (
        INSERT INTO build_fact_decisions (
        lead_id, claim_id, state, actor_id, proposer_type, purpose,
        source_event_id, decision_key, is_test, decided_at
      )
      SELECT claim.subject_id, claim.id, 'proposed'::text, scope.actor_id,
        'system'::text, 'build-sheet'::text, claim.source_event_id,
        ${decisionKey}::text, true, event.occurred_at
      FROM claim_scope claim
      JOIN lead_scope scope ON scope.lead_id = claim.subject_id
      JOIN event_scope event ON event.id = claim.source_event_id
      ON CONFLICT (lead_id, decision_key) DO NOTHING
      RETURNING claim_id
      ), decision_receipt AS (
        SELECT claim_id FROM decision_write
        UNION
        SELECT stored.claim_id FROM build_fact_decisions stored
        JOIN claim_scope claim ON claim.id = stored.claim_id
        WHERE stored.decision_key = ${decisionKey}::text
      )
      SELECT claim.id FROM claim_scope claim
      WHERE EXISTS (SELECT 1 FROM decision_receipt)`
    const claimId = Number(rows[0]?.id ?? 0)
    if (!claimId) throw new Error("The observed build fact could not be filed with its proposed receipt.")
    inserted.push({ id: claimId, fact: item.fact })
  }

  const groups = new Map()
  for (const item of inserted) {
    if (!item.fact.interpretationGroup) continue
    const ids = groups.get(item.fact.interpretationGroup) ?? []
    ids.push(item.id)
    groups.set(item.fact.interpretationGroup, ids)
  }
  for (const [conflictKey, claimIds] of groups) {
    if (claimIds.length < 2) continue
    await sql`
      INSERT INTO build_claim_conflicts (
        lead_id, conflict_key, kind, claim_ids, source_event_id, is_test
      )
      SELECT l.id, ${conflictKey}::text, 'unresolved-reference'::text,
        ${claimIds}::bigint[], ${sourceEventId}::bigint, true
      FROM leads l
      WHERE l.id = ${leadId}::bigint AND l.is_test = true
      ON CONFLICT (lead_id, conflict_key) DO NOTHING`
  }
  return inserted.map((item) => item.id)
}

export async function persistLockedBuildSheet({ sql, leadId, operatorId, lockKey, candidate }) {
  const inserted = await sql`
    WITH lead_scope AS (
      SELECT l.id FROM leads l JOIN operators o ON o.id = ${operatorId}::bigint
        AND o.role = 'owner' AND o.active = true
      WHERE l.id = ${leadId}::bigint AND l.is_test = true
    ), candidate_receipt AS (
      SELECT scope.id AS lead_id, ${lockKey}::text AS lock_key,
        nextval(pg_get_serial_sequence('build_sheets', 'id'))::bigint AS sheet_id
      FROM lead_scope scope
    ), receipt AS (
      INSERT INTO build_lock_receipts (lead_id, lock_key, build_sheet_id, is_test)
      SELECT candidate.lead_id, candidate.lock_key, candidate.sheet_id, true
      FROM candidate_receipt candidate
      ON CONFLICT (lead_id, lock_key) DO NOTHING
      RETURNING lead_id, build_sheet_id
    ), allocated AS (
      INSERT INTO build_sheet_sequences (lead_id, next_sequence, is_test)
      SELECT receipt.lead_id, 2::int, true FROM receipt
      ON CONFLICT (lead_id) DO UPDATE
      SET next_sequence = build_sheet_sequences.next_sequence + 1
      WHERE build_sheet_sequences.is_test = true
      RETURNING lead_id, next_sequence - 1 AS sheet_sequence
    ), sheet AS (
      INSERT INTO build_sheets (id, lead_id, sequence, snapshot, locked_by, locked_at, is_test)
      OVERRIDING SYSTEM VALUE
      SELECT receipt.build_sheet_id, allocated.lead_id, allocated.sheet_sequence,
        jsonb_set(${JSON.stringify(candidate)}::jsonb, '{number}', to_jsonb(allocated.sheet_sequence), false),
        ${operatorId}::bigint, ${candidate.lockedAt}::timestamptz, true
      FROM allocated JOIN receipt ON receipt.lead_id = allocated.lead_id
      RETURNING id, lead_id, sequence, snapshot, locked_at
    )
    SELECT id, sequence, snapshot, locked_at FROM sheet`
  const existing = inserted.length ? [] : await sql`
    SELECT s.id, s.sequence, s.snapshot, s.locked_at
    FROM build_lock_receipts receipt
    JOIN build_sheets s ON s.id = receipt.build_sheet_id AND s.is_test = true
    JOIN leads l ON l.id = receipt.lead_id
    JOIN operators o ON o.id = ${operatorId}::bigint
      AND o.role = 'owner' AND o.active = true
    WHERE receipt.lead_id = ${leadId}::bigint AND receipt.lock_key = ${lockKey}::text
      AND receipt.is_test = true AND l.is_test = true
    LIMIT 1`
  const sheet = inserted[0] ?? existing[0]
  if (!sheet) throw new Error("The Build Sheet lock is still being filed. Tap once more.")
  return { sheet, inserted: inserted.length > 0 }
}
