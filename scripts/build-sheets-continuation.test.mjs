import assert from "node:assert/strict"
import test from "node:test"
import {
  buildClarificationForSketch,
  createCustomerBuildProjection,
  createCrewBuildProjection,
  projectBuildDrawing,
} from "../lib/build-sheets-continuation.mjs"

function lockedSheet(overrides = {}) {
  return {
    jobId: 34,
    number: 2,
    idempotencyKey: "fixture-sheet-2",
    lockedAt: "2026-08-12T18:00:00.000Z",
    facts: [
      { id: 1, sourceEventId: 101, factKey: "gate_leaf.finished_width", subject: "gate_leaf", property: "finished_width", value: 47.5, unit: "in", reference: "outside edge to outside edge", original: "Owner correction: 47.5 in", speaker: "owner", certainty: "corrected", critical: true, decisionState: "shop-confirmed" },
      { id: 2, sourceEventId: 101, factKey: "gate_leaf.finished_height", subject: "gate_leaf", property: "finished_height", value: 42, unit: "in", reference: "bottom edge to top edge", original: "42 inches tall", speaker: "customer", certainty: "stated", critical: true, decisionState: "shop-confirmed" },
      { id: 3, sourceEventId: 101, factKey: "frame.stock_size", subject: "frame", property: "stock_size", value: 2, unit: "in", reference: "outside stock size", original: "2 inch tube", speaker: "customer", certainty: "stated", critical: true, decisionState: "shop-confirmed" },
      { id: 4, sourceEventId: 101, factKey: "frame.rail_count", subject: "frame", property: "rail_count", value: 2, unit: "count", reference: "inside frame", original: "two rails", speaker: "customer", certainty: "stated", critical: true, decisionState: "shop-confirmed" },
      { id: 5, sourceEventId: 101, factKey: "gate.hinge_side", subject: "gate", property: "hinge_side", value: "left", unit: "", reference: "viewed from customer side", original: "hinges left", speaker: "customer", certainty: "stated", critical: true, decisionState: "shop-confirmed" },
      { id: 6, sourceEventId: 101, factKey: "gate.latch_side", subject: "gate", property: "latch_side", value: "right", unit: "", reference: "viewed from customer side", original: "latch right", speaker: "customer", certainty: "stated", critical: true, decisionState: "shop-confirmed" },
      { id: 7, sourceEventId: 101, factKey: "frame.material", subject: "frame", property: "material", value: "steel", unit: "", reference: "", original: "steel gate", speaker: "customer", certainty: "stated", critical: false, decisionState: "shop-confirmed" },
    ],
    fabrication: { ready: true, blockers: [] },
    ...overrides,
  }
}

test("locked Build Sheet projects one deterministic drawing without fabrication guesses", () => {
  const drawing = projectBuildDrawing(lockedSheet())

  assert.deepEqual(drawing, {
    sourceBuildSheetNumber: 2,
    width: 47.5,
    height: 42,
    stockSize: 2,
    railCount: 2,
    hingeSide: "left",
    latchSide: "right",
    fabricationReady: true,
  })
  assert.equal("cutList" in drawing, false)
})

test("customer projection is an allowlisted copy tied to the exact sheet they saw", () => {
  const projection = createCustomerBuildProjection({
    sheet: lockedSheet(),
    customerConfirmations: [{ claimId: 2, state: "accepted", respondedAt: "2026-08-12T19:00:00.000Z" }],
  })

  assert.equal(projection.buildSheetNumber, 2)
  assert.match(projection.scope, /steel gate/i)
  assert.deepEqual(projection.drawing, {
    sourceBuildSheetNumber: 2,
    width: 47.5,
    height: 42,
    stockSize: 2,
    railCount: 2,
    hingeSide: "left",
    latchSide: "right",
  })
  assert.equal(projection.facts.find((fact) => fact.claimId === 2)?.state, "customer-confirmed")
  assert.equal(projection.facts.find((fact) => fact.claimId === 1)?.state, "shop-confirmed")
  assert.equal(JSON.stringify(projection).includes("Owner correction"), false)
  for (const restricted of ["sourceEventId", "original", "speaker", "critical", "idempotencyKey", "fabrication"]) {
    assert.equal(JSON.stringify(projection).includes(restricted), false)
  }
})

test("crew projection exposes the current locked work without owner evidence or money", () => {
  const projection = createCrewBuildProjection({ sheet: lockedSheet(), paperwork: [
    { id: 10, label: "Gate drawing", status: "current", issueState: "current", sourceBuildSheetNumber: 2 },
    { id: 11, label: "Old DXF", status: "old-numbers", issueState: "blocked", sourceBuildSheetNumber: 1 },
  ] })

  assert.equal(projection.buildSheetNumber, 2)
  assert.deepEqual(projection.paperwork, [{ id: 10, label: "Gate drawing", sourceBuildSheetNumber: 2 }])
  assert.equal(/price|invoice|payment|sourceEventId|original/i.test(JSON.stringify(projection)), false)
})

test("the live-call bridge uses the reference-aware Build Sheets question", () => {
  const question = buildClarificationForSketch({
    width: { value: 48, evidence: "48 inches wide" },
  })

  assert.deepEqual(question, {
    question: "Ask if 48 inches is the opening or the finished gate.",
    reason: "It changes hinge clearance, material, and fit.",
  })
  assert.equal(buildClarificationForSketch({ width: { value: 48, evidence: "48 inch clear opening" } }), null)
})
