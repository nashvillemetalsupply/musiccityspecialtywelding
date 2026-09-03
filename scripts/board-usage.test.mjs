import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const USAGE = read("../app/board/usage.ts")
const BOARD = read("../app/board/board.tsx")
const CALLS = read("../app/board/recent-calls.tsx")
const ROUTE = read("../app/api/ops/usage/route.ts")
const MIGRATE = read("../scripts/migrate.mjs")

// The repo rule: no worker surveillance. Usage counts exist so the next board
// change is built on what the owner taps; they must never count a crew tap.
test("usage counting is owner-only at the source, not in a dashboard filter", () => {
  assert.match(BOARD, /\{chrome\.owner && <Analytics \/>\}/, "the script only loads for the owner")
  assert.match(BOARD, /useEffect\(\(\) => \{ enableUsage\(chrome\.owner\) \}, \[chrome\.owner\]\)/)
  assert.match(USAGE, /if \(!enabled\) return/, "a crew tap is a no-op before it leaves the browser")
  assert.doesNotMatch(USAGE, /enabled = true/)
  // and the server refuses crew regardless of what the client sends
  assert.match(ROUTE, /if \(operator\.role !== "owner"\) return Response\.json\(\{ ok: false \}, \{ status: 403 \}\)/)
})

// Hobby-plan Web Analytics has no custom events, so taps are counted first
// party: one row per day per name, nothing else stored.
test("taps are counted first party, by name and day only", () => {
  assert.doesNotMatch(USAGE, /@vercel\/analytics/, "no vendor events; the plan does not carry them")
  assert.match(USAGE, /navigator\.sendBeacon\?\.\("\/api\/ops\/usage"/)
  assert.match(ROUTE, /const TAP = \/\^\[a-z\]\[a-z0-9-\]\{1,40\}\(\?::\[a-z\]\[a-z0-9-\]\{1,20\}\)\?\$\//, "the name is validated before it touches SQL")
  assert.match(ROUTE, /INSERT INTO usage_taps \(day, name, taps\)[\s\S]{0,160}ON CONFLICT \(day, name\) DO UPDATE SET taps = usage_taps\.taps \+ 1/)
  assert.match(MIGRATE, /CREATE TABLE IF NOT EXISTS usage_taps \([\s\S]{0,200}PRIMARY KEY \(day, name\)/)
  for (const hole of ROUTE.matchAll(/\$\{[^}]+\}(::\w+)?/g)) assert.ok(hole[1], `uncast interpolation: ${hole[0]}`)
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
