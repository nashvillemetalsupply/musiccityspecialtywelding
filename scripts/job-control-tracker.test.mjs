import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

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
  assert.match(PAGE_SOURCE, /listBoardJobs\(\{ stage, signal, order: "oldest", query, includeTests \}, role\)/)
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
  assert.match(OPS_DATA_SOURCE, /listJobLineItemsForLeads\(ids, role\)/)
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
  assert.match(OPS_DATA_SOURCE, /listJobLineItemsForLeads\(ids, role\)/)
  assert.match(DETAIL_SOURCE, /lineItems\.map\(\(item\) => <tr key=\{item\.id\}>/)
})

test("every left-rail link resolves to an existing app route", () => {
  const links = [...RAIL_SOURCE.matchAll(/<Link className="rl" href="([^"]+)" aria-label="([^"]+)"/g)]
  assert.deepEqual(links.map(([, , label]) => label), [
    "Board",
    "Leads",
    "Customers",
    "Quotes",
    "Promises",
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
  assert.match(PAGE_SOURCE, /listBoardJobs\(\{ stage, signal, order: "oldest", query, includeTests \}, role\)/)
  assert.match(PREVIEW_SOURCE, /SIGNAL_ORDER\.map\(\(kind\) =>/)
  assert.match(PREVIEW_SOURCE, /href=\{boardHref\(\{ signal: kind \}\)\}/)
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
  assert.match(PREVIEW_SOURCE, /SIGNAL_ORDER\.map\(\(kind\) =>/)
  assert.match(PREVIEW_SOURCE, /<h3 className="t-sub">Promises<\/h3>/)
  assert.match(PREVIEW_SOURCE, /<h2 className="t-title">Live call sketch<\/h2>/)
  assert.match(PREVIEW_SOURCE, /<p className="ask">Ask next<\/p>/)
  assert.match(PREVIEW_SOURCE, /\{answered\} of \{PANEL_FACT_KEYS\.length\} answered/)
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
  for (const form of forms) {
    // Only the service select. The same forms carry a referral select whose
    // options are Google, Referral, Facebook — not services, and not marks.
    const start = form.indexOf('name="service"')
    assert.ok(start > -1, "a form stopped writing a service field")
    const select = form.slice(start, form.indexOf("</select>", start))
    for (const [, label] of select.matchAll(/<option(?![^>]*value=)[^>]*>([^<]+)<\/option>/g)) {
      written.add(label.replace(/&amp;/g, "&").trim())
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
