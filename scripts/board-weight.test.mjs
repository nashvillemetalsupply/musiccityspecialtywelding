import test from "node:test"
import assert from "node:assert/strict"
import {
  BOARD_WEIGHTS, signalWeight, scoreBoardJob, isBoardJobHot,
} from "../lib/shop-brain-invariants.mjs"

test("a signal one hour late counts just over its base", () => {
  const w = signalWeight("waiting", 1)
  assert.ok(w > 50 && w < 53, `expected just over 50, got ${w}`)
})

test("lateness caps at three times base", () => {
  assert.equal(signalWeight("promise", 40 * 24), 45 * 3)
  assert.equal(signalWeight("promise", 400 * 24), 45 * 3)
})

test("a signal that is not yet due counts its base once, never less", () => {
  assert.equal(signalWeight("followup", 0), 20)
  assert.equal(signalWeight("followup", -50), 20)
})

test("an unknown signal kind scores nothing rather than throwing", () => {
  assert.equal(signalWeight("wat", 10), 0)
})

test("value and repeat both cap", () => {
  assert.equal(scoreBoardJob({ valueCents: 200000000, priorJobs: 0 }), 30)
  assert.equal(scoreBoardJob({ valueCents: 0, priorJobs: 40 }), 30)
})

test("a job with nothing outstanding scores zero and is not hot", () => {
  const score = scoreBoardJob({ signals: [], valueCents: 0, priorJobs: 0 })
  assert.equal(score, 0)
  assert.equal(isBoardJobHot(score), false)
})

test("the Real Floors case outranks the quiet handrail", () => {
  const realFloors = scoreBoardJob({
    signals: [
      { kind: "promise", hoursLate: 72 },
      { kind: "waiting", hoursLate: 6 },
    ],
    valueCents: 448500,
    priorJobs: 7,
  })
  const handrail = scoreBoardJob({
    signals: [{ kind: "followup", hoursLate: 48 }],
    valueCents: 64000,
    priorJobs: 1,
  })
  assert.ok(realFloors > handrail, `${realFloors} should beat ${handrail}`)
  assert.equal(isBoardJobHot(realFloors), true)
  assert.equal(isBoardJobHot(handrail), false)
})

test("weights are frozen so nothing can drift them at runtime", () => {
  assert.throws(() => { BOARD_WEIGHTS.hotThreshold = 1 }, TypeError)
})
