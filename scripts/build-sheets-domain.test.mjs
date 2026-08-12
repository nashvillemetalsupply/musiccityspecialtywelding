import assert from "node:assert/strict"
import test from "node:test"
import { applyBuildDecision, classifyPaperwork, deriveBuildDraft, lockBuildSheet } from "../lib/build-sheets-domain.mjs"

function measurementClaim(overrides = {}) {
  return {
    id: 1,
    sourceEventId: 101,
    factKey: "opening.clear_width",
    subject: "opening",
    property: "clear_width",
    value: 48,
    unit: "in",
    reference: "between posts",
    original: "48 inches",
    speaker: "customer",
    certainty: "interpreted",
    critical: true,
    interpretationGroup: "call-101-width",
    ...overrides,
  }
}

test("reference-free width stays visible as two competing interpretations", () => {
  const draft = deriveBuildDraft({
    claims: [
      measurementClaim(),
      measurementClaim({
        id: 2,
        factKey: "gate_leaf.finished_width",
        subject: "gate_leaf",
        property: "finished_width",
        reference: "outside edge to outside edge",
      }),
    ],
    decisions: [],
  })

  assert.equal(draft.conflicts.length, 1)
  assert.equal(draft.conflicts[0].kind, "unresolved-reference")
  assert.deepEqual(draft.conflicts[0].claimIds, [1, 2])
  assert.match(draft.recommendedQuestion.question, /opening or the finished gate/i)
  assert.match(draft.recommendedQuestion.reason, /hinge clearance, material, and fit/i)
})

test("different active values for the same referenced fact stay in conflict", () => {
  const draft = deriveBuildDraft({
    claims: [
      measurementClaim({ interpretationGroup: undefined, certainty: "stated" }),
      measurementClaim({ id: 2, value: 47.5, original: "47 1/2 inches", interpretationGroup: undefined, certainty: "stated" }),
    ],
    decisions: [],
  })

  assert.equal(draft.conflicts.length, 1)
  assert.equal(draft.conflicts[0].kind, "different-values")
  assert.deepEqual(draft.conflicts[0].claimIds, [1, 2])
})

test("confirming one interpretation explicitly rejects its competing reading", () => {
  const claims = [
    measurementClaim(),
    measurementClaim({
      id: 2,
      factKey: "gate_leaf.finished_width",
      subject: "gate_leaf",
      property: "finished_width",
      reference: "outside edge to outside edge",
    }),
  ]
  const result = applyBuildDecision(
    { claims, decisions: [] },
    { kind: "confirm", claimId: 1, actorId: 7, purpose: "build-sheet", decidedAt: "2026-08-12T16:00:00.000Z" },
  )

  assert.deepEqual(result.newDecisions.map(({ claimId, state }) => ({ claimId, state })), [
    { claimId: 1, state: "shop-confirmed" },
    { claimId: 2, state: "rejected" },
  ])
  assert.equal(result.draft.conflicts.length, 0)
})

