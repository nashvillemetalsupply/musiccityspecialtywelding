import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { deriveCallSketch, emptyCallSketchSpec } from "../lib/call-sketch-live.mjs"
import {
  PANEL_FACT_KEYS, answeredFactCount, dimensionMark, factText, factTone,
  pricingSentence, sketchAriaLabel,
} from "../lib/call-sketch-panel.mjs"

const PREVIEW_SOURCE = readFileSync(new URL("../app/design-preview/job-control/job-control-preview.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const PAGE_SOURCE = readFileSync(new URL("../app/design-preview/job-control/page.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const STORE_SOURCE = readFileSync(new URL("../lib/call-sketch-store.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")

// The call the mockup was drawn from: a gate is named, a width is heard as an
// opening measurement, nothing else is stated.
function openingWidthCall() {
  return deriveCallSketch([
    { sequenceId: 1, track: "inbound_track", transcript: "I need a gate for the driveway." },
    { sequenceId: 2, track: "inbound_track", transcript: "The opening is about 144 inches." },
  ])
}

test("the panel counts seven facts, and swing and material are not among them", () => {
  assert.deepEqual([...PANEL_FACT_KEYS], ["kind", "width", "height", "stockSize", "railCount", "hingeSide", "latchSide"])
  assert.equal(PANEL_FACT_KEYS.length, 7)
  assert.ok(!PANEL_FACT_KEYS.includes("swing"))
  assert.ok(!PANEL_FACT_KEYS.includes("material"))
})

test("an uncertain width is an ambiguity flag, not an eighth answered fact", () => {
  const spec = openingWidthCall()
  assert.equal(spec.kind.value, "gate")
  assert.equal(spec.width.truth, "uncertain", "an opening measurement is not the finished width")
  assert.notEqual(spec.width.value, null, "the number was still heard")
  assert.equal(answeredFactCount(spec), 1, "kind is answered; the flagged width is not")
  assert.equal(factTone(spec.width), "ambig")
  assert.equal(factText("width", spec.width), "Opening or finished?")
  assert.equal(dimensionMark(spec.width), "?", "an unanswered width stays a question mark on the drawing")
})

test("a stated fact is answered, an unstated one is not", () => {
  const spec = deriveCallSketch([
    { sequenceId: 1, track: "inbound_track", transcript: "A gate, 48 inches wide by 72 inches." },
    { sequenceId: 2, track: "inbound_track", transcript: "Two inch square tube, two rails." },
  ])
  assert.equal(factTone(spec.kind), "said")
  assert.equal(factText("width", spec.width), "48\"")
  assert.equal(factText("height", spec.height), "72\"")
  assert.equal(factText("stockSize", spec.stockSize), "2\"")
  assert.equal(factText("railCount", spec.railCount), "2")
  assert.equal(factTone(spec.hingeSide), "none")
  assert.equal(factText("hingeSide", spec.hingeSide), "Not stated")
  assert.equal(answeredFactCount(spec), 5)
  assert.equal(dimensionMark(spec.width), "48\"")
})

test("the empty spec answers nothing and asks the first question", () => {
  const spec = emptyCallSketchSpec()
  assert.equal(answeredFactCount(spec), 0)
  assert.equal(spec.nextQuestion, "What are we sketching—a gate or a simple rectangular frame?")
  for (const key of PANEL_FACT_KEYS) assert.equal(factTone(spec[key]), "none")
})

test("the pricing sentence names what is missing, and disappears when nothing is", () => {
  assert.equal(pricingSentence(emptyCallSketchSpec()), "it needs kind, width, height and stock before it can be priced")
  assert.equal(pricingSentence(openingWidthCall()), "it needs width, height and stock before it can be priced")
  const priced = deriveCallSketch([
    { sequenceId: 1, track: "inbound_track", transcript: "A gate, 48 inches wide by 72 inches." },
    { sequenceId: 2, track: "inbound_track", transcript: "Two inch square tube." },
  ])
  assert.equal(pricingSentence(priced), "")
})

test("the drawing's label names the facts it is still missing", () => {
  const label = sketchAriaLabel(openingWidthCall())
  assert.match(label, /^Rough call sketch of a gate\./)
  assert.match(label, /width, height, stock size, rails, hinge side and latch side are still unstated/)
})

test("the ask-next question is the engine's own, never the panel's", () => {
  assert.match(PREVIEW_SOURCE, /\{spec\.nextQuestion\}/)
  // questionFor() emits these; a paraphrase typed into the panel would drift.
  assert.doesNotMatch(PREVIEW_SOURCE, /How wide does it need to finish, post to post\?/)
})

test("no fixture survives on the wired panel", () => {
  for (const fixture of [
    "Ray Colter &middot; phone call", "1 more call not sketched",
    "1 of 7 answered", "Redrawn four times",
    "The picture never arrived", "Yeah. I got a picture",
  ]) {
    assert.ok(!PREVIEW_SOURCE.includes(fixture), `${fixture} is still hand-typed on the panel`)
  }
  assert.match(PREVIEW_SOURCE, /callSketch: null/, "signed out, the panel has no sketch rather than a fake one")
})

test("the board's sketch is a real call, and never a test one", () => {
  assert.match(PAGE_SOURCE, /getLatestBoardCallSketch\(\)/)
  const reader = STORE_SOURCE.slice(STORE_SOURCE.indexOf("export async function getLatestBoardCallSketch"))
  assert.match(reader, /lower\(COALESCE\(c\.detail->>'isTest', 'false'\)\) <> 'true'/)
  assert.match(reader, /COALESCE\(l\.is_test, false\) = false/)
  assert.match(reader, /COALESCE\(p\.is_test, false\) = false/)
  assert.match(reader, /COALESCE\(d\.is_test, false\) = false/)
  // Both test filters run twice: once for the sketch, once for the day's
  // unsketched calls beside it.
  assert.equal((reader.match(/COALESCE\(l\.is_test, false\) = false/g) ?? []).length, 2)
  assert.match(reader, /COALESCE\(s\.confirmed_spec, s\.observed_spec\)/, "an owner-confirmed sketch outranks the observed one")
})
