import { createHash } from "node:crypto"
import { getSql } from "@/lib/db"
import {
  applyBuildDecision,
  classifyPaperwork,
  deriveBuildDraft,
  lockBuildSheet,
  type BuildClaim,
  type BuildDecision,
  type LockedBuildSheet,
  type PaperworkManifest,
} from "@/lib/build-sheets-domain.mjs"
import { compileBuildPaperwork, paperworkIssueDecision } from "@/lib/build-paperwork.mjs"
import { createCustomerBuildProjection } from "@/lib/build-sheets-continuation.mjs"
import type { CallSketchSpec } from "@/lib/call-sketch-live.mjs"
import { persistLockedBuildSheet, persistObservedBuildFacts } from "@/lib/build-sheets-persistence.mjs"

type StoredBuildClaimValue = Omit<BuildClaim, "id" | "sourceEventId">

type BuildLead = {
  id: number
  first_name: string
  last_name: string
  service: string
  created_at: string
  is_test: true
}

type PaperworkRow = {
  id: number
  kind: string
  label: string
  build_sheet_id: number
  source_sequence: number
  source_snapshot: LockedBuildSheet
  dependency_fingerprint: Array<{ factKey: string }>
  current_status: "current" | "old-numbers" | "needs-update"
  current_reason: string
  issue_state: "current" | "blocked"
}

