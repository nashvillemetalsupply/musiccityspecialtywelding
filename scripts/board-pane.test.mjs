import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { BOARD_WEIGHTS, BOARD_SIGNAL_LABELS } from "../lib/shop-brain-invariants.mjs"
import { signalCountsFromCandidates } from "../lib/ops-data-testkit.mjs"

const OPS_DATA_SOURCE = readFileSync(new URL("../lib/ops-data.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const COMMITMENTS_SOURCE = readFileSync(new URL("../lib/commitments.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const EVENTS_SOURCE = readFileSync(new URL("../lib/events.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const EXTRACT_SOURCE = readFileSync(new URL("../lib/extract.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const PAGE_SOURCE = readFileSync(new URL("../app/board/page.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const PREVIEW_SOURCE = readFileSync(new URL("../app/board/board.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("relative board times share the server render clock", () => {
  assert.doesNotMatch(PREVIEW_SOURCE, /Date\.now\(\)/)
  assert.match(PAGE_SOURCE, /const nowMs = new Date\(\)\.getTime\(\)/)
  assert.equal((PAGE_SOURCE.match(/<JobControl[^>]*nowMs=\{nowMs\}/g) ?? []).length, 2)
  for (const helper of ["sinceInWords", "callLine", "waitingAge"]) {
    assert.match(PREVIEW_SOURCE, new RegExp(`function ${helper}\\([^)]*nowMs: number`))
  }
})

test("the Waiting date is identical on UTC servers and Central phones", () => {
  const waitingDate = PREVIEW_SOURCE.slice(
    PREVIEW_SOURCE.indexOf("function waitingDate"),
    PREVIEW_SOURCE.indexOf("function moneyFor"),
  )
  assert.match(waitingDate, /timeZone: "America\/Chicago"/)
})

// Four of the five labels must equal a reason string the board query already
// emits. A previous design round was rejected for paraphrasing these, and a
// paraphrase here would be invisible until someone read both files together.
test("every signal kind has a label, and four of them are the query's own words", () => {
  assert.deepEqual(Object.keys(BOARD_SIGNAL_LABELS).sort(), Object.keys(BOARD_WEIGHTS.signal).sort())
  for (const reason of ["Needs a call", "Promise overdue", "Follow-up due", "Email did not deliver"]) {
    assert.ok(
      Object.values(BOARD_SIGNAL_LABELS).includes(reason),
      `${reason} is emitted by ops-data.ts but no signal label uses it`,
    )
    assert.ok(OPS_DATA_SOURCE.includes(`'${reason}'`), `${reason} is no longer emitted by ops-data.ts`)
  }
  // `waiting` is the one kind with no single reason string: the query emits
  // four, chosen by whichever inbound event landed last.
  assert.equal(BOARD_SIGNAL_LABELS.waiting, "Customer waiting")
  for (const reason of ["Customer text waiting", "Customer email waiting", "New files waiting", "Missed call"]) {
    assert.ok(OPS_DATA_SOURCE.includes(`'${reason}'`), `${reason} is no longer emitted by ops-data.ts`)
  }
})

test("the pane counts jobs, not signals, and only jobs on the board", () => {
  const candidates = [
    { lead_id: 1, kind: "waiting" },
    { lead_id: 1, kind: "promise" },
    { lead_id: 1, kind: "waiting" }, // two inbound signals, one job
    { lead_id: 2, kind: "waiting" },
    { lead_id: 3, kind: "noreply" }, // lost/spam/handed off — not on the board
  ]
  const counts = signalCountsFromCandidates(candidates, [1, 2])
  assert.equal(counts.waiting, 2)
  assert.equal(counts.promise, 1)
  assert.equal(counts.noreply, 0, "a job off the board must not raise a signal on the pane")
  assert.equal(counts.followup, 0)
  assert.equal(counts.bounced, 0)
})

test("the five counts need not sum to the headline", () => {
  // One job carrying three signals is one job needing him and three rows.
  const counts = signalCountsFromCandidates(
    [{ lead_id: 7, kind: "waiting" }, { lead_id: 7, kind: "promise" }, { lead_id: 7, kind: "bounced" }],
    [7],
  )
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  assert.equal(total, 3)
  assert.equal(new Set([7]).size, 1, "one job is in the attention stage")
})

test("signal counts are counted off the same CTEs the tracker rows are built from", () => {
  assert.match(
    OPS_DATA_SOURCE,
    /SELECT c\.kind, count\(DISTINCT c\.lead_id\)::int AS jobs\s+FROM candidates c JOIN board b ON b\.id = c\.lead_id\s+GROUP BY c\.kind/,
  )
  assert.ok(OPS_DATA_SOURCE.includes("CROSS JOIN signal_counts sc"))
})

test("a kind no job carries still reports a zero", () => {
  assert.match(OPS_DATA_SOURCE, /const counts: Record<BoardSignalKind, number> = \{ waiting: 0, noreply: 0, promise: 0, followup: 0, bounced: 0 \}/)
})

test("the promises block counts the shop's own promises, on the two axes the pane names", () => {
  assert.ok(COMMITMENTS_SOURCE.includes("c.direction = 'we_promised'"))
  assert.ok(!/direction = 'they_promised'/.test(COMMITMENTS_SOURCE.split("getPromiseSummary")[1] ?? ""))
  // Kept is this month; open and broken are both right now.
  assert.match(COMMITMENTS_SOURCE, /WHERE c\.status = 'kept'\s+AND c\.status_changed_at >= \(date_trunc\('month', now\(\) AT TIME ZONE 'America\/Chicago'\)/)
  assert.match(COMMITMENTS_SOURCE, /WHERE c\.status = 'open' AND c\.due_at IS NOT NULL AND c\.due_at < now\(\)\s+\)::int AS broken/)
  assert.match(COMMITMENTS_SOURCE, /WHERE c\.status = 'open' AND \(c\.due_at IS NULL OR c\.due_at >= now\(\)\)\s+\)::int AS open/)
})

// Nothing in this codebase ever wrote `status = 'broken'`. The counter read a
// status no path set, so the board reported a shop that had never missed a
// promise in its life. Broken is derived from the promise itself: past its
// date and still owed. Open counts the rest, so the two split every open
// promise between them and neither can double-count one.
test("broken promises are counted, and no promise is counted twice", () => {
  const summary = COMMITMENTS_SOURCE.slice(
    COMMITMENTS_SOURCE.indexOf("export async function getPromiseSummary"),
    COMMITMENTS_SOURCE.indexOf("export async function setCommitmentStatus"),
  )
  assert.ok(
    !/status = 'broken'/.test(summary),
    "broken has no writer anywhere in the app, so the summary must not read it as a stored status",
  )
  const writesBroken = [COMMITMENTS_SOURCE, EVENTS_SOURCE, EXTRACT_SOURCE]
    .some((source) => /SET[\s\S]{0,80}status = 'broken'/.test(source))
  assert.ok(!writesBroken, "if something starts storing 'broken', this counter has to be revisited")
  assert.match(PREVIEW_SOURCE, /broken is past its date and still owed/)
})

// The pane's one "you are late on this" line went nowhere. It opens the
// promise on its own work order, where the customer's last message and the
// call button are both in reach — the order the shop works in.
test("the overdue callout opens the promise it names", () => {
  const JOB_PAGE_SOURCE = readFileSync(new URL("../app/ops/leads/[id]/page.tsx", import.meta.url), "utf8")
  assert.match(PREVIEW_SOURCE, /<Link className="due" href=\{`\/ops\/leads\/\$\{promises\.overdue\.leadId\}#promise-\$\{promises\.overdue\.id\}`\}>/)
  // The anchor has to exist on the other end, or the link lands on a page and stops.
  assert.match(JOB_PAGE_SOURCE, /id=\{`promise-\$\{promise\.id\}`\}/)
  // A promise with no lead behind it has no work order to open.
  assert.match(PREVIEW_SOURCE, /promises\.overdue\.leadId\s*\?/)
  assert.match(PREVIEW_SOURCE, /: <div className="due">/)
})

test("canceled and superseded promises are counted nowhere", () => {
  const summary = COMMITMENTS_SOURCE.slice(COMMITMENTS_SOURCE.indexOf("export async function getPromiseSummary"))
  const body = summary.slice(0, summary.indexOf("export async function setCommitmentStatus"))
  assert.ok(!body.includes("'canceled'"), "a canceled promise is not a broken one")
  assert.ok(!body.includes("'superseded'"), "superseded is the correction mechanism; counting it double-counts")
})

test("all promise summary identities and source markers are fail-closed", () => {
  const summary = COMMITMENTS_SOURCE.slice(
    COMMITMENTS_SOURCE.indexOf("export async function getPromiseSummary"),
    COMMITMENTS_SOURCE.indexOf("export async function setCommitmentStatus"),
  )
  for (const filter of [
    "COALESCE(l.is_test, false) = false",
    "COALESCE(p.is_test, false) = false",
    "COALESCE(source_lead.is_test, false) = false",
    "COALESCE(source_person.is_test, false) = false",
    "lower(COALESCE(source.detail->>'isTest', 'false')) <> 'true'",
    "NOT ILIKE '%[INTERNAL TEST]%'",
  ]) {
    assert.equal(summary.split(filter).length - 1, 2, `${filter} must protect counts and the overdue row`)
  }
  assert.equal((summary.match(/LEFT JOIN events source ON source\.id = c\.source_event_id/g) ?? []).length, 2)
  assert.equal((summary.match(/p\.id = COALESCE\(c\.person_id, l\.person_id\)/g) ?? []).length, 2)
  assert.equal((summary.match(/source_person\.id = COALESCE\(source\.person_id, source_lead\.person_id\)/g) ?? []).length, 2)
  assert.equal((summary.match(/source_lead\.message, source_lead\.notes/g) ?? []).length, 2)
})

test("the overdue promise is role-projected before the board receives it", () => {
  const summary = COMMITMENTS_SOURCE.slice(
    COMMITMENTS_SOURCE.indexOf("export async function getPromiseSummary"),
    COMMITMENTS_SOURCE.indexOf("export async function setCommitmentStatus"),
  )
  assert.match(summary, /getPromiseSummary\(role: OperatorRole\)/)
  assert.match(summary, /projectCommitmentForRole\(late, role\)/)
  assert.match(summary, /summary: projectedLate\?\.summary/)
  assert.match(summary, /customerName: role === "owner" \? late\.customer_name : ""/)
  assert.match(summary, /service: role === "owner" \? late\.service : ""/)
  assert.match(PAGE_SOURCE, /getPromiseSummary\(role\)/)
  assert.doesNotMatch(PAGE_SOURCE, /getPromiseSummary\(\)/)
})

test("out the door measures the door, not the sale, and removes money for crew", () => {
  assert.match(OPS_DATA_SOURCE, /FROM leads\s+WHERE completed_at >= \(date_trunc\('week', now\(\) AT TIME ZONE 'America\/Chicago'\)/)
  assert.match(OPS_DATA_SOURCE, /revenueCents: role === "owner" \? Number\(row\?\.revenue_cents \?\? 0\) : null/)
  assert.match(OPS_DATA_SOURCE, /stillOutCents: role === "owner" \? Number\(row\?\.still_out_cents \?\? 0\) : null/)
})

test("the Today trail is the newest bounded slice of the Central calendar day", () => {
  const today = EVENTS_SOURCE.slice(EVENTS_SOURCE.indexOf("export async function listTodayEvents"))
  assert.match(today, /e\.occurred_at >= \(date_trunc\('day', now\(\) AT TIME ZONE 'America\/Chicago'\) AT TIME ZONE 'America\/Chicago'\)/)
  assert.match(today, /e\.occurred_at < \(\(date_trunc\('day', now\(\) AT TIME ZONE 'America\/Chicago'\) \+ interval '1 day'\) AT TIME ZONE 'America\/Chicago'\)/)
  assert.match(today, /ORDER BY e\.occurred_at DESC, e\.id DESC\s+LIMIT \$\{bounded\}::bigint/)
  assert.match(PAGE_SOURCE, /listTodayEvents\(role\)/)
})

test("the Today trail excludes every test identity and projects bodies for the operator role", () => {
  const today = EVENTS_SOURCE.slice(EVENTS_SOURCE.indexOf("export async function listTodayEvents"))
  assert.match(today, /COALESCE\(l\.is_test, false\) = false/)
  assert.match(today, /COALESCE\(p\.is_test, false\) = false/)
  assert.match(today, /l\.id IS NULL OR l\.status <> 'spam'/)
  assert.match(today, /lower\(COALESCE\(e\.detail->>'isTest', 'false'\)\) <> 'true'/)
  assert.match(today, /projectEventForRole\(event, role\)/)
})

test("the Today trail uses shop labels verbatim and has no signed-out fixtures", () => {
  assert.match(PREVIEW_SOURCE, /shopEventLabel\(event\.kind\)/)
  assert.match(PREVIEW_SOURCE, /timeZone: "America\/Chicago"/)
  assert.match(PAGE_SOURCE, /todayTrail: \[\]/)
  assert.doesNotMatch(PREVIEW_SOURCE, /Price worked out for Phil Lloyd|Ray Colter called|Denz automotive asked|Gerald Pace plate finished/)
})

// Several kinds carry a fixed body — every handoff reads the same sentence —
// so four jobs handed off in a minute printed four identical lines and read as
// a duplication bug. The customer is the only thing separating them.
test("each Today trail line names its customer", () => {
  const today = EVENTS_SOURCE.slice(EVENTS_SOURCE.indexOf("export async function listTodayEvents"))
  assert.match(today, /AS customer/)
  assert.match(today, /customer: event\.customer/)
  assert.match(PAGE_SOURCE, /todayTrail: todayEvents\.map\(\(\{[^}]*customer[^}]*\}\)/)
  assert.match(PREVIEW_SOURCE, /event\.customer && ` · \$\{event\.customer\}`/)
})

test("the Today trail collapses long receipts to one readable line", () => {
  assert.match(PAGE_SOURCE, /function trailBody\(body: string\)/)
  assert.match(PAGE_SOURCE, /body\.replace\(\/\\s\+\/g, " "\)\.trim\(\)/)
  assert.match(PAGE_SOURCE, /oneLine\.length <= 140/)
  assert.match(PAGE_SOURCE, /body: trailBody\(body\)/)
})

// Extraction is handed the open commitments as context and restates them:
// one call produced two promises, the customer's next text restated both, and
// the week printed four. `ON CONFLICT (source_event_id, item_key)` cannot see
// it — a second event is a second key — so the promise itself is the key.
test("a restated promise is not a second promise", () => {
  const add = COMMITMENTS_SOURCE.slice(
    COMMITMENTS_SOURCE.indexOf("export async function addCommitment"),
    COMMITMENTS_SOURCE.indexOf("export async function listCommitments"),
  )
  assert.match(add, /status = 'open'/)
  assert.match(add, /btrim\(lower\(summary\)\) = btrim\(lower\(\$\{input\.summary\}::text\)\)/)
  assert.match(add, /due_at IS NOT DISTINCT FROM \$\{input\.dueAt \?\? null\}::timestamptz/)
  assert.match(add, /if \(restated\[0\]\) return Number\(restated\[0\]\.id\)/)
  // The guard runs before the insert, not after it.
  assert.ok(
    add.indexOf("if (restated[0])") < add.indexOf("INSERT INTO commitments"),
    "the duplicate check has to run before the insert",
  )
  assert.match(EXTRACT_SOURCE, /A promise already in open_commitments is on the books/)
  // The prompt may only name states `marks_existing_as` can actually carry.
  const marksExisting = EXTRACT_SOURCE.match(/marks_existing_as: z\.enum\(\[([^\]]*)\]\)/)?.[1] ?? ""
  assert.ok(marksExisting.includes("kept") && marksExisting.includes("superseded"))
  assert.doesNotMatch(EXTRACT_SOURCE, /matches_existing_commitment_id when this event kept, broke, or canceled it/)
})

// Both owners have to match, not either. A promise is filed under a lead and a
// person; matching the person alone collapses the same sentence across two of
// that customer's jobs, which are two real promises. The same scoping has to
// hold for the context handed to extraction, because the prompt now tells it
// not to re-emit anything it is shown.
test("a promise is deduped against its own job, not the whole customer", () => {
  const add = COMMITMENTS_SOURCE.slice(
    COMMITMENTS_SOURCE.indexOf("export async function addCommitment"),
    COMMITMENTS_SOURCE.indexOf("export async function listCommitments"),
  )
  for (const source of [add, EXTRACT_SOURCE]) {
    assert.match(source, /lead_id IS NOT DISTINCT FROM/)
    assert.match(source, /person_id IS NOT DISTINCT FROM/)
  }
  assert.doesNotMatch(EXTRACT_SOURCE, /IS NOT NULL AND lead_id = \$\{event\.lead_id/)
  // The database holds the rule, because the read above is not atomic with the
  // insert and extractions for one job overlap.
  const MIGRATE_SOURCE = readFileSync(new URL("../scripts/migrate.mjs", import.meta.url), "utf8")
  assert.match(MIGRATE_SOURCE, /CREATE UNIQUE INDEX IF NOT EXISTS commitments_open_promise_unique/)
  assert.match(MIGRATE_SOURCE, /SET status = 'superseded'/)
  assert.ok(
    MIGRATE_SOURCE.indexOf("SET status = 'superseded'") < MIGRATE_SOURCE.indexOf("commitments_open_promise_unique"),
    "duplicates must be retired before the unique index is built, or it cannot be built",
  )
  assert.match(add, /ON CONFLICT DO NOTHING/)
})

// The job row loads both directions. Without the direction check the shop gets
// blamed for a promise the customer made and missed.
test("only the shop's own promises can be called broken", () => {
  assert.match(PREVIEW_SOURCE, /commitment\.direction === "we_promised"\s*\n\s*&& commitment\.status === "open"/)
  const list = COMMITMENTS_SOURCE.slice(
    COMMITMENTS_SOURCE.indexOf("export async function listCommitments"),
    COMMITMENTS_SOURCE.indexOf("export type PromiseSummary"),
  )
  // Asked for 'broken' literally this returned nothing forever, so Ask Jobs
  // could answer "no broken promises" while the board showed several.
  assert.match(list, /= 'broken'\s*\n\s*AND c\.status = 'open' AND c\.due_at IS NOT NULL AND c\.due_at < now\(\)/)
})

// A marker-only test identity reaches the live board without this, and the
// trail row now prints the customer's name.
test("the Today trail honours the [INTERNAL TEST] marker", () => {
  const today = EVENTS_SOURCE.slice(EVENTS_SOURCE.indexOf("export async function listTodayEvents"))
  assert.match(today, /NOT ILIKE '%\[INTERNAL TEST\]%'/)
})

test("board job details are typed, wired, and remain data-only in W1", () => {
  assert.match(OPS_DATA_SOURCE, /export type BoardJobDetail = \{[\s\S]*activeClaims: ClaimRow\[\][\s\S]*newestPhotoAt: string \| null[\s\S]*eventTrail: EventRow\[\][\s\S]*lineItems: JobLineItem\[\]/)
  assert.match(PREVIEW_SOURCE, /details: Map<number, BoardJobDetail>/)
  assert.doesNotMatch(PREVIEW_SOURCE, /board\.details/)
  assert.match(PAGE_SOURCE, /getBoardJobDetails\(page\.items\.map\(\(item\) => item\.id\), role, includeTests\)/)
  assert.match(PAGE_SOURCE, /details: new Map\(\)/)
})

test("board job details compose five batched facts with server-side role projections", () => {
  const details = OPS_DATA_SOURCE.slice(OPS_DATA_SOURCE.indexOf("async function listBoardActiveClaims"), OPS_DATA_SOURCE.indexOf("export async function getLead"))
  assert.match(details, /c\.subject_id = ANY\(\$\{leadIds\}::bigint\[\]\)/)
  assert.match(details, /c\.status = ANY\(ARRAY\['open','broken'\]::text\[\]\)/)
  assert.match(details, /projectClaimForRole\(row, role\)/)
  assert.match(details, /projectCommitmentForRole\(row, role\)/)
  assert.match(details, /newestPhotoAt: newestPhotoDates\.get\(leadId\) \?\? null/)
  for (const call of [
    "listBoardActiveClaims(ids, role, includeTests)",
    "listBoardOpenOrBrokenCommitments(ids, role, includeTests)",
    "listBoardNewestPhotoDates(ids, includeTests)",
    "listBoardEventTrails(ids, role, 4, includeTests)",
    "listJobLineItemsForLeads(ids, role, includeTests)",
  ]) assert.ok(details.includes(call), `${call} is missing from the five-query batch`)
  assert.ok((details.match(/NOT ILIKE '%\[INTERNAL TEST\]%'/g) ?? []).length >= 5)
})

test("board text actions require consent and crew receive no money-derived score", () => {
  assert.match(OPS_DATA_SOURCE, /text_consent AS \(/)
  assert.match(OPS_DATA_SOURCE, /FILTER \(WHERE source IN \('STOP','START'\)\)\)\[1\] = 'STOP' THEN false/)
  assert.match(OPS_DATA_SOURCE, /ELSE bool_or\(effect = 'granted'\)/)
  assert.equal((OPS_DATA_SOURCE.match(/COALESCE\(tc\.text_ready, false\) AS text_ready/g) ?? []).length, 2)
  assert.match(OPS_DATA_SOURCE, /role === "owner" \? projected : \{ \.\.\.projected, board_score: 0, board_hot: false \}/)
  assert.match(PREVIEW_SOURCE, /phone && lead\.text_ready && <Link[\s\S]{0,180}>Text<\/Link>/)
  assert.match(PREVIEW_SOURCE, /phone && !lead\.text_ready && chrome\.owner && <Link[\s\S]{0,180}>Enable texting<\/Link>/)
  assert.doesNotMatch(PREVIEW_SOURCE, />Open to text<\/Link>/)
})

test("photo dates use receipts only and each event trail keeps the newest four chronologically", () => {
  const photo = OPS_DATA_SOURCE.slice(OPS_DATA_SOURCE.indexOf("async function listBoardNewestPhotoDates"), OPS_DATA_SOURCE.indexOf("export async function getBoardJobDetails"))
  assert.match(photo, /sourceAddendumEventId/)
  assert.match(photo, /sourceCompletionEventId/)
  assert.match(photo, /receipt\.kind = 'photo\.added'/)
  assert.doesNotMatch(photo, /l\.updated_at|leads\.updated_at/)

  const trails = EVENTS_SOURCE.slice(EVENTS_SOURCE.indexOf("export async function listBoardEventTrails"), EVENTS_SOURCE.indexOf("export async function listTodayEvents"))
  assert.match(trails, /PARTITION BY e\.lead_id\s+ORDER BY e\.occurred_at DESC, e\.id DESC/)
  assert.match(trails, /WHERE trail_rank <= \$\{bounded\}::bigint\s+ORDER BY lead_id ASC, occurred_at ASC, id ASC/)
  assert.match(trails, /projectEventForRole\(event, role\)/)
  assert.match(trails, /NOT ILIKE '%\[INTERNAL TEST\]%'/)
})

// C8: three links pointed at pages that no longer answer them. Nothing about
// the fix is visible at runtime until someone taps the wrong one, so the
// destinations are pinned here.
test("the board chrome and Ask Jobs sources point at destinations that still exist", () => {
  const dock = readFileSync(new URL("../app/ops/shop-dock.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
  const brief = readFileSync(new URL("../app/api/ops/brief/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")

  // The logo is home, and home is the board.
  assert.match(PREVIEW_SOURCE, /className="logo-home" href="\/board" aria-label="Job Control home"/)
  assert.doesNotMatch(PREVIEW_SOURCE, /Back to the old board/)

  // Rail entries that have a board equivalent use it. The owner decision
  // landed: Customers goes to the board's own regulars index, and Leads is
  // gone — the board is the job list, so that entry linked the page to itself.
  assert.match(PREVIEW_SOURCE, /href="\/board\?stage=waiting" aria-label="Quotes"/)
  assert.match(PREVIEW_SOURCE, /href="\/board\?signal=promise" aria-label="Promises"/)
  assert.match(PREVIEW_SOURCE, /href="\/board\/customers" aria-label="Customers"/)
  assert.doesNotMatch(PREVIEW_SOURCE, /aria-label="Leads"/)
  assert.doesNotMatch(PREVIEW_SOURCE, /view=regulars/)

  // The receipt drawer is gone. A source with a job opens the job; one
  // without a job must not render as a link at all.
  assert.doesNotMatch(dock, /\/ops\?receipt=/)
  assert.match(dock, /item\.lead_id\s*\n?\s*\? <a href=\{`\/ops\/leads\/\$\{item\.lead_id\}`\} key=\{item\.id\}>/)
  assert.match(dock, /: <span key=\{item\.id\}>/)

  // Both halves of the promise sheet fall back to the board, and the split
  // between owner text and crew text survives.
  assert.doesNotMatch(brief, /\/ops\?view=promises/)
  assert.equal((brief.match(/"\/board\?signal=promise"/g) ?? []).length, 2)
  assert.match(brief, /const ownerPromiseSheet[\s\S]{0,240}"\/board\?signal=promise"/)
  assert.match(brief, /const crewPromiseSheet[\s\S]{0,240}redactCrewText[\s\S]{0,120}"\/board\?signal=promise"/)
})
