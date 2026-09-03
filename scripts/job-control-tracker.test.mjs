import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { QUOTE_SERVICE_OPTIONS } from "../lib/public-quote.mjs"

const PREVIEW_SOURCE = readFileSync(new URL("../app/board/board.tsx", import.meta.url), "utf8")
const PAGE_SOURCE = readFileSync(new URL("../app/board/page.tsx", import.meta.url), "utf8")
const OPS_DATA_SOURCE = readFileSync(new URL("../lib/ops-data.ts", import.meta.url), "utf8")
const LINE_ITEMS_SOURCE = readFileSync(new URL("../lib/job-line-items.ts", import.meta.url), "utf8")
const CALL_SKETCH_SOURCE = readFileSync(new URL("../lib/call-sketch-store.ts", import.meta.url), "utf8")
const BOARD_SOURCE = `${PAGE_SOURCE}\n${PREVIEW_SOURCE}`
const APP_DIRECTORY = fileURLToPath(new URL("../app/", import.meta.url))
const TRACKER_SOURCE = PREVIEW_SOURCE.slice(PREVIEW_SOURCE.indexOf('<h2 className="t-title">Job tracker</h2>'))
const RAIL_SOURCE = PREVIEW_SOURCE.slice(
  PREVIEW_SOURCE.indexOf('<nav className="rail"'),
  PREVIEW_SOURCE.indexOf("</nav>", PREVIEW_SOURCE.indexOf('<nav className="rail"')),
)
const DETAIL_SOURCE = PREVIEW_SOURCE.slice(
  PREVIEW_SOURCE.indexOf('{isOpen && <div className="detail"'),
  PREVIEW_SOURCE.indexOf("</article>", PREVIEW_SOURCE.indexOf('{isOpen && <div className="detail"')),
)

