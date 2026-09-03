import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const USAGE = read("../app/board/usage.ts")
const BOARD = read("../app/board/board.tsx")
const CALLS = read("../app/board/recent-calls.tsx")

// The repo rule: no worker surveillance. Usage counts exist so the next board
// change is built on what the owner taps; they must never count a crew tap.
test("usage counting is owner-only at the source, not in a dashboard filter", () => {
  assert.match(BOARD, /\{chrome\.owner && <Analytics \/>\}/, "the script only loads for the owner")
  assert.match(BOARD, /useEffect\(\(\) => \{ enableUsage\(chrome\.owner\) \}, \[chrome\.owner\]\)/)
  assert.match(USAGE, /if \(!enabled\) return/, "a crew tap is a no-op before the SDK")
  assert.doesNotMatch(USAGE, /enabled = true/)
})

test("events carry names only, never customer content", () => {
  // the only detail any tap may carry is the stage tab name
  assert.match(USAGE, /detail\?: \{ stage\?: string \}/)
  for (const source of [BOARD, CALLS]) {
    for (const call of source.matchAll(/tapped\(TAPS\.\w+(?:, \{ stage \})?\)/g)) assert.ok(call)
    assert.doesNotMatch(source, /tapped\(TAPS\.\w+, \{ (?!stage \})/, "no other detail rides on a tap")
  }
})

test("every board surface the owner can tap is counted, once each", () => {
  for (const tap of ["callsOpen", "callSave", "callNotJob", "callReview"]) assert.match(CALLS, new RegExp(`tapped\\(TAPS\\.${tap}`))
  for (const tap of ["transcriptOpen", "heardPrice", "stageTab", "jobOpen", "jobExpand", "search"]) assert.match(BOARD, new RegExp(`tapped\\(TAPS\\.${tap}`))
})
