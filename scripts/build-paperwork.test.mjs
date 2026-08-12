import assert from "node:assert/strict"
import test from "node:test"
import { compileBuildPaperwork, paperworkIssueDecision } from "../lib/build-paperwork.mjs"

const sheet = {
  jobId: 34,
  number: 2,
  idempotencyKey: "fixture-sheet-2",
  lockedAt: "2026-08-12T18:00:00.000Z",
  facts: [
    { id: 1, factKey: "gate_leaf.finished_width", value: 47.5, unit: "in", decisionState: "shop-confirmed" },
    { id: 2, factKey: "gate_leaf.finished_height", value: 42, unit: "in", decisionState: "shop-confirmed" },
    { id: 3, factKey: "frame.stock_size", value: 2, unit: "in", decisionState: "shop-confirmed" },
    { id: 4, factKey: "frame.rail_count", value: 2, unit: "count", decisionState: "shop-confirmed" },
    { id: 5, factKey: "gate.hinge_side", value: "left", unit: "", decisionState: "shop-confirmed" },
    { id: 6, factKey: "gate.latch_side", value: "right", unit: "", decisionState: "shop-confirmed" },
  ],
  fabrication: { ready: true, blockers: [] },
}

test("paperwork compiles deterministically from one locked Build Sheet", () => {
  const drawing = compileBuildPaperwork({ kind: "drawing", sheet })
  const dxf = compileBuildPaperwork({ kind: "dxf", sheet })

  assert.equal(drawing.sourceBuildSheetNumber, 2)
  assert.equal(dxf.sourceBuildSheetNumber, 2)
  assert.match(drawing.content, /Build Sheet 2/)
  assert.match(drawing.content, /47\.5/)
  assert.match(drawing.content, /font:14px sans-serif/)
  assert.match(dxf.content, /BUILD SHEET 2/)
  assert.equal(drawing.contentHash, compileBuildPaperwork({ kind: "drawing", sheet }).contentHash)
  assert.equal(/cut list/i.test(`${drawing.content}\n${dxf.content}`), false)
})

test("paperwork rejects unsafe locked geometry before emitting SVG or DXF", () => {
  const withFact = (factKey, value) => ({
    ...sheet,
    facts: sheet.facts.map((fact) => fact.factKey === factKey ? { ...fact, value } : fact),
  })

  assert.throws(() => compileBuildPaperwork({ kind: "drawing", sheet: withFact("gate.hinge_side", "left</desc><script>alert(1)</script>") }), /left or right/i)
  assert.throws(() => compileBuildPaperwork({ kind: "drawing", sheet: withFact("frame.rail_count", 100_000) }), /integer between 0 and 8/i)
  assert.throws(() => compileBuildPaperwork({ kind: "drawing", sheet: withFact("frame.stock_size", -2) }), /positive number/i)
})

test("only current paperwork for the current locked sheet may issue", () => {
  assert.deepEqual(paperworkIssueDecision({ kind: "drawing", status: "current", issueState: "current", sourceBuildSheetNumber: 2, currentBuildSheetNumber: 2, fabricationReady: true }), { allowed: true, reason: "" })
  for (const input of [
    { kind: "drawing", status: "hold", issueState: "current", sourceBuildSheetNumber: 2, currentBuildSheetNumber: 2, fabricationReady: true },
    { kind: "drawing", status: "old-numbers", issueState: "blocked", sourceBuildSheetNumber: 1, currentBuildSheetNumber: 2, fabricationReady: true },
    { kind: "dxf", status: "current", issueState: "blocked", sourceBuildSheetNumber: 2, currentBuildSheetNumber: 2, fabricationReady: false },
  ]) assert.equal(paperworkIssueDecision(input).allowed, false)
})
