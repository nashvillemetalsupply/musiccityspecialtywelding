import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const INTAKE = read("../lib/job-intake.ts")
const CALLS = read("../app/board/recent-calls.tsx")
const CALLS_TAB = read("../app/board/calls/page.tsx")

// S21 call chips (Fable 10-22): the chip reads writer-side state the board
// already loads. No SSE, no timer, no new poll.
test("pending-call reads carry the live-transcript sketch status", () => {
  const joins = INTAKE.match(/LEFT JOIN call_sketches s ON s\.call_sid = d\.call_sid/g) ?? []
  assert.equal(joins.length, 2)
  assert.match(INTAKE, /COALESCE\(s\.status, ''\) AS sketch_status/)
})

test("being-read chip only shows while the call is still ringing", () => {
  assert.match(CALLS, /ringing && call\.sketchStatus === "listening"/)
  assert.match(CALLS_TAB, /ringing \? \(draft\.sketch_status === "listening"/)
})

test("chips add no timer, stream or poll of their own", () => {
  for (const source of [CALLS, CALLS_TAB]) assert.doesNotMatch(source, /setInterval|setTimeout|EventSource|startOpsPulsePolling/)
})
