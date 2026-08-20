import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")

const PAGE = read("../app/board/calls/page.tsx")
const CSS = read("../app/board/calls/calls.css")
const CONTROL = read("../styles/control.css")
const INTAKE = read("../app/ops/intake/inline-job-intake.tsx")

// The pending call queue was lost when /ops became the sign-in door. It comes
// back as a board route, and the thing that makes it the same queue is the
// data function it calls — not a second query written to look like it.
test("the route reads the existing pending-call query", () => {
  assert.match(PAGE, /import \{ listPendingCallIntakes, type CallIntakeDraft \} from "@\/lib\/job-intake"/)
  assert.match(PAGE, /import \{ normalizePage \} from "@\/lib\/pagination"/)
  assert.match(PAGE, /listPendingCallIntakes\(\{ page: normalizePage\(params\.callsPage\), pageSize: PAGE_SIZE \}\)/)
  assert.match(PAGE, /const PAGE_SIZE = 20/)
  assert.match(PAGE, /export const dynamic = "force-dynamic"/)
})

// Real callers' names and numbers behind the same door the rest of /ops sits
// behind. A missing database is a message; a missing operator is the door.
test("signed out lands on the /ops door and an unconfigured database says so", () => {
  assert.match(PAGE, /if \(!dbConfigured\(\)\)/)
  assert.match(PAGE, /const operator = await getAuthenticatedOperator\(\)/)
  assert.match(PAGE, /if \(!operator\) redirect\("\/ops"\)/)
  // Neither role is filtered out: owner and crew both work the queue.
  assert.doesNotMatch(PAGE, /operator\.role/)
})

// The row is the one the old dashboard rendered, word for word. A paraphrased
// status is a different claim about the same call.
test("the row keeps the three truthful call statuses", () => {
  assert.match(PAGE, /\["no-answer", "busy", "failed", "canceled"\]/)
  assert.match(PAGE, /draft\.call_status === "ringing"/)
  for (const label of ["Missed call", "On the phone now", "Call ready"]) {
    assert.ok(PAGE.includes(label), `the row must still say "${label}"`)
  }
})

test("the row says when, who, the number, and where to finish it", () => {
  assert.match(PAGE, /formatTime\(draft\.created_at\)/)
  assert.match(PAGE, /draft\.caller_name \|\| formatPhone\(draft\.phone\)/)
  assert.match(PAGE, /href=\{`\/ops\/intake\/\$\{draft\.public_id\}`\}/)
  // The phone formatter is the one the old row used, ten digits or nothing.
  assert.ok(PAGE.includes(String.raw`.replace(/^1(?=\d{10}$)/, "")`), "the ten-digit phone formatter must be the old one")
  assert.match(PAGE, /if \(digits\.length !== 10\) return phone \|\| "Number unavailable"/)
  assert.match(PAGE, /America\/Chicago/)
})

test("the total and the Newer/Older pagination survive under /board/calls", () => {
  assert.match(PAGE, /\{calls\.total\} total/)
  assert.match(PAGE, /calls\.total > calls\.pageSize/)
  assert.match(PAGE, /href=\{`\/board\/calls\?callsPage=\$\{page - 1\}`\}>Newer/)
  assert.match(PAGE, /href=\{`\/board\/calls\?callsPage=\$\{page \+ 1\}`\}>Older/)
  assert.match(PAGE, /page \* calls\.pageSize < calls\.total/)
  // The floor is normalizePage's and the ceiling is the query's; the raw param
  // is never parsed here, and the page rendered is the one that came back.
  assert.ok(!/Number\(params\.callsPage\)/.test(PAGE), "the page param must never be parsed raw")
  assert.match(PAGE, /const page = calls\.page/)
})

test("the empty queue says so instead of showing an empty frame", () => {
  assert.ok(PAGE.includes("No calls are waiting to be saved."))
})

// The intake's overflow link pointed at a view that no longer exists.
test("the intake's more-calls link points at the board route", () => {
  assert.ok(!INTAKE.includes("/ops?calls=all"), "the dead /ops?calls=all link must be gone")
  assert.match(INTAKE, /href="\/board\/calls"/)
  // The count text and the phone-in condition are unchanged.
  assert.match(INTAKE, /source === "phone-in" && pendingTotal > 1/)
  assert.match(INTAKE, /\{pendingTotal - 1\} more \{pendingTotal - 1 === 1 \? "call" : "calls"\}/)
})

// The old view is gone and stays gone: no legacy stylesheet, no dashboard
// markup, no archived module dragged back in behind this route.
test("nothing legacy comes back with it", () => {
  for (const dead of ["jobs.css", "jobs-brand.css", "jobs-call-row", "jobs-panel", "ops-more-view", "ops-pages", "archive"]) {
    assert.ok(!PAGE.includes(dead), `${dead} must not return with the calls route`)
    assert.ok(!CSS.includes(dead), `${dead} must not return with the calls stylesheet`)
  }
  assert.ok(!PAGE.includes("calls=all"), "the route no longer hangs off an /ops view param")
})

test("the stylesheet is control tokens only — it names no raw colour", () => {
  assert.match(CSS, /@import\s+"\.\.\/\.\.\/\.\.\/styles\/control\.css"/)
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/)
  // Every control component the page reaches for must actually exist.
  for (const component of [".btn", ".btn--go", ".btn--edge", ".chip", ".chip--warn", ".chip--info", ".chip--good", ".t-label", ".t-title", ".t-data", ".t-caption"]) {
    assert.ok(CONTROL.includes(`${component}{`) || CONTROL.includes(`${component} `) || CONTROL.includes(`${component},`),
      `${component} is used by the calls route but is not defined in control.css`)
    assert.ok(PAGE.includes(component.slice(1)), `${component} is asserted but the page does not use it`)
  }
})

test("the board itself is untouched by this task", () => {
  const board = read("../app/board/board.tsx")
  assert.ok(!board.includes("/board/calls"), "navigation to the calls route is a later task")
})