test("a Build Sheet cannot lock while a conflict is unresolved", () => {
  const claims = [
    measurementClaim(),
    measurementClaim({
      id: 2,
      factKey: "gate_leaf.finished_width",
      subject: "gate_leaf",
      property: "finished_width",
      reference: "outside edge to outside edge",
    }),
  ]

  assert.throws(() => lockBuildSheet({
    jobId: 42,
    sequence: 1,
    idempotencyKey: "lock-fixture-1",
    lockedAt: "2026-08-12T16:05:00.000Z",
    claims,
    decisions: [],
  }), /doesn't match/i)
})

test("a locked Build Sheet is immutable and blocks fabrication over a critical Working number", () => {
  const claims = [
    measurementClaim({ id: 10, interpretationGroup: undefined, certainty: "corrected", factKey: "gate_leaf.finished_width", subject: "gate_leaf", property: "finished_width" }),
    measurementClaim({ id: 11, interpretationGroup: undefined, certainty: "corrected", factKey: "gate_leaf.finished_height", subject: "gate_leaf", property: "finished_height", value: 42, original: "42 inches" }),
  ]
  const sheet = lockBuildSheet({
    jobId: 42,
    sequence: 1,
    idempotencyKey: "lock-fixture-1",
    lockedAt: "2026-08-12T16:05:00.000Z",
    claims,
    decisions: [
      { id: 1, claimId: 10, state: "shop-confirmed", decidedAt: "2026-08-12T16:03:00.000Z" },
      { id: 2, claimId: 11, state: "working-number", decidedAt: "2026-08-12T16:04:00.000Z" },
    ],
  })

  assert.equal(Object.isFrozen(sheet), true)
  assert.equal(Object.isFrozen(sheet.facts), true)
  assert.equal(sheet.fabrication.ready, false)
  assert.match(sheet.fabrication.blockers.join(" "), /Finished height is a Working number\./)
  assert.throws(() => { sheet.facts[0].value = 99 }, TypeError)
})

test("a proposed dependent change puts Paperwork on Hold and rejection clears it", () => {
  const sourceClaim = measurementClaim({ id: 20, interpretationGroup: undefined, certainty: "corrected", factKey: "gate_leaf.finished_width", subject: "gate_leaf", property: "finished_width" })
  const proposedClaim = { ...sourceClaim, id: 21, value: 47.5, original: "47 1/2 inches" }
  const sourceSheet = {
    number: 1,
    facts: [{ ...sourceClaim, decisionState: "shop-confirmed" }],
  }
  const manifests = [
    { id: 1, kind: "drawing", sourceBuildSheetNumber: 1, dependencies: ["gate_leaf.finished_width"] },
    { id: 2, kind: "finish-note", sourceBuildSheetNumber: 1, dependencies: ["gate.finish"] },
  ]
  const proposedDraft = deriveBuildDraft({
    claims: [sourceClaim, proposedClaim],
    decisions: [{ id: 1, claimId: 20, state: "shop-confirmed", decidedAt: "2026-08-12T16:00:00.000Z" }],
  })

  const held = classifyPaperwork({ manifests, sourceSheet, draft: proposedDraft })
  assert.equal(held[0].status, "hold")
  assert.equal(held[0].reason, "Finished width change needs review.")
  assert.equal(held[1].status, "current")

  const rejectedDraft = deriveBuildDraft({
    claims: [sourceClaim, proposedClaim],
    decisions: [
      { id: 1, claimId: 20, state: "shop-confirmed", decidedAt: "2026-08-12T16:00:00.000Z" },
      { id: 2, claimId: 21, state: "rejected", decidedAt: "2026-08-12T16:02:00.000Z" },
    ],
  })
  const cleared = classifyPaperwork({ manifests, sourceSheet, draft: rejectedDraft })
  assert.equal(cleared[0].status, "current")
  assert.equal(cleared[1].status, "current")
})

test("releasing a changed Build Sheet marks all and only dependent Paperwork Old numbers", () => {
  const width1 = measurementClaim({ id: 30, interpretationGroup: undefined, factKey: "gate_leaf.finished_width", subject: "gate_leaf", property: "finished_width" })
  const width2 = { ...width1, id: 31, value: 47.5, original: "47 1/2 inches" }
  const finish = { ...measurementClaim({ id: 32, interpretationGroup: undefined }), factKey: "gate.finish", subject: "gate", property: "finish", value: "black powder coat", unit: "", reference: "", original: "black powder coat", critical: false }
  const sourceSheet = { number: 1, facts: [{ ...width1, decisionState: "shop-confirmed" }, { ...finish, decisionState: "shop-confirmed" }] }
  const releasedSheet = { number: 2, facts: [{ ...width2, decisionState: "shop-confirmed" }, { ...finish, decisionState: "shop-confirmed" }] }
  const manifests = [
    { id: 1, kind: "drawing", sourceBuildSheetNumber: 1, dependencies: ["gate_leaf.finished_width"] },
    { id: 2, kind: "dxf", sourceBuildSheetNumber: 1, dependencies: ["gate_leaf.finished_width"] },
    { id: 3, kind: "finish-note", sourceBuildSheetNumber: 1, dependencies: ["gate.finish"] },
  ]

  const paperwork = classifyPaperwork({ manifests, sourceSheet, releasedSheet })
  assert.deepEqual(paperwork.map(({ status }) => status), ["old-numbers", "old-numbers", "current"])
  assert.equal(paperwork[0].validForSource, true)
  assert.equal(paperwork[0].reason, "Finished width changed.")
})

test("normalized units compare without invented tolerance and different subjects remain compatible", () => {
  const draft = deriveBuildDraft({
    claims: [
      measurementClaim({ id: 40, interpretationGroup: undefined, value: 4, unit: "ft", original: "four feet" }),
      measurementClaim({ id: 41, interpretationGroup: undefined, value: 48, unit: "in", original: "48 inches" }),
      measurementClaim({ id: 42, interpretationGroup: undefined, factKey: "gate_leaf.finished_width", subject: "gate_leaf", property: "finished_width", value: 47.5, original: "47 1/2 inches" }),
    ],
    decisions: [],
  })

  assert.equal(draft.conflicts.length, 0)
})

test("missing facts stay visible and a Working number never looks fabrication-ready", () => {
  const height = measurementClaim({ id: 50, interpretationGroup: undefined, factKey: "gate_leaf.finished_height", subject: "gate_leaf", property: "finished_height", value: 42, original: "42 inches" })
  const draft = deriveBuildDraft({
    claims: [height],
    decisions: [{ id: 1, claimId: 50, state: "working-number", decidedAt: "2026-08-12T16:00:00.000Z" }],
  })

  assert.equal(draft.factRows.find((fact) => fact.factKey === "gate_leaf.finished_height").state, "working-number")
  assert.equal(draft.factRows.find((fact) => fact.factKey === "gate_leaf.finished_width").state, "still-need")
  assert.equal(draft.fabrication.ready, false)
  assert.match(draft.fabrication.blockers.join(" "), /finished width.*still need/i)
  assert.match(draft.fabrication.blockers.join(" "), /finished height.*working number/i)
})
