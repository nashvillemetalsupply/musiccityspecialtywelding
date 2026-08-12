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
import type { CallSketchSpec } from "@/lib/call-sketch-live.mjs"

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

async function recordTestBuildEvent(input: {
  leadId: number
  operatorId: number
  kind: string
  externalId: string
  body: string
  detail: Record<string, unknown>
}) {
  const sql = getSql()
  const detail = JSON.stringify({ ...input.detail, isTest: true, sensitivity: "owner" })
  const inserted = (await sql`
    INSERT INTO events (
      occurred_at, kind, actor_type, actor_id, lead_id, external_id,
      body, crew_body, detail
    )
    SELECT now(), ${input.kind}::text, 'operator'::text,
      ${String(input.operatorId)}::text, l.id, ${input.externalId}::text,
      ${input.body}::text, NULL::text, ${detail}::jsonb
    FROM leads l
    WHERE l.id = ${input.leadId}::bigint AND l.is_test = true
    ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
    RETURNING id`) as { id: number }[]
  if (inserted[0]) return Number(inserted[0].id)
  const existing = (await sql`
    SELECT e.id FROM events e JOIN leads l ON l.id = e.lead_id
    WHERE e.kind = ${input.kind}::text AND e.external_id = ${input.externalId}::text
      AND l.id = ${input.leadId}::bigint AND l.is_test = true
    LIMIT 1`) as { id: number }[]
  return Number(existing[0]?.id ?? 0)
}

