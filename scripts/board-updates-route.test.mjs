import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("..", import.meta.url)
const source = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n")
const exists = (path) => existsSync(new URL(path, root))

const PAGE = source("app/board/updates/page.tsx")
const WIRE = source("app/ops/wire-strip.tsx")

test("/board/updates is a server route in board language", () => {
  assert.ok(exists("app/board/updates/page.tsx"))
  assert.doesNotMatch(PAGE, /"use client"/)
  assert.match(PAGE, /export const dynamic = "force-dynamic"/)
  // board.css carries the base and pulls control.css; ops-shell.css is the
  // retired dashboard sheet and must never be dragged back in behind it.
  assert.match(PAGE, /import "\.\.\/board\.css"/)
  assert.match(PAGE, /import "\.\/updates\.css"/)
  assert.doesNotMatch(PAGE, /ops-shell\.css/)
  assert.ok(exists("app/board/updates/updates.css"))
})

test("the archive is gated before it reads a single update", () => {
  assert.match(PAGE, /if \(!dbConfigured\(\)\)/)
  assert.match(PAGE, /const operator = await getAuthenticatedOperator\(\)/)
  assert.match(PAGE, /if \(!operator\) redirect\("\/ops"\)/)
  // the gate has to precede every read, or a signed-out request still costs a
  // query against real customer rows before the redirect lands
  assert.ok(PAGE.indexOf('if (!operator) redirect("/ops")') < PAGE.indexOf("listWire("))
  assert.ok(PAGE.indexOf('if (!operator) redirect("/ops")') < PAGE.indexOf("getReadableEventById("))
})

test("wire wiring is the historical wiring: unread by default, past at 50", () => {
  assert.match(PAGE, /const wireHistory = params\.wire === "past"/)
  assert.match(PAGE, /const requestedWirePage = normalizePage\(params\.wirePage\)/)
  assert.match(PAGE, /const wireQuery = params\.wireQ\?\.trim\(\) \?\? ""/)
  assert.match(PAGE, /const wirePageSize = wireHistory \? 50 : 12/)
  assert.match(
    PAGE,
    /listWire\(operator\.id, operator\.role, \{ unreadOnly: !wireHistory, page: requestedWirePage, pageSize: wirePageSize, query: wireQuery \}\)/,
  )
  assert.match(PAGE, /countUnreadWire\(operator\.id, operator\.role\)/)
  assert.match(PAGE, /hasOlder=\{wireHasOlder\}/)
})

test("every projection stays on the server and carries the operator's role", () => {
  // role is never inferred in the browser: listWire, countUnreadWire and the
  // receipt projection each take it as an argument on this server render.
  for (const call of [/listWire\(operator\.id, operator\.role/, /countUnreadWire\(operator\.id, operator\.role/, /getReadableEventById\(receiptId, operator\.role\)/]) {
    assert.match(PAGE, call)
  }
  assert.doesNotMatch(PAGE, /revenue|amount_cents|price/i)
})

test("the receipt drawer projects before it renders and keeps call audio owner-only", () => {
  assert.match(PAGE, /const receiptRequested = Number\.isInteger\(receiptId\) && receiptId > 0/)
  assert.match(PAGE, /const receipt = receiptRequested \? await getReadableEventById\(receiptId, operator\.role\) : null/)
  // the centralized test/role projection runs before the drawer's markup.
  assert.ok(PAGE.indexOf("getReadableEventById(receiptId") < PAGE.indexOf("{receiptRequested && <section"))
  assert.match(PAGE, /receiptCall\[0\] && operator\.role === "owner" && <audio controls preload="none" src=\{`\/api\/ops\/call\/\$\{receiptCall\[0\]\.id\}`\}/)
  // a crew member who types an owner-only receipt id gets the card, not the row
  assert.match(PAGE, /This update is not available in your role\./)
  // Neon 42P18: every interpolation in the page's one query names its type
  assert.match(PAGE, /WHERE twilio_sid = \$\{receipt\.detail\.callSid\}::text/)
})

test("the paid moment is derived from a verified invoice.paid wire entry", () => {
  assert.match(PAGE, /const paidSlip = wire\.find\(\(slip\) => slip\.source_kind === "invoice\.paid"\)/)
  assert.match(PAGE, /\{paidSlip && <PaidMoment slipId=\{paidSlip\.id\} title=\{paidSlip\.title\} body=\{paidSlip\.body\} \/>\}/)
})

test("WireStrip keeps its actions and read marking on the existing APIs", () => {
  assert.match(WIRE, /fetch\("\/api\/ops\/wire\/read"/)
  assert.match(WIRE, /fetch\("\/api\/ops\/wire\/action"/)
  assert.match(WIRE, /if \(history\) return/)
  for (const kind of ["usual-paperwork", "quote-capture", "departure-confirm", "contact-intro", "contact-intro-email", "attachment-retry", "attach-payment"]) {
    assert.ok(WIRE.includes(`"${kind}"`), `${kind} action disappeared from the wire strip`)
  }
})

test("the strip's own links point at /board/updates, not the retired view", () => {
  assert.doesNotMatch(WIRE, /\/ops\?view=updates/)
  assert.match(WIRE, /<form className="ops-wire-search" action="\/board\/updates" method="get">/)
  // the view= discriminator is gone with the route it addressed
  assert.doesNotMatch(WIRE, /name="view"/)
  assert.match(WIRE, /href=\{`\/board\/updates\?wire=\$\{history \? "past" : "fresh"\}&wirePage=\$\{page - 1\}/)
  assert.match(WIRE, /href=\{`\/board\/updates\?wire=\$\{history \? "past" : "fresh"\}&wirePage=\$\{page \+ 1\}/)
  assert.match(WIRE, /href=\{history \? "\/board\/updates#wire" : "\/board\/updates\?wire=past#wire"\}/)
  assert.match(PAGE, /href="\/board\/updates">Close<\/Link>/)
})

test("the legacy dashboard body does not come back with the archive", () => {
  assert.doesNotMatch(PAGE, /jobs-app-shell|jobs-panel|ActiveJobIndex|WeightedJobIndex|ops-more-view/)
  for (const file of ["app/ops/active-job-index.tsx", "app/ops/weighted-job-index.tsx", "app/ops/jobs.css"]) {
    assert.equal(exists(file), false, `${file} must stay archived`)
  }
})
