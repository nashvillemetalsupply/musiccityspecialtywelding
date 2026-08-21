import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { deriveCallSketch, emptyCallSketchSpec } from "../lib/call-sketch-live.mjs"
import {
  PANEL_FACT_KEYS, answeredFactCount, dimensionMark, factText, factTone,
  pricingSentence, sketchAriaLabel,
} from "../lib/call-sketch-panel.mjs"

const PREVIEW_SOURCE = readFileSync(new URL("../app/board/board.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const PAGE_SOURCE = readFileSync(new URL("../app/board/page.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
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
  // The panel renders the engine's string. The only prose beside it is the
  // fallback that explains a blank drawing, which is not a question at all.
  assert.match(PREVIEW_SOURCE, /: spec\.nextQuestion\}/)
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
  assert.match(PAGE_SOURCE, /callSketch: null/, "signed out, the panel has no sketch rather than a fake one")
})

test("the board's sketch is a real call, and never a test one", () => {
  assert.match(PAGE_SOURCE, /getLatestBoardCallSketch\(role\)/, "the reader is told the role so crew never reads an owner-only claim")
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

// The first real call into the board was a pipe weld, not a gate. Every one of
// the seven facts stayed unstated, so the panel printed seven "Not stated" rows
// beside a drawing of a gate nobody had mentioned — after a call the extractor
// had in fact understood in full. These pin the two repairs.
test("a call that answered no gate fact falls back to what the call said", () => {
  assert.match(PREVIEW_SOURCE, /const showHeard = answered === 0 && heard\.length > 0/)
  assert.match(PREVIEW_SOURCE, /showHeard \? "What the call said" : "Ask next"/)
  // One loop draws both. A second hand-written slot list is how the two drift.
  assert.equal((PREVIEW_SOURCE.match(/className="slots"/g) ?? []).length, 1)
  assert.match(PREVIEW_SOURCE, /slots\.map\(\(slot\) =>/)
})

test("the heard facts are this call's own, role-projected, and never a test call's", () => {
  const reader = STORE_SOURCE.slice(STORE_SOURCE.indexOf("async function heardOnCall"))
  assert.match(reader, /e\.detail->>'callSid' = \$\{callSid\}::text/, "claims are scoped to this call, not the person's whole history")
  assert.match(reader, /c\.superseded_by IS NULL/)
  assert.match(reader, /lower\(COALESCE\(e\.detail->>'isTest', 'false'\)\) <> 'true'/)
  assert.match(reader, /projectClaimForRole\(row, role\)/, "crew money is removed server-side, not in CSS")
})

test("the board shows the person's name over a ring-time placeholder", () => {
  const reader = STORE_SOURCE.slice(STORE_SOURCE.indexOf("export async function getLatestBoardCallSketch"))
  assert.match(
    reader,
    /COALESCE\(NULLIF\(p\.display_name, ''\), NULLIF\(d\.caller_name, ''\), ''\) AS caller_name/,
    "d.caller_name is frozen at ring time as `Caller 7021`; the person's name is the one the call gave up",
  )
})

// After hangup the last three lines are always the goodbye. "Bye bye" is what
// the panel showed of a call that had named the customer, the two ductile iron
// flanges, the pipe size and the lengths -- all of it in the first half.
test("an ended call reads from the top, a live one from the tail", () => {
  const reader = STORE_SOURCE.slice(STORE_SOURCE.indexOf("export async function getLatestBoardCallSketch"))
  assert.match(reader, /const live = call\.status === "listening"/)
  assert.match(reader, /live \? utterances\.slice\(-LIVE_LINES\) : utterances\.slice\(0, ENDED_LINES\)/)
  assert.match(STORE_SOURCE, /const LIVE_LINES = 3/)
  assert.match(STORE_SOURCE, /const ENDED_LINES = 14/)
  // The count is what makes the truncation honest rather than silent.
  assert.match(reader, /totalLines: utterances\.length/)
  assert.match(PREVIEW_SOURCE, /\{unshownLines\} more line\{unshownLines === 1 \? "" : "s"\} on this call\./)
  assert.match(PREVIEW_SOURCE, /onTheLine \? "Recent call language" : "How the call opened"/)
})

test("a call with no job yet offers the draft, and only while intake will open it", () => {
  const reader = STORE_SOURCE.slice(STORE_SOURCE.indexOf("export async function getLatestBoardCallSketch"))
  assert.match(
    reader,
    /WHEN d\.status = ANY\(ARRAY\['pending','saving','failed','unknown'\]::text\[\]\) THEN d\.public_id/,
    "the same status guard getCallSketchForDraft uses, so the button cannot land on a 404",
  )
  const guard = STORE_SOURCE.slice(STORE_SOURCE.indexOf("export async function getCallSketchForDraft"))
  assert.match(guard, /d\.status = ANY\(ARRAY\['pending','saving','failed','unknown'\]::text\[\]\)/)
  assert.match(PREVIEW_SOURCE, /sketch\?\.leadId == null && sketch\?\.draftId &&/)
  assert.match(PREVIEW_SOURCE, /href=\{`\/ops\/intake\/\$\{sketch\.draftId\}`\}>Save this call as a job<\/Link>/)
})