test("tracker tabs use the canonical stages and refetch the requested stage", () => {
  assert.match(PREVIEW_SOURCE, /board\.stages\.map\(\(stage\) =>/)
  assert.match(PREVIEW_SOURCE, /href=\{`\/board\?stage=\$\{stage\}\$\{chrome\.includeTests \? "&tests=1" : ""\}`\}/)
  assert.match(PREVIEW_SOURCE, /board\.counts\[stage\]/)
  assert.match(PAGE_SOURCE, /JOB_BOARD_STAGES\.includes\(requested as JobBoardStage\)/)
  assert.match(PAGE_SOURCE, /stages: \[\.\.\.JOB_BOARD_STAGES\]/)
  assert.match(PAGE_SOURCE, /listBoardJobs\(\{ stage, signal, order: "newest", query, includeTests, page: requestedPage \}, role\)/)
})

test("tracker rows come from listBoardJobs and keep its reason string verbatim", () => {
  assert.match(PAGE_SOURCE, /items: page\.items/)
  assert.match(TRACKER_SOURCE, /board\.items\.map\(\(lead\) =>/)
  assert.match(TRACKER_SOURCE, /\{lead\.board_reason\}/)
  assert.doesNotMatch(TRACKER_SOURCE, /attentionReason\(lead\.board_reason\)|BOARD_SIGNAL_LABELS\[lead\.board_reason\]/)
  for (const fixture of [
    "Monday, Aug 19",
    "Phil Lloyd",
    "Hendersonville Fab",
    "Wendy Cauthen",
    "Dock Repair",
    "Ray Colter",
    "Denz automotive",
    "Cedar Ridge",
    "18 stair stringers, 10 ga galvanized",
    "10 ga galv, 18 pcs",
    "Cut and form",
    "Weld and fit",
    "Galv touch-up",
    "$1,860",
    "$780",
    "$1,080",
    "$180",
    "$280",
    "$4,180",
    "$8,240",
    "$605",
  ]) {
    assert.ok(!BOARD_SOURCE.includes(fixture), `${fixture} mockup fixture survived on /board`)
  }
})

test("header date is generated for today in America/Chicago", () => {
  assert.match(PAGE_SOURCE, /const BOARD_DATE = new Intl\.DateTimeFormat\("en-US", \{\s*timeZone: "America\/Chicago",\s*weekday: "long",\s*month: "short",\s*day: "numeric",\s*\}\)/)
  assert.match(PAGE_SOURCE, /date: BOARD_DATE\.format\(new Date\(\)\)/)
  assert.match(PREVIEW_SOURCE, /<span className="when">\{chrome\.date\}<\/span>/)
  assert.doesNotMatch(PREVIEW_SOURCE, /<span className="when">[A-Z][^<{]*<\/span>/)
})

test("expanded-panel cost lines come only from stored job_line_items rows", () => {
  assert.match(TRACKER_SOURCE, /const lineItems = detail\?\.lineItems \?\? \[\]/)
  assert.match(DETAIL_SOURCE, /\? lineItems\.map\(\(item\) => <tr key=\{item\.id\}>/)
  assert.match(DETAIL_SOURCE, /<td>\{item\.label\}\{item\.note && <> <span className="q">\{item\.note\}<\/span><\/>\}<\/td>/)
  assert.match(DETAIL_SOURCE, /<td>\{formatCents\(item\.amountCents\)\}<\/td>/)
  assert.match(DETAIL_SOURCE, /No line items entered\./)
  assert.match(OPS_DATA_SOURCE, /listJobLineItemsForLeads\(ids, role, includeTests\)/)
  assert.match(OPS_DATA_SOURCE, /lineItems: lineItems\.get\(leadId\) \?\? \[\]/)
  assert.match(LINE_ITEMS_SOURCE, /FROM job_line_items items/)
  assert.match(LINE_ITEMS_SOURCE, /amountCents: Number\(row\.amount_cents\)/)
})

test("crew board details contain no money for the expanded panel", () => {
  const crewProjection = OPS_DATA_SOURCE.slice(
    OPS_DATA_SOURCE.indexOf("export function projectLeadForRole"),
    OPS_DATA_SOURCE.indexOf("export async function listBoardJobs"),
  )
  for (const field of [
    "estimate_value_cents",
    "revenue_cents",
    "paid_amount_cents",
    "invoice_total_cents",
    "invoice_due_at",
  ]) {
    assert.match(crewProjection, new RegExp(`${field}: null`), `${field} stopped being nulled for crew`)
  }
  assert.match(LINE_ITEMS_SOURCE, /export async function listJobLineItemsForLeads[\s\S]*?if \(role !== "owner"\) return byLead/)
  assert.match(OPS_DATA_SOURCE, /listJobLineItemsForLeads\(ids, role, includeTests\)/)
  assert.match(DETAIL_SOURCE, /lineItems\.map\(\(item\) => <tr key=\{item\.id\}>/)
})

test("every left-rail link resolves to an existing app route", () => {
  const links = [...RAIL_SOURCE.matchAll(/<Link className="rl" href="([^"]+)" aria-label="([^"]+)"/g)]
  // Leads left the rail with the final navigation pass: the board is the job
  // list, so that entry only linked the page to itself.
  assert.deepEqual(links.map(([, , label]) => label), [
    "Board",
    "Customers",
    "Quotes",
    "Money",
    "Help",
  ])
  for (const [, href, label] of links) {
    const pathname = new URL(href, "https://board.local").pathname
    const page = resolve(APP_DIRECTORY, `.${pathname}`, "page.tsx")
    assert.ok(existsSync(page), `${label} rail link points to missing route ${pathname}`)
  }
})

test("signal query values are strictly validated before filtering", () => {
  assert.match(PAGE_SOURCE, /const requestedSignal = params\.signal \?\? ""/)
  assert.match(PAGE_SOURCE, /const signal: BoardSignalKind \| undefined = BOARD_SIGNAL_KINDS\.includes\(requestedSignal as BoardSignalKind\)\s*\? \(requestedSignal as BoardSignalKind\)\s*: undefined/)
  assert.match(PAGE_SOURCE, /listBoardJobs\(\{ stage, signal, order: "newest", query, includeTests, page: requestedPage \}, role\)/)
  // The signal list left the pane on 2026-09-03; a ?signal= URL still
  // filters, and the tracker header is where it can be cleared.
  assert.doesNotMatch(PREVIEW_SOURCE, /SIGNAL_ORDER/)
  assert.match(PREVIEW_SOURCE, /href=\{boardHref\(\{ signal: null \}\)\}>Clear signal filter<\/Link>/)
})

test("call-sketch job actions only render when the call has a leadId", () => {
  assert.match(CALL_SKETCH_SOURCE, /export type BoardCallSketch = \{\s*leadId: number \| null/)
  assert.match(CALL_SKETCH_SOURCE, /SELECT c\.twilio_sid, c\.direction, c\.started_at, c\.duration_sec, c\.lead_id,/)
  assert.match(CALL_SKETCH_SOURCE, /leadId: call\.lead_id === null \? null : Number\(call\.lead_id\)/)
  assert.equal([...PREVIEW_SOURCE.matchAll(/\{sketch\?\.leadId != null &&/g)].length, 2)
  assert.match(PREVIEW_SOURCE, /\{sketch\?\.leadId != null &&\s*<Link[^>]+href=\{`\/ops\/leads\/\$\{sketch\.leadId\}`\}>Open the job<\/Link>\}/)
  assert.match(PREVIEW_SOURCE, /\{sketch\?\.leadId != null &&\s*<span className="end"><Link[^>]+href=\{`\/ops\/leads\/\$\{sketch\.leadId\}#spike`\}>Text him the three<\/Link><\/span>\}/)
})

test("tracker has an honest empty state and the protected regions remain", () => {
  assert.match(PREVIEW_SOURCE, /No jobs in this stage right now\./)
  assert.match(PAGE_SOURCE, /const EMPTY_BOARD: BoardPaneData = \{/)
  assert.doesNotMatch(PREVIEW_SOURCE, /export const EMPTY_BOARD/)
  assert.match(PREVIEW_SOURCE, /<h2 className="t-title">\{onTheLine \? "On the phone" : "Last call"\}<\/h2>/)
  // Both regions survive, now behind the fallback a call that described no
  // gate takes: the ask line and the answered count are still the panel's.
  assert.match(PREVIEW_SOURCE, /className="ask">\{askLabel\}<\/p>/)
  assert.match(PREVIEW_SOURCE, /const showSummary = !drawing\.hasDrawing && summary !== null/)
  assert.match(PREVIEW_SOURCE, /\$\{answered\} of \$\{PANEL_FACT_KEYS\.length\} answered/)
})

test("every service a form can write has a row mark", () => {
  // The mark is keyed on `service`, which is TEXT. It only stays honest while
  // the map covers what the forms actually write, so read the options back out
  // of the forms rather than trusting a copy of the list.
  const forms = [
    "../components/mainstreet-contact.tsx",
    "../app/ops/intake/job-intake-form.tsx",
    "../app/ops/intake/inline-job-intake.tsx",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))

  const written = new Set()
  for (const service of QUOTE_SERVICE_OPTIONS) written.add(service)
  assert.match(forms[0], /QUOTE_SERVICE_OPTIONS\.map/)
  for (const form of forms) {
    // Only the service select. The same forms carry a referral select whose
    // options are Google, Referral, Facebook — not services, and not marks.
    const start = form.indexOf('name="service"')
    assert.ok(start > -1, "a form stopped writing a service field")
    const select = form.slice(start, form.indexOf("</select>", start))
    for (const [, label] of select.matchAll(/<option(?![^>]*value=)[^>]*>([^<]+)<\/option>/g)) {
      const service = label.replace(/&amp;/g, "&").trim()
      if (!service.includes("{")) written.add(service)
    }
  }
  // "Not Sure / Other" is deliberately unmapped: it falls back to blank stock.
  written.delete("Not Sure / Other")
  assert.ok(written.size >= 6, `found only ${written.size} service options`)

  const marks = PREVIEW_SOURCE.slice(
    PREVIEW_SOURCE.indexOf("const SERVICE_MARKS"),
    PREVIEW_SOURCE.indexOf("function serviceMark"),
  )
  for (const service of written) {
    assert.ok(marks.includes(`"${service}"`), `no row mark for service ${service}`)
  }
  assert.match(PREVIEW_SOURCE, /SERVICE_MARKS\[service\.trim\(\)\] \?\?/)
})

// One tracker page stays thumb-sized; the pager below it makes every remaining
// stage row reachable without burying live-call actions thousands of pixels.
test("one tracker page stays bounded for a phone", () => {
  const list = OPS_DATA_SOURCE.slice(
    OPS_DATA_SOURCE.indexOf("export async function listBoardJobs"),
    OPS_DATA_SOURCE.indexOf("function boardDetailIds"),
  )
  const clamp = list.match(/const pageSize = Math\.min\(Math\.max\(Math\.floor\(options\.pageSize \?\? (\d+)\), 1\), (\d+)\)/)
  assert.ok(clamp, "listBoardJobs stopped clamping its page size")
  const [, fallback, ceiling] = clamp
  assert.equal(fallback, "8", "the phone tracker should show eight jobs at a time")
  assert.equal(ceiling, "50", "explicit callers remain bounded")
  // The honest count line stays: past the ceiling the board still says so and
  // the pager offers the remaining rows.
  assert.match(PREVIEW_SOURCE, /Showing \$\{board\.items\.length\} of \$\{board\.resultTotal\}/)
})

// Every field on the call panel comes from the server render. Without a timer
// the panel labelled live never gained a line, and a call that arrived while
// the board was open never appeared at all.
test("the call panel refreshes itself, faster while a call is on the line", () => {
  assert.match(PREVIEW_SOURCE, /import \{ useRouter \} from "next\/navigation"/)
  assert.match(PREVIEW_SOURCE, /router\.refresh\(\)/)
  const effect = PREVIEW_SOURCE.slice(
    PREVIEW_SOURCE.indexOf("let timer: number | undefined"),
    PREVIEW_SOURCE.indexOf("}, [router, onTheLine])"),
  )
  assert.ok(effect.length > 0, "the refresh effect lost its onTheLine dependency")
  const delays = effect.match(/onTheLine \? ([\d_]+) : ([\d_]+)/)
  assert.ok(delays, "the refresh interval stopped depending on whether a call is live")
  assert.ok(Number(delays[1].replace(/_/g, "")) < Number(delays[2].replace(/_/g, "")),
    "a live call must poll faster than an idle board")
  // Neon is billed by compute time. A hidden tab must not hold it awake.
  assert.match(effect, /document\.visibilityState !== "visible"/)
  assert.match(effect, /visibilitychange/)
})

// Fourteen transcript lines pushed the tracker most of a screen down the page.
test("an ended call folds the whole transcript behind one line; a live one shows its tail", () => {
  // Since 2026-09-03 the read above the transcript says what mattered, so an
  // ended call's words fold entirely. Live, the last lines stay in the open.
  assert.match(PREVIEW_SOURCE, /const PANEL_OPEN_LINES = \d+/)
  assert.match(PREVIEW_SOURCE, /sketch\?\.lines\.slice\(0, PANEL_OPEN_LINES\)/)
  assert.match(PREVIEW_SOURCE, /<details className="spoke-more" onToggle=/)
  assert.match(PREVIEW_SOURCE, /<summary>Read the whole call · \{sketch\.totalLines\} line\{sketch\.totalLines === 1 \? "" : "s"\}<\/summary>/)
  // Nothing is dropped — every line renders the same line markup inside the fold.
  assert.match(PREVIEW_SOURCE, /\{sketch\.lines\.map\(\(line\) =>/)
  const open = Number(PREVIEW_SOURCE.match(/const PANEL_OPEN_LINES = (\d+)/)[1])
  const live = Number(CALL_SKETCH_SOURCE.match(/const LIVE_LINES = (\d+)/)[1])
  assert.ok(open >= live, "a live call carries fewer lines than the open slice, so none are hidden")
})

test("the tracker paginates honestly past a full page", () => {
  const board = readFileSync("app/board/board.tsx", "utf8")
  assert.match(board, /hasNext/)
  assert.match(board, /Show the next/)
  const page = readFileSync("app/board/page.tsx", "utf8")
  assert.match(page, /params\.p\b/)
})

test("the voice snapshot rides the parallel fetch", () => {
  const page = readFileSync("app/board/page.tsx", "utf8")
  const all = page.slice(page.indexOf("Promise.all"), page.indexOf("])", page.indexOf("Promise.all")))
  assert.match(all, /getOwnerVoiceSnapshot/)
})

// Owner, 2026-09-03: saving a call meant leaving the board, opening the call,
// and typing a name before the save button would work. The board now carries
// the same pending-call queue the Calls tab reads, collapsed to one bar above
// the tracker, with a one-tap save that fills the name from what the phone
// already knows.
test("the board carries a one-tap calls-to-save dropdown above the tracker", () => {
  const CALLS_SOURCE = readFileSync(new URL("../app/board/recent-calls.tsx", import.meta.url), "utf8")
  const ACTIONS_SOURCE = readFileSync(new URL("../app/ops/intake/actions.ts", import.meta.url), "utf8")
  // same query as the Calls tab, ten at most
  assert.match(PAGE_SOURCE, /import \{ listPendingCallIntakes \} from "@\/lib\/job-intake"/)
  assert.match(PAGE_SOURCE, /listPendingCallIntakes\(\{ pageSize: 10 \}\)/)
  assert.match(PAGE_SOURCE, /calls=\{calls\}/)
  // the slot sits in main before the tracker card
  const main = PREVIEW_SOURCE.indexOf('<main className="main">')
  const slot = PREVIEW_SOURCE.indexOf("{calls}")
  const tracker = PREVIEW_SOURCE.indexOf('<div className="track-top">')
  assert.ok(main > -1 && main < slot && slot < tracker, `expected main < calls slot < tracker, got ${[main, slot, tracker]}`)
  // native disclosure, closed by default, nothing rendered for an empty queue
  assert.match(CALLS_SOURCE, /if \(calls\.length === 0\) return null/)
  assert.match(CALLS_SOURCE, /<details className="calls-drop" onToggle=/)
  assert.doesNotMatch(CALLS_SOURCE, /<details className="calls-drop"[^>]* open[ >]/)
  // one tap: the action fills the name itself and reuses the typed-save path
  assert.match(CALLS_SOURCE, /useActionState\(quickSaveCallAction, initialState\)/)
  assert.match(ACTIONS_SOURCE, /filled\.set\("firstName", draft\.caller_name\.trim\(\) \|\| \(last4 \? `Caller \$\{last4\}` : "Caller"\)\)/)
  assert.match(ACTIONS_SOURCE, /const result = await saveCallDraftRecord\(filled\)\s+revalidatePath\("\/board"\)/)
  // review still opens the full intake; dismiss stays owner-only
  assert.match(CALLS_SOURCE, /href=\{`\/ops\/intake\/\$\{call\.publicId\}`\}[\s\S]{0,60}>Review<\/Link>/)
  assert.match(CALLS_SOURCE, /\{owner && <form action=\{dismissCallFromBoardAction\}[\s\S]{0,60}>/)
  assert.match(ACTIONS_SOURCE, /export async function dismissCallFromBoardAction[\s\S]{0,400}if \(operator\.role !== "owner"\) throw/)
})
