import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { BOARD_WEIGHTS, BOARD_SIGNAL_LABELS } from "../lib/shop-brain-invariants.mjs"
import { signalCountsFromCandidates } from "../lib/ops-data-testkit.mjs"

const OPS_DATA_SOURCE = readFileSync(new URL("../lib/ops-data.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const COMMITMENTS_SOURCE = readFileSync(new URL("../lib/commitments.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const EVENTS_SOURCE = readFileSync(new URL("../lib/events.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const PAGE_SOURCE = readFileSync(new URL("../app/design-preview/job-control/page.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const PREVIEW_SOURCE = readFileSync(new URL("../app/design-preview/job-control/job-control-preview.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")

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
  // Kept and broken are this month; open is every open promise right now.
  assert.match(COMMITMENTS_SOURCE, /WHERE c\.status = 'kept'\s+AND c\.status_changed_at >= \(date_trunc\('month', now\(\) AT TIME ZONE 'America\/Chicago'\)/)
  assert.match(COMMITMENTS_SOURCE, /WHERE c\.status = 'broken'\s+AND c\.status_changed_at >= \(date_trunc\('month', now\(\) AT TIME ZONE 'America\/Chicago'\)/)
  assert.match(COMMITMENTS_SOURCE, /count\(\*\) FILTER \(WHERE c\.status = 'open'\)::int AS open/)
})

test("canceled and superseded promises are counted nowhere", () => {
  const summary = COMMITMENTS_SOURCE.slice(COMMITMENTS_SOURCE.indexOf("export async function getPromiseSummary"))
  const body = summary.slice(0, summary.indexOf("export async function setCommitmentStatus"))
  assert.ok(!body.includes("'canceled'"), "a canceled promise is not a broken one")
  assert.ok(!body.includes("'superseded'"), "superseded is the correction mechanism; counting it double-counts")
})

test("a test lead or a test person keeps a promise off the board", () => {
  // commitments carries no is_test of its own; both possible owners are checked.
  const matches = COMMITMENTS_SOURCE.match(/\(l\.id IS NULL OR l\.is_test = false\)\s+AND \(p\.id IS NULL OR p\.is_test = false\)/g)
  assert.equal(matches?.length, 2, "both promise queries must filter test data")
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
  assert.match(today, /lower\(COALESCE\(e\.detail->>'isTest', 'false'\)\) <> 'true'/)
  assert.match(today, /projectEventForRole\(event, role\)/)
})

test("the Today trail uses shop labels verbatim and has no signed-out fixtures", () => {
  assert.match(PREVIEW_SOURCE, /shopEventLabel\(event\.kind\)/)
  assert.match(PREVIEW_SOURCE, /timeZone: "America\/Chicago"/)
  assert.match(PAGE_SOURCE, /todayTrail: \[\]/)
  assert.doesNotMatch(PREVIEW_SOURCE, /Price worked out for Phil Lloyd|Ray Colter called|Denz automotive asked|Gerald Pace plate finished/)
})
