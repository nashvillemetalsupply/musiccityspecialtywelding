import assert from "node:assert/strict"
import test from "node:test"
import { confirmedCallSketch, deriveCallSketch } from "../lib/call-sketch-live.mjs"

test("live call sketch preserves uncertainty until the finished gate width is stated", () => {
  const spec = deriveCallSketch([
    { sequenceId: 1, track: "inbound_track", transcript: "I need a small gate, about four feet wide." },
    { sequenceId: 2, track: "inbound_track", transcript: "Make it forty-two inches tall using two-inch square tubing." },
    { sequenceId: 3, track: "inbound_track", transcript: "Put two rails across it and hinge it on the left." },
  ])
  assert.equal(spec.kind.value, "gate")
  assert.equal(spec.width.value, 48)
  assert.equal(spec.width.truth, "uncertain")
  assert.equal(spec.height.value, 42)
  assert.equal(spec.stockSize.value, 2)
  assert.equal(spec.railCount.value, 2)
  assert.equal(spec.hingeSide.value, "left")
  assert.match(spec.nextQuestion, /opening width/i)
})

test("explicit actual gate dimension overrides an opening dimension", () => {
  const spec = deriveCallSketch([
    { sequenceId: 1, track: "inbound_track", transcript: "The opening is forty-eight inches." },
    { sequenceId: 2, track: "inbound_track", transcript: "Make the actual gate forty-seven and a half inches." },
    { sequenceId: 3, track: "inbound_track", transcript: "Latch on the right. It swings toward the driveway." },
  ])
  assert.equal(spec.width.value, 47.5)
  assert.equal(spec.width.truth, "stated")
  assert.equal(spec.latchSide.value, "right")
  assert.equal(spec.swing.value, "toward the driveway")
  assert.match(spec.width.evidence, /actual gate/i)
})

test("numeric gate dimensions and hardware are extracted conservatively", () => {
  const spec = deriveCallSketch([
    { sequenceId: 10, transcript: "The steel gate is 52 inches wide by 40 inches high." },
    { sequenceId: 11, transcript: "Use 1.5 inch square tube, three rails, right hinges, and the latch on the left." },
  ])
  assert.equal(spec.width.value, 52)
  assert.equal(spec.height.value, 40)
  assert.equal(spec.stockSize.value, 1.5)
  assert.equal(spec.railCount.value, 3)
  assert.equal(spec.hingeSide.value, "right")
  assert.equal(spec.latchSide.value, "left")
  assert.equal(spec.material.value, "steel")
})

test("only an explicit owner confirmation produces confirmed facts", () => {
  const observed = deriveCallSketch([{ transcript: "Gate is 48 inches wide and 42 inches tall." }])
  assert.notEqual(observed.width.truth, "confirmed")
  const confirmed = confirmedCallSketch({ width: 47.5, height: 42, stockSize: 2, railCount: 2 })
  assert.equal(confirmed.width.truth, "confirmed")
  assert.equal(confirmed.height.value, 42)
})

test("shop clarification questions never become stated dimensions", () => {
  const spec = deriveCallSketch([
    { sequenceId: 1, track: "outbound_track", transcript: "Is the gate itself forty-eight inches wide?" },
    { sequenceId: 2, track: "outbound_track", transcript: "Should the hinges be on the left?" },
  ])
  assert.equal(spec.width.value, 48)
  assert.equal(spec.width.truth, "uncertain")
  assert.equal(spec.hingeSide.value, "left")
  assert.equal(spec.hingeSide.truth, "uncertain")
  assert.equal(spec.readyForReview, false)
})

test("confirmation rejects impossible stock geometry", () => {
  assert.throws(() => confirmedCallSketch({ width: 4, height: 4, stockSize: 3 }), /positive opening/i)
  assert.throws(() => confirmedCallSketch({ width: 48, height: 42, stockSize: 2, railCount: 2.5 }), /whole number/i)
})

test("confirmed frames do not invent gate hardware", () => {
  const spec = confirmedCallSketch({ kind: "frame", width: 36, height: 24, stockSize: 1.5, railCount: 0 })
  assert.equal(spec.kind.value, "frame")
  assert.equal(spec.hingeSide.value, null)
  assert.equal(spec.latchSide.value, null)
})
