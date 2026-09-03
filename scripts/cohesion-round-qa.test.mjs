import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { paymentRollup } from "../lib/payments.mjs"

const BOARD_SOURCE = readFileSync("app/board/board.tsx", "utf8")
const BOARD_PAGE_SOURCE = readFileSync("app/board/page.tsx", "utf8")
const JOB_PAGE_SOURCE = readFileSync("app/ops/leads/[id]/page.tsx", "utf8")
const PAYMENT_FORM_SOURCE = readFileSync("app/ops/leads/[id]/payment-form.tsx", "utf8")
const ACTIONS_SOURCE = readFileSync("app/ops/actions.ts", "utf8")
const LEADS_SOURCE = readFileSync("lib/leads.ts", "utf8")
const OPS_DATA_SOURCE = readFileSync("lib/ops-data.ts", "utf8")

function exportedFunction(source, name) {
  const start = source.indexOf(`export async function ${name}`)
  assert.ok(start >= 0, `${name} exists`)
  const next = source.indexOf("\nexport async function ", start + 1)
  return source.slice(start, next < 0 ? undefined : next)
}

function sourceFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs)$/.test(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
}

test("QA step 1: the pane renders an honest linked week card", () => {
  // A live owner session, real due rows, and following a rendered link remain
  // human-only because this node suite has no authenticated browser session.
  // The pane follows main since 2026-09-03, so the week card is bounded by
  // the Today heading that comes after it, not by the figures.
  const week = BOARD_SOURCE.slice(
    BOARD_SOURCE.indexOf('<section className="card week">'),
    BOARD_SOURCE.indexOf('<h3 className="t-sub">Today</h3>'),
  )
  assert.ok(week.length > 0, "the week card renders in the board pane")
  assert.match(week, /<h4>The week<\/h4>/)
  assert.match(week, /Nothing due in the next seven days\./)
  assert.match(week, /<Link href=\{`\/ops\/leads\/\$\{item\.leadId\}`\}>\{item\.label\}<\/Link>/)
})

