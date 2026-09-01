import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// Final navigation pass of the ops→board conversion: the rail stops linking
// the board to itself, the /ops menu and dock mount on /board so #radio and
// #handset work from the front door, and every notification deep link lands
// on a board surface that still answers it. All of this is invisible at
// runtime until someone taps the wrong slip, so the contracts are pinned here.

const root = new URL("..", import.meta.url)
const source = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n")

const BOARD = source("app/board/board.tsx")
const PAGE = source("app/board/page.tsx")
const CSS = source("app/board/board.css")
const MORE = source("app/ops/more-menu.tsx")
const GMAIL = source("app/api/ingest/gmail/route.ts")
const RECOVERY = source("lib/recovery-sweep.ts")
const BRIEF = source("app/api/ops/brief/route.ts")

test("the rail carries no self-loop and Customers is a live board destination", () => {
  // The board is the job list, so a "Leads" entry pointing at /ops (which
  // redirects straight back here) linked the page to itself.
  assert.doesNotMatch(BOARD, /aria-label="Leads"/)
  assert.doesNotMatch(BOARD, /view=regulars/)
  assert.match(BOARD, /href="\/board\/customers" aria-label="Customers"/)
  // The rail collapse arithmetic followed the entry count down: the old rule
  // hid the 4th and 7th anchors of seven; with Leads gone it hides Quotes.
  assert.doesNotMatch(CSS, /nth-of-type\(4\)|nth-of-type\(7\)/)
  assert.match(CSS, /\.rail \.rl:nth-of-type\(3\)\{display:none\}/)
  assert.match(CSS, /\.rail \.rl:nth-of-type\(3\)\{display:grid\}/)
})

test("the signed-in board mounts the shared menu so #radio and #handset resolve", () => {
  // The menu renders on the server page, only when a session exists — the
  // same gate the /ops layout applies to its chrome.
  assert.match(PAGE, /import \{ MoreMenu \} from "@\/app\/ops\/more-menu"/)
  assert.match(PAGE, /const menu = <MoreMenu role=\{role\} vapidPublicKey=\{process\.env\.NEXT_PUBLIC_VAPID_PUBLIC_KEY\?\.trim\(\) \?\? ""\} voiceReady=\{voiceTranscriptionConfigured\(\)\} initialSearch=\{query\} includeTests=\{includeTests\} \/>/)
  assert.match(PAGE, /menu=\{menu\}/)
  // menu is declared after the signed-out return, so a signed-out render can
  // never receive it
  assert.ok(PAGE.indexOf("const menu = <MoreMenu") > PAGE.indexOf("if (!operator) return <JobControl"))
  // The board mounts it inside its own scope class, and never drags the
  // retired ops-shell sheet back in behind it.
  // A div, not a span: MoreMenu renders div/aside descendants, and flow
  // content inside phrasing content is invalid HTML.
  assert.match(BOARD, /\{menu && <div className="board-more">\{menu\}<\/div>\}/)
  assert.doesNotMatch(PAGE, /ops-shell\.css/)
  assert.doesNotMatch(BOARD, /ops-shell/)
  assert.match(CSS, /\.board-more \.ops-more-trigger\{/)
  assert.match(CSS, /\.board-more \.ops-more-backdrop\{/)
  assert.match(CSS, /\.board-more \.jobs-sr-only\{/)
  // The hash handling that opens the right surface still lives in the shared
  // components the board now mounts.
  assert.match(MORE, /\["#radio", "#handset"\]\.includes\(window\.location\.hash\)/)
  assert.match(MORE, /<ShopDock voiceReady=\{voiceReady\}/)
  // The menu's inert guard covers the board shell as well as the /ops one.
  assert.match(MORE, /const previousInert = new Map<HTMLElement, boolean>\(\)/)
  assert.match(MORE, /sibling\.inert = true/)
  assert.match(MORE, /surface\.inert = wasInert/)
})

test("the menu exposes the live Customers, Updates and Calls destinations", () => {
  assert.match(MORE, /<Link href="\/board\/calls" onClick=\{close\}>Calls<\/Link>/)
  assert.match(MORE, /<Link href="\/board\/customers" onClick=\{close\}>Customers<\/Link>/)
  assert.match(MORE, /<Link href="\/board\/updates" onClick=\{close\}>Updates<\/Link>/)
})

test("gmail ingest deep links land on /board/updates with their intent intact", () => {
  assert.doesNotMatch(GMAIL, /view=updates/)
  // past-wire history, fresh-wire anchor, and the plain archive each survive
  assert.match(GMAIL, /url: "\/board\/updates\?wire=past#wire"/)
  assert.match(GMAIL, /url: "\/board\/updates#wire"/)
  assert.match(GMAIL, /url: "\/board\/updates", sourceEventId: deadEventId/)
})

test("the reminder receipt link opens the board's receipt drawer", () => {
  assert.doesNotMatch(RECOVERY, /view=updates/)
  assert.match(RECOVERY, /url: `\/board\/updates\?receipt=\$\{event\.id\}#receipt`/)
})

test("the Morning Brief notification opens the board radio", () => {
  assert.doesNotMatch(BRIEF, /"\/ops#radio"/)
  assert.equal((BRIEF.match(/url: "\/board#radio"/g) ?? []).length, 2)
  // the crew/owner promise-sheet split is untouched by the retarget
  assert.match(BRIEF, /const ownerPromiseSheet/)
  assert.match(BRIEF, /const crewPromiseSheet/)
})

test("the tests=1 convention is untouched by the navigation pass", () => {
  // boardHref still owns the flag; the new rail and menu links are different
  // pages that read their own params, so none of them hand-builds a /board
  // query URL that could drop it.
  assert.equal(BOARD.match(/chrome\.includeTests/g).length, 3)
  assert.match(BOARD, /if \(chrome\.includeTests\) params\.set\("tests", "1"\)/)
})