async function insertBuildClaim(input: {
  leadId: number
  sourceEventId: number
  fact: StoredBuildClaimValue
  itemKey: string
}) {
  const sql = getSql()
  const rows = (await sql`
    INSERT INTO claims (
      subject_type, subject_id, predicate, value, confidence,
      source_event_id, extracted_by, item_key
    )
    SELECT 'lead'::text, l.id, 'build_fact'::text, ${JSON.stringify(input.fact)}::jsonb,
      ${input.fact.certainty === "corrected" ? 1 : 0.85}::real,
      ${input.sourceEventId}::bigint, 'build-sheets'::text, ${input.itemKey}::text
    FROM leads l
    WHERE l.id = ${input.leadId}::bigint AND l.is_test = true
    ON CONFLICT (source_event_id, item_key) WHERE item_key <> '' DO NOTHING
    RETURNING id`) as { id: number }[]
  if (rows[0]) return Number(rows[0].id)
  const existing = (await sql`
    SELECT c.id FROM claims c
    JOIN leads l ON l.id = c.subject_id AND c.subject_type = 'lead'
    WHERE c.source_event_id = ${input.sourceEventId}::bigint
      AND c.item_key = ${input.itemKey}::text
      AND l.id = ${input.leadId}::bigint AND l.is_test = true
    LIMIT 1`) as { id: number }[]
  return Number(existing[0]?.id ?? 0)
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
  const inserted: Array<{ id: number; fact: StoredBuildClaimValue }> = []
  for (const fact of facts) {
    const id = await insertBuildClaim({
      leadId,
      sourceEventId: Number(source.source_event_id),
      fact,
      itemKey: hashItem(`call-sketch:${source.call_sid}:${fact.factKey}:${fact.interpretationGroup ?? "direct"}`),
    })
    if (id) inserted.push({ id, fact })
  }
  const groups = new Map<string, number[]>()
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
        ${claimIds}::bigint[], ${source.source_event_id}::bigint, true
      FROM leads l
      WHERE l.id = ${leadId}::bigint AND l.is_test = true
      ON CONFLICT (lead_id, conflict_key) DO NOTHING`
  }
  return inserted.map((item) => item.id)
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
  const eventId = await recordTestBuildEvent({
    leadId: input.leadId,
    operatorId: input.operatorId,
    kind: "build.fact-decided",
    externalId: `build-decision:${input.leadId}:${decisionKey}`,
    body: `${input.kind === "confirm" ? "Confirmed" : input.kind === "working" ? "Working number" : "Rejected"}: ${claim.factKey}`,
    detail: { claimId: input.claimId, state: input.kind },
  })
  if (!eventId) throw new Error("The build decision could not be filed.")
  const sql = getSql()
  for (const [index, decision] of transition.newDecisions.entries()) {
    await sql`
      INSERT INTO build_fact_decisions (
        lead_id, claim_id, state, actor_id, purpose, source_event_id,
        decision_key, is_test, decided_at
      )
      SELECT l.id, c.id, ${decision.state}::text, o.id,
        ${decision.purpose}::text, ${eventId}::bigint,
        ${`${decisionKey}:${index}:${decision.claimId}:${decision.state}`}::text,
        true, ${decision.decidedAt}::timestamptz
      FROM leads l JOIN claims c ON c.subject_type = 'lead' AND c.subject_id = l.id
      JOIN operators o ON o.id = ${input.operatorId}::bigint AND o.role = 'owner' AND o.active = true
      WHERE l.id = ${input.leadId}::bigint AND l.is_test = true
        AND c.id = ${decision.claimId}::bigint AND c.predicate = 'build_fact'
      ON CONFLICT (lead_id, decision_key) DO NOTHING`
  }
  if (input.kind !== "reject") {
    await sql`
      UPDATE claims prior SET superseded_by = selected.id
      FROM claims selected, leads l
      WHERE selected.id = ${input.claimId}::bigint
        AND selected.subject_type = 'lead' AND selected.subject_id = l.id
        AND selected.predicate = 'build_fact'
        AND prior.subject_type = 'lead' AND prior.subject_id = l.id
        AND prior.predicate = 'build_fact' AND prior.superseded_by IS NULL
        AND prior.id <> selected.id
        AND prior.value->>'factKey' = selected.value->>'factKey'
        AND COALESCE(prior.value->>'reference', '') = COALESCE(selected.value->>'reference', '')
        AND l.id = ${input.leadId}::bigint AND l.is_test = true`
  }
  return transition.draft
}

export async function proposeBuildFactChange(input: {
  leadId: number
  sourceClaimId: number
  operatorId: number
  value: number
  actionKey: string
}) {
  if (!Number.isFinite(input.value) || input.value <= 0) throw new Error("Enter a positive shop number.")
  const workspace = await getBuildsWorkspace(input.leadId)
  if (!workspace) throw new Error("Builds only changes an [INTERNAL TEST] job.")
  const source = workspace.claims.find((claim) => Number(claim.id) === Number(input.sourceClaimId))
  if (!source) throw new Error("That source fact is no longer active.")
  if (typeof source.value !== "number") throw new Error("This first correction slice accepts measured numbers only.")
  const actionKey = input.actionKey.trim().slice(0, 120)
  if (!actionKey) throw new Error("The correction receipt is missing.")
  const eventId = await recordTestBuildEvent({
    leadId: input.leadId,
    operatorId: input.operatorId,
    kind: "build.fact-proposed",
    externalId: `build-proposal:${input.leadId}:${actionKey}`,
    body: `Proposed ${source.factKey}: ${input.value} ${source.unit}`.trim(),
    detail: { sourceClaimId: source.id, factKey: source.factKey, value: input.value, unit: source.unit },
  })
  if (!eventId) throw new Error("The corrected number could not be filed.")
  const { interpretationGroup: _discardedGroup, ...copy } = source
  void _discardedGroup
  const claimId = await insertBuildClaim({
    leadId: input.leadId,
    sourceEventId: eventId,
    fact: {
      factKey: copy.factKey,
      subject: copy.subject,
      property: copy.property,
      value: input.value,
      unit: copy.unit,
      reference: copy.reference,
      original: `Owner correction: ${input.value} ${copy.unit}`.trim(),
      speaker: "owner",
      certainty: "corrected",
      critical: copy.critical,
    },
    itemKey: hashItem(`build-proposal:${input.leadId}:${actionKey}`),
  })
  if (!claimId) throw new Error("The corrected number could not be attached to the job.")
  const sql = getSql()
  await sql`
    INSERT INTO build_fact_decisions (
      lead_id, claim_id, state, actor_id, purpose, source_event_id,
      decision_key, is_test, decided_at
    )
    SELECT l.id, c.id, 'proposed'::text, o.id, 'build-sheet'::text,
      ${eventId}::bigint, ${`${actionKey}:proposed`}::text, true, now()
    FROM leads l JOIN claims c ON c.subject_type = 'lead' AND c.subject_id = l.id
    JOIN operators o ON o.id = ${input.operatorId}::bigint AND o.role = 'owner' AND o.active = true
    WHERE l.id = ${input.leadId}::bigint AND l.is_test = true
      AND c.id = ${claimId}::bigint AND c.predicate = 'build_fact'
    ON CONFLICT (lead_id, decision_key) DO NOTHING`
  await sql`
    INSERT INTO build_claim_conflicts (
      lead_id, conflict_key, kind, claim_ids, source_event_id, is_test
    )
    SELECT l.id, ${`proposal:${claimId}`}::text, 'different-values'::text,
      ${[Number(source.id), claimId]}::bigint[], ${eventId}::bigint, true
    FROM leads l
    WHERE l.id = ${input.leadId}::bigint AND l.is_test = true
    ON CONFLICT (lead_id, conflict_key) DO NOTHING`
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
  const eventId = await recordTestBuildEvent({
    leadId: input.leadId,
    operatorId: input.operatorId,
    kind: "build.working-number",
    externalId: `build-working:${input.leadId}:${actionKey}`,
    body: `Working number for ${input.factKey}: ${input.value} ${template.unit}`.trim(),
    detail: { factKey: input.factKey, value: input.value, unit: template.unit },
  })
  if (!eventId) throw new Error("The Working number could not be filed.")
  const claimId = await insertBuildClaim({
    leadId: input.leadId,
    sourceEventId: eventId,
    fact: { ...template, value: input.value, original: `Owner Working number: ${input.value} ${template.unit}`.trim() },
    itemKey: hashItem(`build-working:${input.leadId}:${actionKey}`),
  })
  if (!claimId) throw new Error("The Working number could not be attached to the job.")
  await decideBuildFact({
    leadId: input.leadId,
    claimId,
    operatorId: input.operatorId,
    kind: "working",
    decisionKey: `${actionKey}:accept`,
  })
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
  await sql`
    INSERT INTO build_sheet_sequences (lead_id, next_sequence, is_test)
    SELECT l.id, 1::int, true FROM leads l
    WHERE l.id = ${leadId}::bigint AND l.is_test = true
    ON CONFLICT (lead_id) DO NOTHING`
  const inserted = (await sql`
    WITH lead_scope AS (
      SELECT l.id FROM leads l
      WHERE l.id = ${leadId}::bigint AND l.is_test = true
    ), receipt AS (
      INSERT INTO build_lock_receipts (lead_id, lock_key, is_test)
      SELECT l.id, ${lockKey}::text, true FROM lead_scope l
      ON CONFLICT (lead_id, lock_key) DO NOTHING
      RETURNING lead_id, lock_key
    ), allocated AS (
      UPDATE build_sheet_sequences sequence
      SET next_sequence = sequence.next_sequence + 1
      FROM receipt
      WHERE sequence.lead_id = receipt.lead_id AND sequence.is_test = true
      RETURNING sequence.lead_id, sequence.next_sequence - 1 AS sheet_sequence
    ), sheet AS (
      INSERT INTO build_sheets (lead_id, sequence, snapshot, locked_by, locked_at, is_test)
      SELECT allocated.lead_id, allocated.sheet_sequence,
        jsonb_set(${JSON.stringify(candidate)}::jsonb, '{number}', to_jsonb(allocated.sheet_sequence), false),
        ${input.operatorId}::bigint, ${candidate.lockedAt}::timestamptz, true
      FROM allocated JOIN receipt ON true
      RETURNING id, lead_id, sequence, snapshot, locked_at
    ), linked AS (
      UPDATE build_lock_receipts target SET build_sheet_id = sheet.id
      FROM sheet
      WHERE target.lead_id = sheet.lead_id AND target.lock_key = ${lockKey}::text
        AND target.is_test = true
      RETURNING sheet.id, sheet.sequence, sheet.snapshot, sheet.locked_at
    )
    SELECT id, sequence, snapshot, locked_at FROM linked`) as Array<{
      id: number
      sequence: number
      snapshot: LockedBuildSheet
      locked_at: string
    }>
  const rows = inserted.length ? inserted : (await sql`
    SELECT s.id, s.sequence, s.snapshot, s.locked_at
    FROM build_lock_receipts receipt
    JOIN build_sheets s ON s.id = receipt.build_sheet_id AND s.is_test = true
    JOIN leads l ON l.id = receipt.lead_id
    WHERE receipt.lead_id = ${leadId}::bigint AND receipt.lock_key = ${lockKey}::text
      AND receipt.is_test = true AND l.is_test = true
    LIMIT 1`) as Array<{ id: number; sequence: number; snapshot: LockedBuildSheet; locked_at: string }>
  const sheet = rows[0]
  if (!sheet) throw new Error("The Build Sheet lock is still being filed. Tap once more.")
  await ensurePaperworkForSheet({ leadId, sheetId: Number(sheet.id), snapshot: sheet.snapshot })
  if (inserted.length) await markReleasedPaperwork(leadId, sheet.snapshot)
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
  await ingestCallSketchBuildFacts(leadId)
  const [claimRows, decisionRows, sheetRows, paperworkRows] = await Promise.all([
    sql`
      SELECT c.id, c.source_event_id, c.value
      FROM claims c JOIN leads l ON l.id = c.subject_id AND c.subject_type = 'lead'
      WHERE l.id = ${leadId}::bigint AND l.is_test = true
        AND c.predicate = 'build_fact' AND c.superseded_by IS NULL
      ORDER BY c.created_at, c.id`,
    sql`
      SELECT d.id, d.claim_id, d.state, d.actor_id, d.purpose, d.decided_at
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
  const decisions = (decisionRows as Array<{ id: number; claim_id: number; state: BuildDecision["state"]; actor_id: number; purpose: string; decided_at: string }>).map((row) => ({
    id: Number(row.id), claimId: Number(row.claim_id), state: row.state,
    actorId: Number(row.actor_id), purpose: row.purpose, decidedAt: row.decided_at,
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
