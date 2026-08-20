import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// Post-conversion push links. A notification URL is only exercised when
// someone taps a push slip hours later, so a stale /ops?view=updates or
// /ops?search never fails a build — it just lands the owner on a dead
// query string. Pin each one here instead.

const root = new URL("..", import.meta.url)
const source = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n")

const CALLS = source("lib/calls.ts")
const MESSAGES = source("lib/messages.ts")
const NOTIFY = source("lib/notify.ts")
const PEOPLE = source("lib/people.ts")
const BOARD_PAGE = source("app/board/page.tsx")
const WIRE = source("app/ops/wire-strip.tsx")
const VERIFY = source("app/api/ops/verify/route.ts")

const LIB = { "lib/calls.ts": CALLS, "lib/messages.ts": MESSAGES, "lib/notify.ts": NOTIFY, "lib/people.ts": PEOPLE }

test("leadless call and text alerts fall back to the board's Updates surface", () => {
  assert.match(CALLS, /url: row\.lead_id \? `\/ops\/leads\/\$\{row\.lead_id\}#spike` : "\/board\/updates#wire"/)
  assert.match(MESSAGES, /url: row\.lead_id \? `\/ops\/leads\/\$\{row\.lead_id\}#spike` : "\/board\/updates#wire"/)
})

test("both coalesced-interrupt pushes point at the board's Updates surface", () => {
  // Two separate senders: the inline coalescer in notify() and the retry
  // sweep. Fixing one and missing the other is the whole failure mode.
  assert.match(NOTIFY, /url: "\/board\/updates",/)
  assert.match(NOTIFY, /url: "\/board\/updates#wire" \}\)/)
  assert.equal(NOTIFY.match(/\/board\/updates/g)?.length, 2)
})

test("the leadless identity conflict searches the board with the board's own parameter", () => {
  // /board reads params.q — a ?search= link would render an unfiltered board
  // and silently drop the identity the owner needs to find.
  assert.match(PEOPLE, /url: leadId \? `\/ops\/leads\/\$\{leadId\}#identity-jig` : `\/board\?q=\$\{encodeURIComponent\(input\.phone \|\| input\.email\)\}`/)
  assert.match(BOARD_PAGE, /const query = params\.q\?\.trim\(\)/)
})

test("no stale ops query string survives in the touched lib files", () => {
  for (const [path, text] of Object.entries(LIB)) {
    assert.doesNotMatch(text, /\/ops\?view=updates/, `${path} still pushes to /ops?view=updates`)
    assert.doesNotMatch(text, /\/ops\?search=/, `${path} still pushes to /ops?search=`)
  }
})

test("lead deep links and the signed-out door are left alone", () => {
  // /ops/leads/<id> routes are live, and /ops is deliberately the signed-out
  // error and sign-in door — neither is part of this conversion.
  assert.match(CALLS, /`\/ops\/leads\/\$\{row\.lead_id\}#spike`/)
  assert.match(MESSAGES, /`\/ops\/leads\/\$\{row\.lead_id\}#spike`/)
  assert.match(PEOPLE, /`\/ops\/leads\/\$\{leadId\}#identity-jig`/)
  assert.match(VERIFY, /\/ops\?error=link/)
})

test("the #wire anchor the pushes name still exists", () => {
  assert.match(WIRE, /id="wire"/)
})