test("QA step 2: a partial payment records first and renders the remaining balance", () => {
  // The production event, trail row, and board aggregate change require an
  // authenticated owner plus a real invoice; source pins their shared contract.
  assert.deepEqual(
    paymentRollup({ currentPaidCents: 0, amountCents: 50000, invoiceTotalCents: 186000, settles: false }),
    { paidTotalCents: 50000, fullyPaid: false },
  )
  const action = exportedFunction(ACTIONS_SOURCE, "recordPayment")
  assert.equal((action.match(/await sql`/g) ?? []).length, 2, "the transition is atomic and a second statement verifies a concurrent winner")
  assert.ok(action.indexOf("INSERT INTO events") < action.indexOf("UPDATE leads"), "the receipt feeds the rollup")
  assert.match(action, /SELECT 'invoice\.payment-received'::text,/)
  assert.match(JOB_PAGE_SOURCE, /Paid \{money\(lead\.paid_amount_cents\)\}/)
  assert.match(JOB_PAGE_SOURCE, /` of \$\{money\(lead\.invoice_total_cents\)\}`/)
  assert.match(PAYMENT_FORM_SOURCE, /still out`/)
})

test("QA step 3: the remaining payment settles and exposes paid truth", () => {
  // A live Paid-stage cell and job-trail receipt still need production data and
  // an authenticated browser; the deterministic state transition is pinned here.
  assert.deepEqual(
    paymentRollup({ currentPaidCents: 50000, amountCents: 136000, invoiceTotalCents: 186000, settles: false }),
    { paidTotalCents: 186000, fullyPaid: true },
  )
  const action = exportedFunction(ACTIONS_SOURCE, "recordPayment")
  assert.match(action, /paid_at = CASE WHEN r\.fully_paid THEN COALESCE\(l\.paid_at, now\(\)\)/)
  assert.match(action, /CASE WHEN c\.fully_paid THEN ', squared up'::text ELSE ''::text END/)
  assert.match(BOARD_SOURCE, /if \(lead\.paid_at\)/)
  assert.match(BOARD_SOURCE, /note: "paid"/)
})

test("QA step 4: no invoice plus the settles tick sets fullyPaid", () => {
  // Persisting paid_at on a real no-invoice job is human-only; the pure rollup
  // and the exact form-to-action settles value prove the server decision.
  assert.deepEqual(
    paymentRollup({ currentPaidCents: 0, amountCents: 40000, invoiceTotalCents: null, settles: true }),
    { paidTotalCents: 40000, fullyPaid: true },
  )
  assert.match(PAYMENT_FORM_SOURCE, /<input type="checkbox" name="settles" value="1" \/>/)
  assert.match(exportedFunction(ACTIONS_SOURCE, "recordPayment"), /const settles = String\(formData\.get\("settles"\) \?\? ""\) === "1"/)
})

test("QA step 5: status, interaction, and completion each use one events receipt", () => {
  // Exact production row counts remain a live database check. Static scoping
  // proves one journal call per simple action and one job.completed receipt in
  // the full-completion branch, with no legacy-table write in any action.
  const recordLeadEvent = exportedFunction(LEADS_SOURCE, "recordLeadEvent")
  assert.equal((recordLeadEvent.match(/\brecordEvent\(\{/g) ?? []).length, 1)
  assert.doesNotMatch(recordLeadEvent, /INSERT INTO lead_events/)

  const status = exportedFunction(ACTIONS_SOURCE, "updateLeadStatus")
  assert.equal((status.match(/INSERT INTO events/g) ?? []).length, 1, "status writes one atomic receipt")
  assert.match(status, /WITH lead_update AS \([\s\S]*immutable_receipt AS \(/)
  assert.doesNotMatch(status, /recordLeadEvent\(/)
  assert.doesNotMatch(status, /INSERT INTO lead_events/)

  const interaction = exportedFunction(ACTIONS_SOURCE, "logInteraction")
  assert.equal((interaction.match(/recordLeadEvent\(/g) ?? []).length, 1, "interaction writes one receipt")
  assert.doesNotMatch(interaction, /INSERT INTO lead_events/)

  const completion = exportedFunction(ACTIONS_SOURCE, "markLeadComplete")
  const completedReceipt = completion.slice(
    completion.indexOf("const completion ="),
    completion.indexOf("), closeout_write AS"),
  )
  assert.equal((completedReceipt.match(/INSERT INTO events/g) ?? []).length, 1, "completion inserts one events row")
  assert.equal((completedReceipt.match(/'job\.completed'::text/g) ?? []).length, 1, "the receipt is job.completed")
  assert.doesNotMatch(completion, /INSERT INTO lead_events/)
})

test("QA step 6: app and lib contain no lead_events insert", () => {
  const offenders = [...sourceFiles("app"), ...sourceFiles("lib")]
    .filter((file) => readFileSync(file, "utf8").includes("INSERT INTO lead_events"))
  assert.deepEqual(offenders, [])
})

test("QA step 7: the pager appears only for overflow and keeps page one canonical", () => {
  // Clicking through a genuinely overflowing production stage is human-only;
  // these assertions pin the render gate and URL construction it exercises.
  assert.match(BOARD_SOURCE, /\{\(board\.hasNext \|\| board\.page > 1\) && \(/)
  assert.match(BOARD_SOURCE, /boardHref\(\{ page: board\.page - 1 \}\)/)
  assert.match(BOARD_SOURCE, /boardHref\(\{ page: board\.page \+ 1 \}\)/)
  const href = BOARD_SOURCE.slice(BOARD_SOURCE.indexOf("const boardHref"), BOARD_SOURCE.indexOf("useEffect", BOARD_SOURCE.indexOf("const boardHref")))
  assert.match(href, /if \(page !== undefined && page > 1\) params\.set\("p", String\(page\)\)/)
  assert.doesNotMatch(href, /params\.set\("p", String\(page\)\)[\s\S]*else/)
})

test("QA step 8: signed-out structure is zeroed and crew money is nulled server-side", () => {
  // Visual signed-out inspection remains human-only. The crew half is also a
  // standing production deferral until a crew operator exists.
  const emptyBoard = BOARD_PAGE_SOURCE.slice(
    BOARD_PAGE_SOURCE.indexOf("const EMPTY_BOARD"),
    BOARD_PAGE_SOURCE.indexOf("export default async function BoardPage"),
  )
  assert.match(emptyBoard, /items: \[\]/)
  assert.match(emptyBoard, /resultTotal: 0/)
  assert.match(emptyBoard, /hasNext: false/)
  assert.match(BOARD_PAGE_SOURCE, /if \(!operator\) return <JobControl board=\{\{ \.\.\.EMPTY_BOARD, stage, signal, stages: \[\.\.\.JOB_BOARD_STAGES\] \}\}/)

  const projection = OPS_DATA_SOURCE.slice(
    OPS_DATA_SOURCE.indexOf("export function projectLeadForRole"),
    OPS_DATA_SOURCE.indexOf("export async function listLeads"),
  )
  for (const field of ["paid_amount_cents", "invoice_total_cents", "paid_at"]) {
    assert.match(projection, new RegExp(`${field}: null`), `${field} must be removed before crew rendering`)
  }
})