function hashItem(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function observedFacts(spec: CallSketchSpec, sourceEventId: number): StoredBuildClaimValue[] {
  const facts: StoredBuildClaimValue[] = []
  const add = (fact: StoredBuildClaimValue) => facts.push(fact)
  const measurement = (factKey: string, subject: string, property: string, value: number, evidence: string, critical = true): StoredBuildClaimValue => ({
    factKey,
    subject,
    property,
    value,
    unit: "in",
    reference: "",
    original: evidence,
    speaker: "customer",
    certainty: "stated",
    critical,
  })
  if (typeof spec.width?.value === "number") {
    const evidence = spec.width.evidence || `${spec.width.value} inches`
    if (/\bopening\b/i.test(evidence) && !/\b(actual gate|gate itself|finished gate)\b/i.test(evidence)) {
      add({ ...measurement("opening.clear_width", "opening", "clear_width", spec.width.value, evidence), reference: "between posts" })
    } else if (/\b(actual gate|gate itself|finished gate)\b/i.test(evidence)) {
      add({ ...measurement("gate_leaf.finished_width", "gate_leaf", "finished_width", spec.width.value, evidence), reference: "outside edge to outside edge" })
    } else {
      const interpretationGroup = `event-${sourceEventId}-width`
      add({
        ...measurement("opening.clear_width", "opening", "clear_width", spec.width.value, evidence),
        reference: "between posts",
        certainty: "interpreted",
        interpretationGroup,
      })
      add({
        ...measurement("gate_leaf.finished_width", "gate_leaf", "finished_width", spec.width.value, evidence),
        reference: "outside edge to outside edge",
        certainty: "interpreted",
        interpretationGroup,
      })
    }
  }
  if (typeof spec.height?.value === "number") add({
    ...measurement("gate_leaf.finished_height", "gate_leaf", "finished_height", spec.height.value, spec.height.evidence || `${spec.height.value} inches`),
    reference: "bottom edge to top edge",
  })
  if (typeof spec.stockSize?.value === "number") add({
    ...measurement("frame.stock_size", "frame", "stock_size", spec.stockSize.value, spec.stockSize.evidence || `${spec.stockSize.value} inches`),
    reference: "outside stock size",
  })
  if (typeof spec.railCount?.value === "number") add({
    factKey: "frame.rail_count", subject: "frame", property: "rail_count", value: spec.railCount.value,
    unit: "count", reference: "inside frame", original: spec.railCount.evidence || `${spec.railCount.value} rails`,
    speaker: "customer", certainty: "stated", critical: true,
  })
  if (spec.hingeSide?.value) add({
    factKey: "gate.hinge_side", subject: "gate", property: "hinge_side", value: spec.hingeSide.value,
    unit: "", reference: "viewed from customer side", original: spec.hingeSide.evidence || `${spec.hingeSide.value} hinges`,
    speaker: "customer", certainty: "stated", critical: true,
  })
  if (spec.latchSide?.value) add({
    factKey: "gate.latch_side", subject: "gate", property: "latch_side", value: spec.latchSide.value,
    unit: "", reference: "viewed from customer side", original: spec.latchSide.evidence || `${spec.latchSide.value} latch`,
    speaker: "customer", certainty: "stated", critical: true,
  })
  if (spec.material?.value) add({
    factKey: "frame.material", subject: "frame", property: "material", value: spec.material.value,
    unit: "", reference: "", original: spec.material.evidence || spec.material.value,
    speaker: "customer", certainty: "stated", critical: false,
  })
  return facts
}

export async function ingestCallSketchBuildFacts(leadId: number) {
  const sql = getSql()
  const rows = (await sql`
    SELECT link.call_sid, sketch.observed_spec, transcript.id AS source_event_id
    FROM build_sketch_job_links link
    JOIN leads l ON l.id = link.lead_id AND l.is_test = true
    JOIN call_sketches sketch ON sketch.call_sid = link.call_sid
    JOIN LATERAL (
      SELECT e.id FROM events e
      WHERE e.lead_id = l.id AND e.kind = 'call.transcript'
        AND e.detail->>'callSid' = link.call_sid
      ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1
    ) transcript ON true
    WHERE link.lead_id = ${leadId}::bigint AND link.is_test = true
    LIMIT 1`) as Array<{ call_sid: string; observed_spec: CallSketchSpec; source_event_id: number }>
  const source = rows[0]
  if (!source) return []
  const facts = observedFacts(source.observed_spec, Number(source.source_event_id))
  return persistObservedBuildFacts({
    sql,
    leadId,
    callSid: source.call_sid,
    sourceEventId: Number(source.source_event_id),
    facts: facts.map((fact) => ({
      fact,
      itemKey: hashItem(`call-sketch:${source.call_sid}:${fact.factKey}:${fact.interpretationGroup ?? "direct"}`),
    })),
  })
}

function toBuildClaim(row: { id: number; source_event_id: number; value: StoredBuildClaimValue }): BuildClaim {
  return { id: Number(row.id), sourceEventId: Number(row.source_event_id), ...row.value }
}

export async function decideBuildFact(input: {
  leadId: number
  claimId: number
  operatorId: number
  kind: "confirm" | "working" | "reject"
  decisionKey: string
}) {
  const workspace = await getBuildsWorkspace(input.leadId)
  if (!workspace) throw new Error("Builds only changes an [INTERNAL TEST] job.")
  const claim = workspace.claims.find((item) => Number(item.id) === Number(input.claimId))
  if (!claim) throw new Error("That proposed fact is no longer in the draft.")
  const decidedAt = new Date().toISOString()
  const transition = applyBuildDecision(
    { claims: workspace.claims, decisions: workspace.decisions },
    { kind: input.kind, claimId: input.claimId, actorId: input.operatorId, decidedAt },
  )
  const decisionKey = input.decisionKey.trim().slice(0, 120)
  if (!decisionKey) throw new Error("The decision receipt is missing.")
  const externalId = `build-decision:${input.leadId}:${decisionKey}`
  const body = `${input.kind === "confirm" ? "Confirmed" : input.kind === "working" ? "Working number" : "Rejected"}: ${claim.factKey}`
  const detail = JSON.stringify({ claimId: input.claimId, state: input.kind, isTest: true, sensitivity: "owner" })
  const decisionsToWrite = transition.newDecisions.map((decision, index) => ({
    claim_id: Number(decision.claimId),
    state: decision.state,
    decision_key: `${decisionKey}:${index}:${decision.claimId}:${decision.state}`,
  }))
  const sql = getSql()
  const receipts = (await sql`
    WITH lead_scope AS (
      SELECT l.id AS lead_id, o.id AS operator_id
      FROM leads l JOIN operators o ON o.id = ${input.operatorId}::bigint
        AND o.role = 'owner' AND o.active = true
      WHERE l.id = ${input.leadId}::bigint AND l.is_test = true
    ), event_write AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, external_id,
        body, crew_body, detail
      )
      SELECT ${decidedAt}::timestamptz, 'build.fact-decided'::text,
        'operator'::text, scope.operator_id::text, scope.lead_id,
        ${externalId}::text, ${body}::text, NULL::text, ${detail}::jsonb
      FROM lead_scope scope
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id, lead_id
    ), event_scope AS (
      SELECT id, lead_id FROM event_write
      UNION ALL
      SELECT e.id, e.lead_id FROM events e JOIN lead_scope scope ON scope.lead_id = e.lead_id
      WHERE e.kind = 'build.fact-decided' AND e.external_id = ${externalId}::text
        AND NOT EXISTS (SELECT 1 FROM event_write)
      LIMIT 1
    ), decision_input AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(decisionsToWrite)}::jsonb)
        AS decision(claim_id bigint, state text, decision_key text)
    ), decision_write AS (
      INSERT INTO build_fact_decisions (
        lead_id, claim_id, state, actor_id, proposer_type, purpose, source_event_id,
        decision_key, is_test, decided_at
      )
      SELECT scope.lead_id, c.id, decision.state, scope.operator_id,
        'operator'::text, 'build-sheet'::text, event.id,
        decision.decision_key, true, ${decidedAt}::timestamptz
      FROM lead_scope scope JOIN event_scope event ON event.lead_id = scope.lead_id
      JOIN decision_input decision ON true
      JOIN claims c ON c.id = decision.claim_id AND c.subject_type = 'lead'
        AND c.subject_id = scope.lead_id AND c.predicate = 'build_fact'
      ON CONFLICT (lead_id, decision_key) DO NOTHING
      RETURNING decision_key
    ), decision_receipts AS (
      SELECT decision_key FROM decision_write
      UNION
      SELECT stored.decision_key FROM build_fact_decisions stored
      JOIN lead_scope scope ON scope.lead_id = stored.lead_id
      JOIN decision_input expected ON expected.decision_key = stored.decision_key
    ), superseded AS (
      UPDATE claims prior SET superseded_by = selected.id
      FROM claims selected, lead_scope scope
      WHERE selected.id = ${input.claimId}::bigint
        AND selected.subject_type = 'lead' AND selected.subject_id = scope.lead_id
        AND selected.predicate = 'build_fact'
        AND prior.subject_type = 'lead' AND prior.subject_id = scope.lead_id
        AND prior.predicate = 'build_fact' AND prior.superseded_by IS NULL
        AND prior.id <> selected.id
        AND prior.value->>'factKey' = selected.value->>'factKey'
        AND COALESCE(prior.value->>'reference', '') = COALESCE(selected.value->>'reference', '')
        AND ${input.kind !== "reject"}::boolean
        AND (SELECT count(*) FROM decision_receipts) = ${decisionsToWrite.length}::int
      RETURNING prior.id
    )
    SELECT count(*)::int AS receipt_count FROM decision_receipts`) as { receipt_count: number }[]
  if (Number(receipts[0]?.receipt_count ?? 0) !== decisionsToWrite.length) {
    throw new Error("The complete build decision could not be filed.")
  }
  return transition.draft
}

export async function proposeBuildFactChange(input: {
  leadId: number
  sourceClaimId: number
  operatorId: number
  value: number | string
  actionKey: string
}) {
  const workspace = await getBuildsWorkspace(input.leadId)
  if (!workspace) throw new Error("Builds only changes an [INTERNAL TEST] job.")
  const source = workspace.claims.find((claim) => Number(claim.id) === Number(input.sourceClaimId))
  if (!source) throw new Error("That source fact is no longer active.")
  let value: number | string
  if (typeof source.value === "number") {
    value = Number(input.value)
    if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a positive shop number.")
  } else {
    value = String(input.value).trim().slice(0, 120)
    if (!value) throw new Error("Enter the corrected shop fact.")
    if (["gate.hinge_side", "gate.latch_side"].includes(source.factKey)) {
      value = value.toLowerCase()
      if (!['left', 'right'].includes(value)) throw new Error("Choose left or right.")
    }
  }
  if (value === source.value) throw new Error("Enter a different value before proposing a change.")
  const actionKey = input.actionKey.trim().slice(0, 120)
  if (!actionKey) throw new Error("The correction receipt is missing.")
  const fact: StoredBuildClaimValue = {
    factKey: source.factKey,
    subject: source.subject,
    property: source.property,
    value,
    unit: source.unit,
    reference: source.reference,
    original: `Owner correction: ${value} ${source.unit}`.trim(),
    speaker: "owner",
    certainty: "corrected",
    critical: source.critical,
  }
  const externalId = `build-proposal:${input.leadId}:${actionKey}`
  const itemKey = hashItem(externalId)
  const decisionKey = `${actionKey}:proposed`
  const eventDetail = JSON.stringify({ sourceClaimId: source.id, factKey: source.factKey, value, unit: source.unit, isTest: true, sensitivity: "owner" })
  const sql = getSql()
  const rows = (await sql`
    WITH lead_scope AS (
      SELECT l.id AS lead_id, o.id AS operator_id
      FROM leads l JOIN operators o ON o.id = ${input.operatorId}::bigint
        AND o.role = 'owner' AND o.active = true
      WHERE l.id = ${input.leadId}::bigint AND l.is_test = true
    ), source_scope AS (
      SELECT c.id FROM claims c JOIN lead_scope scope ON scope.lead_id = c.subject_id
      WHERE c.id = ${input.sourceClaimId}::bigint AND c.subject_type = 'lead'
        AND c.predicate = 'build_fact' AND c.superseded_by IS NULL
    ), event_write AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, external_id,
        body, crew_body, detail
      )
      SELECT now(), 'build.fact-proposed'::text, 'operator'::text,
        scope.operator_id::text, scope.lead_id, ${externalId}::text,
        ${`Proposed ${source.factKey}: ${value} ${source.unit}`.trim()}::text,
        NULL::text, ${eventDetail}::jsonb
      FROM lead_scope scope JOIN source_scope source ON true
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id, lead_id
    ), event_scope AS (
      SELECT id, lead_id FROM event_write
      UNION ALL
      SELECT e.id, e.lead_id FROM events e JOIN lead_scope scope ON scope.lead_id = e.lead_id
      WHERE e.kind = 'build.fact-proposed' AND e.external_id = ${externalId}::text
        AND NOT EXISTS (SELECT 1 FROM event_write)
      LIMIT 1
    ), claim_write AS (
      INSERT INTO claims (
        subject_type, subject_id, predicate, value, confidence,
        source_event_id, extracted_by, item_key
      )
      SELECT 'lead'::text, scope.lead_id, 'build_fact'::text,
        ${JSON.stringify(fact)}::jsonb, 1::real, event.id,
        'build-sheets'::text, ${itemKey}::text
      FROM lead_scope scope JOIN event_scope event ON event.lead_id = scope.lead_id
      ON CONFLICT (source_event_id, item_key) WHERE item_key <> '' DO NOTHING
      RETURNING id, source_event_id
    ), claim_scope AS (
      SELECT id, source_event_id FROM claim_write
      UNION ALL
      SELECT c.id, c.source_event_id FROM claims c
      JOIN event_scope event ON event.id = c.source_event_id
      WHERE c.item_key = ${itemKey}::text AND NOT EXISTS (SELECT 1 FROM claim_write)
      LIMIT 1
    ), decision_write AS (
      INSERT INTO build_fact_decisions (
        lead_id, claim_id, state, actor_id, proposer_type, purpose,
        source_event_id, decision_key, is_test, decided_at
      )
      SELECT scope.lead_id, claim.id, 'proposed'::text, scope.operator_id,
        'operator'::text, 'build-sheet'::text, claim.source_event_id,
        ${decisionKey}::text, true, now()
      FROM lead_scope scope JOIN claim_scope claim ON true
      ON CONFLICT (lead_id, decision_key) DO NOTHING
      RETURNING decision_key
    ), decision_receipt AS (
      SELECT decision_key FROM decision_write
      UNION
      SELECT stored.decision_key FROM build_fact_decisions stored
      JOIN lead_scope scope ON scope.lead_id = stored.lead_id
      WHERE stored.decision_key = ${decisionKey}::text
    ), conflict_write AS (
      INSERT INTO build_claim_conflicts (
        lead_id, conflict_key, kind, claim_ids, source_event_id, is_test
      )
      SELECT scope.lead_id, ('proposal:' || claim.id::text)::text,
        'different-values'::text, ARRAY[source.id, claim.id]::bigint[],
        claim.source_event_id, true
      FROM lead_scope scope JOIN source_scope source ON true JOIN claim_scope claim ON true
      ON CONFLICT (lead_id, conflict_key) DO NOTHING
      RETURNING conflict_key
    ), conflict_receipt AS (
      SELECT conflict_key FROM conflict_write
      UNION
      SELECT stored.conflict_key FROM build_claim_conflicts stored
      JOIN lead_scope scope ON scope.lead_id = stored.lead_id
      JOIN claim_scope claim ON stored.conflict_key = ('proposal:' || claim.id::text)
    )
    SELECT claim.id FROM claim_scope claim
    WHERE EXISTS (SELECT 1 FROM decision_receipt)
      AND EXISTS (SELECT 1 FROM conflict_receipt)`) as { id: number }[]
  const claimId = Number(rows[0]?.id ?? 0)
  if (!claimId) throw new Error("The complete corrected fact could not be filed.")
  return claimId
}

const WORKING_FACTS: Record<string, Omit<StoredBuildClaimValue, "value" | "original">> = {
  "gate_leaf.finished_width": { factKey: "gate_leaf.finished_width", subject: "gate_leaf", property: "finished_width", unit: "in", reference: "outside edge to outside edge", speaker: "owner", certainty: "corrected", critical: true },
  "gate_leaf.finished_height": { factKey: "gate_leaf.finished_height", subject: "gate_leaf", property: "finished_height", unit: "in", reference: "bottom edge to top edge", speaker: "owner", certainty: "corrected", critical: true },
  "frame.stock_size": { factKey: "frame.stock_size", subject: "frame", property: "stock_size", unit: "in", reference: "outside stock size", speaker: "owner", certainty: "corrected", critical: true },
  "frame.rail_count": { factKey: "frame.rail_count", subject: "frame", property: "rail_count", unit: "count", reference: "inside frame", speaker: "owner", certainty: "corrected", critical: true },
}

export async function addWorkingBuildFact(input: {
  leadId: number
  factKey: string
  operatorId: number
  value: number
  actionKey: string
}) {
  const template = WORKING_FACTS[input.factKey]
  if (!template || !Number.isFinite(input.value) || input.value <= 0) throw new Error("Enter a valid Working number.")
  const actionKey = input.actionKey.trim().slice(0, 120)
  if (!actionKey) throw new Error("The Working number receipt is missing.")
  const fact = { ...template, value: input.value, original: `Owner Working number: ${input.value} ${template.unit}`.trim() }
  const externalId = `build-working:${input.leadId}:${actionKey}`
  const itemKey = hashItem(externalId)
  const decisionKey = `${actionKey}:working`
  const detail = JSON.stringify({ factKey: input.factKey, value: input.value, unit: template.unit, isTest: true, sensitivity: "owner" })
  const sql = getSql()
  const rows = (await sql`
    WITH lead_scope AS (
      SELECT l.id AS lead_id, o.id AS operator_id
      FROM leads l JOIN operators o ON o.id = ${input.operatorId}::bigint
        AND o.role = 'owner' AND o.active = true
      WHERE l.id = ${input.leadId}::bigint AND l.is_test = true
        AND NOT EXISTS (
          SELECT 1 FROM claims active
          WHERE active.subject_type = 'lead' AND active.subject_id = l.id
            AND active.predicate = 'build_fact' AND active.superseded_by IS NULL
            AND active.value->>'factKey' = ${input.factKey}::text
        )
    ), event_write AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, external_id,
        body, crew_body, detail
      )
      SELECT now(), 'build.working-number'::text, 'operator'::text,
        scope.operator_id::text, scope.lead_id, ${externalId}::text,
        ${`Working number for ${input.factKey}: ${input.value} ${template.unit}`.trim()}::text,
        NULL::text, ${detail}::jsonb
      FROM lead_scope scope
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id, lead_id
    ), event_scope AS (
      SELECT id, lead_id FROM event_write
      UNION ALL
      SELECT e.id, e.lead_id FROM events e JOIN leads l ON l.id = e.lead_id
      WHERE e.kind = 'build.working-number' AND e.external_id = ${externalId}::text
        AND l.id = ${input.leadId}::bigint AND l.is_test = true
        AND NOT EXISTS (SELECT 1 FROM event_write)
      LIMIT 1
    ), claim_write AS (
      INSERT INTO claims (
        subject_type, subject_id, predicate, value, confidence,
        source_event_id, extracted_by, item_key
      )
      SELECT 'lead'::text, event.lead_id, 'build_fact'::text,
        ${JSON.stringify(fact)}::jsonb, 1::real, event.id,
        'build-sheets'::text, ${itemKey}::text
      FROM event_scope event
      ON CONFLICT (source_event_id, item_key) WHERE item_key <> '' DO NOTHING
      RETURNING id, subject_id, source_event_id
    ), claim_scope AS (
      SELECT id, subject_id, source_event_id FROM claim_write
      UNION ALL
      SELECT c.id, c.subject_id, c.source_event_id FROM claims c
      JOIN event_scope event ON event.id = c.source_event_id
      WHERE c.item_key = ${itemKey}::text AND NOT EXISTS (SELECT 1 FROM claim_write)
      LIMIT 1
    ), decision_write AS (
      INSERT INTO build_fact_decisions (
        lead_id, claim_id, state, actor_id, proposer_type, purpose,
        source_event_id, decision_key, is_test, decided_at
      )
      SELECT claim.subject_id, claim.id, 'working-number'::text, scope.operator_id,
        'operator'::text, 'build-sheet'::text, claim.source_event_id,
        ${decisionKey}::text, true, now()
      FROM claim_scope claim JOIN lead_scope scope ON scope.lead_id = claim.subject_id
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
    WHERE EXISTS (SELECT 1 FROM decision_receipt)`) as { id: number }[]
  const claimId = Number(rows[0]?.id ?? 0)
  if (!claimId) throw new Error("The complete Working number could not be filed.")
  return claimId
}

async function ensurePaperworkForSheet(input: { leadId: number; sheetId: number; snapshot: LockedBuildSheet }) {
  const sql = getSql()
  const geometry = input.snapshot.facts
    .filter((fact) => fact.critical)
    .map((fact) => ({ factKey: fact.factKey, value: fact.value, unit: fact.unit, reference: fact.reference }))
  const finish = input.snapshot.facts
    .filter((fact) => fact.factKey === "gate.finish")
    .map((fact) => ({ factKey: fact.factKey, value: fact.value, unit: fact.unit, reference: fact.reference }))
  const material = input.snapshot.facts
    .filter((fact) => fact.factKey === "frame.material")
    .map((fact) => ({ factKey: fact.factKey, value: fact.value, unit: fact.unit, reference: fact.reference }))
  const entries = [
    { kind: "drawing", label: "Gate drawing", dependencies: geometry, issueState: "current" },
    { kind: "dxf", label: "Gate DXF", dependencies: geometry, issueState: input.snapshot.fabrication.ready ? "current" : "blocked" },
    ...(material.length ? [{ kind: "material-note", label: "Material note", dependencies: material, issueState: "current" }] : []),
    ...(finish.length ? [{ kind: "finish-note", label: "Finish note", dependencies: finish, issueState: "current" }] : []),
  ]
  for (const entry of entries) {
    await sql`
      INSERT INTO build_paperwork (
        lead_id, build_sheet_id, kind, label, dependency_fingerprint,
        current_status, current_reason, issue_state, is_test
      )
      SELECT s.lead_id, s.id, ${entry.kind}::text, ${entry.label}::text,
        ${JSON.stringify(entry.dependencies)}::jsonb, 'current'::text, ''::text,
        ${entry.issueState}::text, true
      FROM build_sheets s JOIN leads l ON l.id = s.lead_id
      WHERE s.id = ${input.sheetId}::bigint AND s.lead_id = ${input.leadId}::bigint
        AND s.is_test = true AND l.is_test = true
      ON CONFLICT (build_sheet_id, kind) DO NOTHING`
  }
}

async function markReleasedPaperwork(leadId: number, releasedSheet: LockedBuildSheet) {
  const sql = getSql()
  const rows = (await sql`
    SELECT p.id, p.kind, p.dependency_fingerprint, s.sequence, s.snapshot
    FROM build_paperwork p JOIN build_sheets s ON s.id = p.build_sheet_id
    JOIN leads l ON l.id = p.lead_id
    WHERE p.lead_id = ${leadId}::bigint AND p.is_test = true
      AND s.is_test = true AND l.is_test = true
      AND s.sequence < ${releasedSheet.number}::int
    ORDER BY p.id`) as Array<{
      id: number
      kind: string
      dependency_fingerprint: Array<{ factKey: string }>
      sequence: number
      snapshot: LockedBuildSheet
    }>
  for (const row of rows) {
    const [status] = classifyPaperwork({
      manifests: [{
        id: Number(row.id), kind: row.kind, sourceBuildSheetNumber: Number(row.sequence),
        dependencies: row.dependency_fingerprint.map((item) => item.factKey),
      }],
      sourceSheet: row.snapshot,
      releasedSheet,
    })
    if (!status || status.status === "current" || status.status === "hold") continue
    await sql`
      UPDATE build_paperwork p SET current_status = ${status.status}::text,
        current_reason = ${status.reason}::text, issue_state = 'blocked'
      FROM leads l
      WHERE p.id = ${row.id}::bigint AND p.lead_id = l.id
        AND p.lead_id = ${leadId}::bigint AND p.is_test = true AND l.is_test = true`
  }
}

export async function lockCurrentBuildSheet(input: {
  leadId: number
  operatorId: number
  lockKey: string
}) {
  const leadId = Number(input.leadId)
  const lockKey = input.lockKey.trim().slice(0, 120)
  if (!lockKey) throw new Error("The Build Sheet lock receipt is missing.")
  const workspace = await getBuildsWorkspace(leadId)
  if (!workspace) throw new Error("Builds only opens for an [INTERNAL TEST] job.")
  const candidate = lockBuildSheet({
    jobId: leadId,
    sequence: 1,
    idempotencyKey: lockKey,
    lockedAt: new Date().toISOString(),
    claims: workspace.claims,
    decisions: workspace.decisions,
  })
  const sql = getSql()
  const persisted = await persistLockedBuildSheet({ sql, leadId, operatorId: input.operatorId, lockKey, candidate })
  const sheet = persisted.sheet
  await ensurePaperworkForSheet({ leadId, sheetId: Number(sheet.id), snapshot: sheet.snapshot })
  if (persisted.inserted) await markReleasedPaperwork(leadId, sheet.snapshot)
  return { id: Number(sheet.id), number: Number(sheet.sequence), snapshot: sheet.snapshot, lockedAt: sheet.locked_at }
}

export async function getBuildsWorkspace(leadId: number) {
  const sql = getSql()
  const leads = (await sql`
    SELECT l.id, l.first_name, l.last_name, l.service, l.created_at, l.is_test
    FROM leads l
    WHERE l.id = ${leadId}::bigint AND l.is_test = true
    LIMIT 1`) as BuildLead[]
  const lead = leads[0]
  if (!lead) return null
  const [claimRows, decisionRows, sheetRows, paperworkRows] = await Promise.all([
    sql`
      SELECT c.id, c.source_event_id, c.value
      FROM claims c JOIN leads l ON l.id = c.subject_id AND c.subject_type = 'lead'
      WHERE l.id = ${leadId}::bigint AND l.is_test = true
        AND c.predicate = 'build_fact' AND c.superseded_by IS NULL
      ORDER BY c.created_at, c.id`,
    sql`
      SELECT d.id, d.claim_id, d.state, d.actor_id, d.proposer_type, d.purpose, d.decided_at
      FROM build_fact_decisions d JOIN leads l ON l.id = d.lead_id
      WHERE d.lead_id = ${leadId}::bigint AND d.is_test = true AND l.is_test = true
      ORDER BY d.decided_at, d.id`,
    sql`
      SELECT s.id, s.sequence, s.snapshot, s.locked_at, COALESCE(o.name, o.email) AS locked_by_name
      FROM build_sheets s JOIN leads l ON l.id = s.lead_id
      JOIN operators o ON o.id = s.locked_by
      WHERE s.lead_id = ${leadId}::bigint AND s.is_test = true AND l.is_test = true
      ORDER BY s.sequence`,
    sql`
      SELECT p.id, p.kind, p.label, p.build_sheet_id, p.dependency_fingerprint,
        p.current_status, p.current_reason, p.issue_state,
        s.sequence AS source_sequence, s.snapshot AS source_snapshot
      FROM build_paperwork p JOIN leads l ON l.id = p.lead_id
      JOIN build_sheets s ON s.id = p.build_sheet_id AND s.is_test = true
      WHERE p.lead_id = ${leadId}::bigint AND p.is_test = true AND l.is_test = true
      ORDER BY p.created_at, p.id`,
  ])
  const claims = (claimRows as Array<{ id: number; source_event_id: number; value: StoredBuildClaimValue }>).map(toBuildClaim)
  const decisions = (decisionRows as Array<{ id: number; claim_id: number; state: BuildDecision["state"]; actor_id: number; proposer_type: "operator" | "system" | "customer"; purpose: string; decided_at: string }>).map((row) => ({
    id: Number(row.id), claimId: Number(row.claim_id), state: row.state,
    actorId: Number(row.actor_id), proposerType: row.proposer_type, purpose: row.purpose, decidedAt: row.decided_at,
  }))
  const draft = deriveBuildDraft({ claims, decisions })
  const sheets = (sheetRows as Array<{ id: number; sequence: number; snapshot: LockedBuildSheet; locked_at: string; locked_by_name: string }>).map((row) => ({
    id: Number(row.id), number: Number(row.sequence), snapshot: row.snapshot,
    lockedAt: row.locked_at, lockedBy: row.locked_by_name,
  }))
  const currentSheet = sheets.at(-1)?.snapshot ?? null
  const paperwork = (paperworkRows as PaperworkRow[]).map((row) => {
    const manifest: PaperworkManifest = {
      id: Number(row.id), kind: row.kind, sourceBuildSheetNumber: Number(row.source_sequence),
      dependencies: (row.dependency_fingerprint ?? []).map((item) => item.factKey),
    }
    const [classified] = classifyPaperwork({
      manifests: [manifest], sourceSheet: row.source_snapshot, draft,
      releasedSheet: currentSheet && Number(currentSheet.number) > Number(row.source_sequence) ? currentSheet : null,
    })
    return { ...classified, label: row.label, issueState: row.issue_state }
  })
  return { lead, claims, decisions, draft, sheets, paperwork }
}

export async function getCustomerBuildProjection(leadId: number) {
  const sql = getSql()
  const sheets = (await sql`
    SELECT s.id, s.sequence, s.snapshot
    FROM build_sheets s JOIN leads l ON l.id = s.lead_id
    WHERE s.lead_id = ${leadId}::bigint AND s.is_test = true AND l.is_test = true
    ORDER BY s.sequence DESC LIMIT 1`) as Array<{
      id: number
      sequence: number
      snapshot: LockedBuildSheet
    }>
  const sheet = sheets[0]
  if (!sheet) return null
  const responses = (await sql`
    SELECT DISTINCT ON (r.claim_id) r.claim_id, r.response_state, r.responded_at
    FROM build_customer_responses r JOIN leads l ON l.id = r.lead_id
    WHERE r.lead_id = ${leadId}::bigint AND r.build_sheet_id = ${sheet.id}::bigint
      AND r.is_test = true AND l.is_test = true
    ORDER BY r.claim_id, r.responded_at DESC, r.id DESC`) as Array<{
      claim_id: number
      response_state: "accepted" | "corrected"
      responded_at: string
    }>
  return {
    sheetId: Number(sheet.id),
    ...createCustomerBuildProjection({
      sheet: sheet.snapshot,
      customerConfirmations: responses.map((response) => ({
        claimId: Number(response.claim_id),
        state: response.response_state,
        respondedAt: response.responded_at,
      })),
    }),
  }
}

function customerCorrectionValue(source: BuildClaim, rawValue: string) {
  if (typeof source.value === "number") {
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a positive number for the shop to review.")
    if (value === source.value) throw new Error("That matches the current Build Sheet.")
    return value
  }
  const value = rawValue.replace(/\s+/g, " ").trim().slice(0, 120)
  if (!value) throw new Error("Enter the correction for the shop to review.")
  if (["gate.hinge_side", "gate.latch_side"].includes(source.factKey) && !["left", "right"].includes(value.toLowerCase())) {
    throw new Error("Choose left or right.")
  }
  if (value.toLowerCase() === String(source.value).toLowerCase()) throw new Error("That matches the current Build Sheet.")
  return ["gate.hinge_side", "gate.latch_side"].includes(source.factKey) ? value.toLowerCase() : value
}

export async function respondToCustomerBuildFact(input: {
  leadId: number
  tokenHash: string
  buildSheetNumber: number
  claimId: number
  intent: "accept" | "correct"
  correction?: string
  responseKey: string
}) {
  const responseKey = input.responseKey.trim().slice(0, 120)
  if (!responseKey) throw new Error("The response receipt is missing. Reload the Customer Page.")
  const sql = getSql()
  const rows = (await sql`
    SELECT s.id, s.sequence, s.snapshot
    FROM build_sheets s JOIN leads l ON l.id = s.lead_id
    JOIN glass_links g ON g.lead_id = l.id
    WHERE s.lead_id = ${input.leadId}::bigint AND s.sequence = ${input.buildSheetNumber}::int
      AND s.is_test = true AND l.is_test = true AND g.token_hash = ${input.tokenHash}::text
      AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
      AND NOT EXISTS (
        SELECT 1 FROM build_sheets newer
        WHERE newer.lead_id = s.lead_id AND newer.is_test = true AND newer.sequence > s.sequence
      )
    LIMIT 1`) as Array<{ id: number; sequence: number; snapshot: LockedBuildSheet }>
  const sheet = rows[0]
  if (!sheet) throw new Error("A newer Build Sheet is ready. Reload before responding.")
  const source = sheet.snapshot.facts.find((fact) => Number(fact.id) === Number(input.claimId))
  if (!source) throw new Error("That build fact is no longer on the current sheet.")
  if (input.intent === "accept") {
    const externalId = `build-customer:${input.leadId}:${input.buildSheetNumber}:${input.claimId}:accepted:${responseKey}`
    const receipts = (await sql`
      WITH scope AS (
        SELECT s.id AS build_sheet_id, s.lead_id, c.id AS claim_id
        FROM build_sheets s JOIN leads l ON l.id = s.lead_id
        JOIN glass_links g ON g.lead_id = l.id
        JOIN claims c ON c.id = ${input.claimId}::bigint AND c.subject_type = 'lead'
          AND c.subject_id = l.id AND c.predicate = 'build_fact'
        WHERE s.id = ${sheet.id}::bigint AND s.lead_id = ${input.leadId}::bigint
          AND s.is_test = true AND l.is_test = true AND g.token_hash = ${input.tokenHash}::text
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
          AND NOT EXISTS (
            SELECT 1 FROM build_sheets newer
            WHERE newer.lead_id = s.lead_id AND newer.is_test = true AND newer.sequence > s.sequence
          )
          AND NOT EXISTS (
            SELECT 1 FROM build_customer_responses keyed
            WHERE keyed.lead_id = s.lead_id AND keyed.response_key = ${responseKey}::text
              AND (keyed.build_sheet_id <> s.id OR keyed.claim_id <> c.id
                OR keyed.response_state <> 'accepted' OR keyed.proposed_claim_id IS NOT NULL
                OR keyed.token_hash <> ${input.tokenHash}::text)
          )
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(s.snapshot->'facts') fact
            WHERE (fact->>'id')::bigint = c.id
          )
      ), event_write AS (
        INSERT INTO events (
          kind, actor_type, lead_id, external_id, body, crew_body, detail
        )
        SELECT 'build.customer-response'::text, 'customer'::text, scope.lead_id,
          ${externalId}::text, 'Customer confirmed a Build Sheet fact.'::text,
          'Customer confirmed a Build Sheet fact.'::text,
          ${JSON.stringify({ buildSheetNumber: input.buildSheetNumber, claimId: input.claimId, response: "accepted", isTest: true })}::jsonb
        FROM scope
        ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
        RETURNING id, lead_id
      ), event_scope AS (
        SELECT id, lead_id FROM event_write
        UNION ALL
        SELECT e.id, e.lead_id FROM events e JOIN scope ON scope.lead_id = e.lead_id
        WHERE e.kind = 'build.customer-response' AND e.external_id = ${externalId}::text
          AND NOT EXISTS (SELECT 1 FROM event_write)
        LIMIT 1
      ), response_write AS (
        INSERT INTO build_customer_responses (
          lead_id, build_sheet_id, claim_id, response_state, source_event_id,
          token_hash, response_key, is_test
        )
        SELECT scope.lead_id, scope.build_sheet_id, scope.claim_id, 'accepted'::text,
          event.id, ${input.tokenHash}::text, ${responseKey}::text, true
        FROM scope JOIN event_scope event ON event.lead_id = scope.lead_id
        ON CONFLICT (lead_id, response_key) DO NOTHING
        RETURNING id
      )
      SELECT id FROM response_write
      UNION ALL
      SELECT stored.id FROM build_customer_responses stored JOIN scope
        ON scope.lead_id = stored.lead_id AND scope.build_sheet_id = stored.build_sheet_id AND scope.claim_id = stored.claim_id
      WHERE stored.response_key = ${responseKey}::text
        AND stored.response_state = 'accepted' AND stored.proposed_claim_id IS NULL
        AND stored.token_hash = ${input.tokenHash}::text
        AND NOT EXISTS (SELECT 1 FROM response_write)
      LIMIT 1`) as { id: number }[]
    if (!receipts[0]) throw new Error("The customer confirmation could not be filed.")
    return { state: "accepted" as const, responseId: Number(receipts[0].id) }
  }

  const value = customerCorrectionValue(source, String(input.correction ?? ""))
  const fact: StoredBuildClaimValue = {
    factKey: source.factKey,
    subject: source.subject,
    property: source.property,
    value,
    unit: source.unit,
    reference: source.reference,
    original: "Customer correction proposed on the Customer Page.",
    speaker: "customer",
    certainty: "corrected",
    critical: source.critical,
  }
  const externalId = `build-customer:${input.leadId}:${input.buildSheetNumber}:${input.claimId}:corrected:${hashItem(JSON.stringify(value))}:${responseKey}`
  const itemKey = hashItem(`${externalId}:claim`)
  const decisionKey = `${responseKey}:${input.buildSheetNumber}:${input.claimId}:${hashItem(JSON.stringify(value))}:customer-proposed`
  const corrections = (await sql`
    WITH scope AS (
      SELECT s.id AS build_sheet_id, s.lead_id, c.id AS claim_id, owner.id AS owner_id
      FROM build_sheets s JOIN leads l ON l.id = s.lead_id
      JOIN glass_links g ON g.lead_id = l.id
      JOIN claims c ON c.id = ${input.claimId}::bigint AND c.subject_type = 'lead'
        AND c.subject_id = l.id AND c.predicate = 'build_fact'
      JOIN LATERAL (
        SELECT o.id FROM operators o WHERE o.role = 'owner' AND o.active = true
        ORDER BY o.created_at, o.id LIMIT 1
      ) owner ON true
      WHERE s.id = ${sheet.id}::bigint AND s.lead_id = ${input.leadId}::bigint
        AND s.is_test = true AND l.is_test = true AND g.token_hash = ${input.tokenHash}::text
        AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
        AND NOT EXISTS (
          SELECT 1 FROM build_sheets newer
          WHERE newer.lead_id = s.lead_id AND newer.is_test = true AND newer.sequence > s.sequence
        )
        AND NOT EXISTS (
          SELECT 1 FROM build_customer_responses keyed
          LEFT JOIN claims proposed ON proposed.id = keyed.proposed_claim_id
          WHERE keyed.lead_id = s.lead_id AND keyed.response_key = ${responseKey}::text
            AND (keyed.build_sheet_id <> s.id OR keyed.claim_id <> c.id
              OR keyed.response_state <> 'corrected' OR keyed.proposed_claim_id IS NULL
              OR keyed.token_hash <> ${input.tokenHash}::text
              OR proposed.value->>'factKey' <> ${source.factKey}::text
              OR proposed.value->'value' IS DISTINCT FROM ${JSON.stringify(value)}::jsonb)
        )
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(s.snapshot->'facts') snapshot_fact
          WHERE (snapshot_fact->>'id')::bigint = c.id
        )
    ), event_write AS (
      INSERT INTO events (
        kind, actor_type, lead_id, external_id, body, crew_body, detail
      )
      SELECT 'build.customer-correction'::text, 'customer'::text, scope.lead_id,
        ${externalId}::text, ${`Customer proposed a correction to ${source.factKey}.`}::text,
        'Customer proposed a Build Sheet correction.'::text,
        ${JSON.stringify({ buildSheetNumber: input.buildSheetNumber, claimId: input.claimId, factKey: source.factKey, value, unit: source.unit, isTest: true })}::jsonb
      FROM scope
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id, lead_id
    ), event_scope AS (
      SELECT id, lead_id FROM event_write
      UNION ALL
      SELECT e.id, e.lead_id FROM events e JOIN scope ON scope.lead_id = e.lead_id
      WHERE e.kind = 'build.customer-correction' AND e.external_id = ${externalId}::text
        AND NOT EXISTS (SELECT 1 FROM event_write)
      LIMIT 1
    ), claim_write AS (
      INSERT INTO claims (
        subject_type, subject_id, predicate, value, confidence,
        source_event_id, extracted_by, item_key
      )
      SELECT 'lead'::text, scope.lead_id, 'build_fact'::text, ${JSON.stringify(fact)}::jsonb,
        1::real, event.id, 'customer-build-confirmation'::text, ${itemKey}::text
      FROM scope JOIN event_scope event ON event.lead_id = scope.lead_id
      ON CONFLICT (source_event_id, item_key) WHERE item_key <> '' DO NOTHING
      RETURNING id, source_event_id
    ), claim_scope AS (
      SELECT id, source_event_id FROM claim_write
      UNION ALL
      SELECT c.id, c.source_event_id FROM claims c JOIN event_scope event ON event.id = c.source_event_id
      WHERE c.item_key = ${itemKey}::text AND NOT EXISTS (SELECT 1 FROM claim_write)
      LIMIT 1
    ), decision_write AS (
      INSERT INTO build_fact_decisions (
        lead_id, claim_id, state, actor_id, proposer_type, purpose,
        source_event_id, decision_key, is_test, decided_at
      )
      SELECT scope.lead_id, claim.id, 'proposed'::text, scope.owner_id,
        'customer'::text, 'customer-correction'::text, claim.source_event_id,
        ${decisionKey}::text, true, now()
      FROM scope JOIN claim_scope claim ON true
      ON CONFLICT (lead_id, decision_key) DO NOTHING
      RETURNING claim_id
    ), conflict_write AS (
      INSERT INTO build_claim_conflicts (
        lead_id, conflict_key, kind, claim_ids, source_event_id, is_test
      )
      SELECT scope.lead_id, ('customer:' || claim.id::text)::text, 'different-values'::text,
        ARRAY[scope.claim_id, claim.id]::bigint[], claim.source_event_id, true
      FROM scope JOIN claim_scope claim ON true
      ON CONFLICT (lead_id, conflict_key) DO NOTHING
      RETURNING conflict_key
    ), response_write AS (
      INSERT INTO build_customer_responses (
        lead_id, build_sheet_id, claim_id, response_state, proposed_claim_id,
        source_event_id, token_hash, response_key, is_test
      )
      SELECT scope.lead_id, scope.build_sheet_id, scope.claim_id, 'corrected'::text,
        claim.id, claim.source_event_id, ${input.tokenHash}::text, ${responseKey}::text, true
      FROM scope JOIN claim_scope claim ON true
      WHERE EXISTS (SELECT 1 FROM build_fact_decisions d WHERE d.lead_id = scope.lead_id AND d.claim_id = claim.id AND d.decision_key = ${decisionKey}::text)
        AND EXISTS (SELECT 1 FROM build_claim_conflicts conflict WHERE conflict.lead_id = scope.lead_id AND conflict.conflict_key = ('customer:' || claim.id::text))
      ON CONFLICT (lead_id, response_key) DO NOTHING
      RETURNING id, proposed_claim_id
    )
    SELECT id, proposed_claim_id FROM response_write
    UNION ALL
    SELECT stored.id, stored.proposed_claim_id FROM build_customer_responses stored
    JOIN scope ON scope.lead_id = stored.lead_id AND scope.build_sheet_id = stored.build_sheet_id AND scope.claim_id = stored.claim_id
    JOIN claims proposed ON proposed.id = stored.proposed_claim_id
    WHERE stored.response_key = ${responseKey}::text
      AND stored.response_state = 'corrected'
      AND stored.token_hash = ${input.tokenHash}::text
      AND proposed.value->>'factKey' = ${source.factKey}::text
      AND proposed.value->'value' = ${JSON.stringify(value)}::jsonb
      AND NOT EXISTS (SELECT 1 FROM response_write)
    LIMIT 1`) as Array<{ id: number; proposed_claim_id: number }>
  if (!corrections[0]?.proposed_claim_id) throw new Error("The customer correction draft could not be filed.")
  return {
    state: "corrected" as const,
    responseId: Number(corrections[0].id),
    proposedClaimId: Number(corrections[0].proposed_claim_id),
  }
}

export async function issueBuildPaperwork(input: {
  paperworkId: number
  operatorId: number
  issueKey: string
}) {
  const issueKey = input.issueKey.trim().slice(0, 120)
  if (!issueKey) throw new Error("The Paperwork issue receipt is missing.")
  const sql = getSql()
  const rows = (await sql`
    SELECT p.lead_id
    FROM build_paperwork p JOIN leads l ON l.id = p.lead_id
    JOIN operators o ON o.id = ${input.operatorId}::bigint AND o.role = 'owner' AND o.active = true
    WHERE p.id = ${input.paperworkId}::bigint AND p.is_test = true AND l.is_test = true
    LIMIT 1`) as Array<{ lead_id: number }>
  const leadId = Number(rows[0]?.lead_id ?? 0)
  if (!leadId) throw new Error("That internal-test Paperwork is unavailable.")
  const workspace = await getBuildsWorkspace(leadId)
  if (!workspace) throw new Error("That internal-test Paperwork is unavailable.")
  const item = workspace.paperwork.find((paperwork) => Number(paperwork.id) === Number(input.paperworkId))
  const currentSheet = workspace.sheets.at(-1)
  if (!item || !currentSheet) throw new Error("That Paperwork no longer has a locked source.")
  const decision = paperworkIssueDecision({
    kind: item.kind,
    status: item.status,
    issueState: item.issueState,
    sourceBuildSheetNumber: item.sourceBuildSheetNumber,
    currentBuildSheetNumber: currentSheet.number,
    fabricationReady: currentSheet.snapshot.fabrication.ready,
  })
  if (!decision.allowed) throw new Error(decision.reason)
  if (!['drawing', 'dxf'].includes(item.kind)) throw new Error("This Paperwork is a manifest note, not an issued file.")
  const compiled = compileBuildPaperwork({ kind: item.kind as "drawing" | "dxf", sheet: currentSheet.snapshot })
  const receipts = (await sql`
    WITH scope AS (
      SELECT p.id AS paperwork_id, p.lead_id, p.build_sheet_id
      FROM build_paperwork p JOIN leads l ON l.id = p.lead_id
      JOIN build_sheets s ON s.id = p.build_sheet_id AND s.is_test = true
      JOIN operators o ON o.id = ${input.operatorId}::bigint AND o.role = 'owner' AND o.active = true
      WHERE p.id = ${input.paperworkId}::bigint AND p.lead_id = ${leadId}::bigint
        AND p.is_test = true AND l.is_test = true
        AND p.current_status = 'current' AND p.issue_state = 'current'
        AND s.sequence = (
          SELECT max(latest.sequence) FROM build_sheets latest
          WHERE latest.lead_id = p.lead_id AND latest.is_test = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM claims active
          JOIN LATERAL jsonb_array_elements(p.dependency_fingerprint) dependency
            ON active.value->>'factKey' = dependency->>'factKey'
          WHERE active.subject_type = 'lead' AND active.subject_id = p.lead_id
            AND active.predicate = 'build_fact' AND active.superseded_by IS NULL
            AND COALESCE((
              SELECT decision.state FROM build_fact_decisions decision
              WHERE decision.lead_id = p.lead_id AND decision.claim_id = active.id
              ORDER BY decision.decided_at DESC, decision.id DESC
              LIMIT 1
            ), 'proposed') NOT IN ('rejected', 'superseded')
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(s.snapshot->'facts') source_fact
              WHERE source_fact->>'factKey' = active.value->>'factKey'
                AND source_fact->'value' = active.value->'value'
                AND COALESCE(source_fact->>'unit', '') = COALESCE(active.value->>'unit', '')
                AND COALESCE(source_fact->>'reference', '') = COALESCE(active.value->>'reference', '')
            )
        )
    ), issue_write AS (
      INSERT INTO build_paperwork_issues (
        lead_id, paperwork_id, build_sheet_id, issue_key, content_hash,
        issued_by, is_test
      )
      SELECT scope.lead_id, scope.paperwork_id, scope.build_sheet_id,
        ${issueKey}::text, ${compiled.contentHash}::text, ${input.operatorId}::bigint, true
      FROM scope
      ON CONFLICT (paperwork_id, issue_key) DO NOTHING
      RETURNING id
    )
    SELECT id FROM issue_write
    UNION ALL
    SELECT stored.id FROM build_paperwork_issues stored JOIN scope ON scope.paperwork_id = stored.paperwork_id
    WHERE stored.issue_key = ${issueKey}::text AND stored.content_hash = ${compiled.contentHash}::text
      AND NOT EXISTS (SELECT 1 FROM issue_write)
    LIMIT 1`) as Array<{ id: number }>
  if (!receipts[0]) throw new Error("Paperwork changed before issue. Reload the current Build Sheet.")
  return { ...compiled, issueId: Number(receipts[0].id), leadId }
}
