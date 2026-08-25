import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { deriveCallSketch, emptyCallSketchSpec } from "../lib/call-sketch-live.mjs"
import { mergeClaimFacts, sketchValuesFromClaims } from "../lib/call-sketch-claims.mjs"
import { answeredFactCount, factText, hasDrawing } from "../lib/call-sketch-panel.mjs"

const STORE_SOURCE = readFileSync(new URL("../lib/call-sketch-store.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")

// Every predicate below is one the extractor actually filed in production. The
// same measurement has three different names across three calls, which is why
// nothing in the bridge matches a predicate by name.
const REAL_GATE_CALL = [
  { predicate: "gate_frame_rails", value: "3" },
  { predicate: "gate_frame_tubing_width", value: "2 inches" },
  { predicate: "gate_height", value: "48 inches" },
  { predicate: "gate_hinges", value: "left" },
  { predicate: "gate_latch", value: "right" },
  { predicate: "gate_material", value: "steel" },
  { predicate: "gate_swing_direction", value: "inward" },
  { predicate: "gate_width", value: "47.5 inches" },
]

const REAL_GATE_CALL_OTHER_NAMES = [
  { predicate: "gate_height_inches", value: 48 },
  { predicate: "gate_hinge_side", value: "left" },
  { predicate: "gate_latch_side", value: "right" },
  { predicate: "gate_opening_width_inches", value: 40 },
  { predicate: "gate_rail_count", value: 3 },
  { predicate: "gate_tubing_size_inches", value: 2 },
  { predicate: "gate_width_inches", value: 47.5 },
]

test("the extractor's facts are read by what they mean, not what they are called", () => {
  for (const claims of [REAL_GATE_CALL, REAL_GATE_CALL_OTHER_NAMES]) {
    const { values } = sketchValuesFromClaims(claims)
    assert.equal(values.kind, "gate")
    assert.equal(values.width, 47.5, "the finished width, never the opening")
    assert.equal(values.height, 48)
    assert.equal(values.stockSize, 2)
    assert.equal(values.railCount, 3)
    assert.equal(values.hingeSide, "left")
    assert.equal(values.latchSide, "right")
  }
})

test("an opening is only the width when no finished width was ever given", () => {
  const openingOnly = sketchValuesFromClaims([
    { predicate: "gate_opening_width_inches", value: 40 },
    { predicate: "gate_height", value: "48 inches" },
  ])
  assert.equal(openingOnly.values.width, 40, "it is the only width on the call")
  const both = sketchValuesFromClaims([
    { predicate: "gate_opening_width_inches", value: 40 },
    { predicate: "gate_width_inches", value: 47.5 },
  ])
  assert.equal(both.values.width, 47.5, "the gate, not the hole it hangs in")
})

// This is the call the bridge exists for: a real conversation the regex engine
// took nothing at all from, that the extractor understood completely.
test("a call the regexes heard nothing on still draws", () => {
  const deaf = emptyCallSketchSpec()
  assert.equal(hasDrawing(deaf), false)
  const merged = mergeClaimFacts(deaf, REAL_GATE_CALL)
  assert.equal(hasDrawing(merged), true)
  assert.equal(merged.width.value, 47.5)
  assert.equal(merged.railCount.value, 3)
  assert.equal(merged.hingeSide.value, "left")
})

test("nothing the extractor says is ever an answer", () => {
  const merged = mergeClaimFacts(emptyCallSketchSpec(), REAL_GATE_CALL)
  for (const key of ["kind", "width", "height", "stockSize", "railCount", "hingeSide", "latchSide"]) {
    assert.equal(merged[key].truth, "uncertain", `${key} must never be promoted to stated`)
  }
  // Which is the product rule, restated where it is enforced: export stays
  // locked until the owner confirms the numbers himself.
  assert.equal(merged.readyForReview, false)
  assert.equal(answeredFactCount(merged), 0)
  assert.equal(factText("width", merged.width), "≈ 47 1/2\"", "and it reads as the approximation it is")
})

test("the call's own word outranks the extractor's reading of it", () => {
  const stated = deriveCallSketch([
    { sequenceId: 1, track: "inbound_track", transcript: "A gate, 52 inches wide by 40 inches." },
  ])
  assert.equal(stated.width.truth, "stated")
  const merged = mergeClaimFacts(stated, REAL_GATE_CALL)
  assert.equal(merged.width.value, 52, "the customer said 52; the model's 47.5 does not overwrite it")
  assert.equal(merged.width.truth, "stated")
  // The slots the call left empty are still filled.
  assert.equal(merged.railCount.value, 3)
  assert.equal(merged.hingeSide.value, "left")
})

// A caller describing stainless tanks produced a real width belonging to no
// gate. Numbers follow the thing they measure.
test("a measurement from a call about something else is not this drawing's", () => {
  const tanks = [
    { predicate: "customer_mentioned_product_width_narrow", value: "34.75 inches" },
    { predicate: "customer_mentioned_product_width_wide", value: "50 inches" },
    { predicate: "material", value: "stainless" },
  ]
  const merged = mergeClaimFacts(emptyCallSketchSpec(), tanks)
  assert.equal(merged.width.value, null, "no gate or frame was described on that call")
  assert.equal(hasDrawing(merged), false)

  // The same numbers on a call that did describe a gate are wanted.
  const gateNamed = deriveCallSketch([{ sequenceId: 1, track: "inbound_track", transcript: "I need a gate." }])
  assert.equal(mergeClaimFacts(gateNamed, tanks).width.value, 34.75)
})

test("both readers of a call share one query, and the crew projection runs first", () => {
  const reader = STORE_SOURCE.slice(STORE_SOURCE.indexOf("async function claimsOnCall"))
  assert.match(reader, /projectClaimForRole\(row, role\)/)
  // One read, two uses. Two queries is how the drawing and the slot list drift.
  assert.equal((STORE_SOURCE.match(/FROM claims c/g) ?? []).length, 1)
  assert.match(STORE_SOURCE, /heard: heardFromClaims\(claims\)/)
  assert.match(STORE_SOURCE, /spec: mergeClaimFacts\(/)
  // The owner-only intake sketch gets the same merge.
  assert.match(STORE_SOURCE, /const observedSpec = mergeClaimFacts\(sketch\.observed_spec, claims\)/)
})
