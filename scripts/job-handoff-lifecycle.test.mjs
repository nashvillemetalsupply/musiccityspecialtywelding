import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("finished jobs leave Active Jobs only through the additive handoff state", () => {
  const migration = source("scripts/migrate.mjs")
  const leads = source("lib/leads.ts")
  const board = source("lib/ops-data.ts")
  const accounts = source("lib/accounts.ts")

  assert.match(migration, /ALTER TABLE leads ADD COLUMN IF NOT EXISTS handed_off_at TIMESTAMPTZ/)
  assert.doesNotMatch(migration, /UPDATE leads SET handed_off_at/)
  assert.match(leads, /handed_off_at: string \| null/)
  assert.match(
    board,
    /l\.completed_at IS NULL\s+OR \(l\.completed_at IS NOT NULL AND l\.handed_off_at IS NULL\)/,
  )
  assert.doesNotMatch(board.slice(board.indexOf("export async function listBoardJobs"), board.indexOf("export async function getLead")), /completed_at\s*[+<>]|interval\s+'\d+\s+(?:hour|day)/i)
  assert.doesNotMatch(accounts, /handed_off_at\s+IS\s+NULL/)
})

test("handoff and undo are authenticated, idempotent, locked, and atomically receipted", () => {
  const actions = source("app/ops/leads/[id]/handoff-actions.ts")
  const completion = source("app/ops/actions.ts")

  assert.match(actions, /^"use server"/)
  assert.equal((actions.match(/getAuthenticatedOperator\(\)/g) ?? []).length, 2)
  assert.match(actions, /completed_at IS NOT NULL\s+AND handed_off_at IS NULL\s+AND \(\$\{includeTests\}::boolean OR is_test = false\)\s+FOR UPDATE/)
  assert.match(actions, /'handoff_completed'::text/)
  assert.match(actions, /'job\.handed-off'::text/)
  assert.match(actions, /handed_off_at = receipt\.occurred_at/)
  assert.match(actions, /FROM target t CROSS JOIN immutable_receipt receipt/)
  assert.match(actions, /Response-loss or double-tap recovery/)
  assert.match(actions, /lead\.actor_id === String\(operator\.id\)/)
  assert.match(actions, /actionEventId: Number\(rows\[0\]\.event_id\)/)
  assert.match(actions, /SELECT id, person_id, is_test/)
  assert.match(actions, /SELECT l\.id, l\.person_id, l\.is_test, receipt\.id AS handoff_event_id/)
  assert.equal((actions.match(/CASE WHEN t\.is_test THEN '\[INTERNAL TEST\] '/g) ?? []).length, 4)
  assert.equal((actions.match(/'isTest', t\.is_test/g) ?? []).length, 2)

  assert.match(actions, /receipt\.actor_id = \$\{String\(operator\.id\)\}::text/)
  assert.match(actions, /receipt\.occurred_at >= now\(\) - interval '10 seconds'/)
  assert.match(actions, /l\.handed_off_at = receipt\.occurred_at/)
  assert.match(actions, /FOR UPDATE OF l/)
  assert.match(actions, /'handoff_undone'::text/)
  assert.match(actions, /'job\.handoff-undone'::text/)
  assert.match(actions, /UPDATE leads l SET handed_off_at = NULL/)
  assert.match(actions, /Reopen is only available to the operator who closed this job, for 10 seconds/)

  assert.ok((completion.match(/handed_off_at = NULL/g) ?? []).length >= 2, "finish and finish-undo must reset handoff state")
})

test("work order explains removal, preserves history, and exposes a thumb-safe receipt undo", () => {
  const page = source("app/ops/leads/[id]/page.tsx")
  const control = source("app/ops/leads/[id]/handoff-control.tsx")
  const language = source("lib/shop-language.ts")
  // C7 retired jobs-brand.css; the handoff touch rule lives in the page's job.css.
  const css = source("app/ops/leads/[id]/job.css")

  assert.match(page, /<HandoffControl/)
  assert.ok(page.indexOf("<DoneStamp") < page.indexOf("<HandoffControl"))
  assert.ok(page.indexOf("<HandoffControl") < page.indexOf('aria-label="Recent activity"'))
  assert.match(page, /lead\.handed_off_at\s+\? "Closed"/)
  assert.match(page, /id="finish-close"/)
  assert.match(control, /isHandedOff \? "Job closed" : "Close job"/)
  assert.match(control, /Use after pickup or delivery/)
  assert.match(control, /work order and customer history stay/)
  assert.match(control, /Removed from Active Jobs\. Work order and customer history kept/)
  assert.match(control, /Reopen job \(10 sec\)/)
  assert.match(control, /aria-live="polite"/)
  assert.match(control, /role="alert"/)
  assert.match(control, /SafeSubmitButton/)
  assert.match(control, /handoffDisplayState/)
  assert.match(control, /expiredHandoffEventId !== handoffEventId/)
  assert.match(control, /isHandedOff && handoffState\.status === "handed-off"/)
  assert.match(css, /\.job-finish-close > :is\(\.ops-done-bench, \.ops-handoff-control\) :is\(button, summary\) \{ min-height: 44px/)
  assert.match(language, /"job\.handed-off": "Job closed"/)
  assert.match(language, /"job\.handoff-undone": "Job reopened"/)
})

test("the board sends a Ready job to the canonical close control", () => {
  const board = source("app/board/board.tsx")
  const css = source("app/board/board.css")

  assert.doesNotMatch(board, /markJobHandedOff|HandoffButton|HANDOFF_IDLE/)
  assert.match(board, /href=\{`\/ops\/leads\/\$\{lead\.id\}#finish-close`\}>Close job<\/Link>/)
  // Close belongs in the opened panel, never in the row. The row's actions
  // cell is a fixed track sharing a line with the reason chip.
  const cellStart = board.indexOf('<span className="doing c-do">')
  const rowCell = board.slice(cellStart, board.indexOf("</span>", cellStart))
  assert.ok(!rowCell.includes("Close job"), "close must not sit in the row")
  assert.ok(board.indexOf("#finish-close") > board.indexOf("job-detail-"), "close must render inside the opened detail panel")
  // The row tracks stay as the locked layout had them, with the three fixed
  // trailing tracks relaxed to minmax(<the old fixed width>, max-content) by
  // Task 5b of the 2026-09-04 final-polish plan. The 14px floor makes a line
  // box 3-4px taller than the 11.5-13.5px one these widths were measured
  // against, so a fixed 100px timestamp track clipped. The floor is the
  // owner's number; the track width was not. Minima are unchanged, so the
  // layout at rest is identical -- the tracks can only grow now.
  assert.ok(css.includes("56px minmax(0,1.6fr) minmax(100px,max-content) minmax(168px,max-content) minmax(116px,max-content)"))
  assert.ok(css.includes("56px minmax(220px,1.8fr) minmax(108px,max-content) minmax(120px,max-content) minmax(180px,max-content) minmax(116px,max-content)"))
  // The row toggles the panel on click and exempts actions inside links/buttons.
  assert.match(board, /closest\("a, button"\)/)
  assert.match(css, /\.why-end/)
})

test("Closed is its own tab and can never reach the Open jobs figure", () => {
  const data = source("lib/ops-data.ts")
  const board = source("app/board/board.tsx")

  // Data order: working stages, then the two look-back views, the whole
  // board last. The rendered tab order is TAB_ORDER in board.tsx (Open jobs
  // first, owner's call 2026-09-03); the data contract does not move.
  assert.match(
    data,
    /JOB_BOARD_STAGES = \["attention", "shop", "waiting", "ready", "closed", "board"\] as const/,
  )
  assert.match(board, /board: "Open jobs"/)
  assert.ok(
    board.indexOf('"board", "attention"') < board.indexOf('"closed"]'),
    "Open jobs is the first tab and Closed the last",
  )

  // The whole point of the separate CTE: board_counts, which feeds "Open jobs",
  // still reads only the open-work CTE. Widening that one would put finished
  // work back into the headline number.
  const countsCte = data.slice(
    data.indexOf("), board_counts AS ("),
    data.indexOf("), closed_jobs AS ("),
  )
  assert.ok(countsCte.includes("count(*)::int AS board_count"))
  assert.ok(
    countsCte.trimEnd().endsWith("FROM board"),
    "board_counts must read the open-work CTE, not the union",
  )
  assert.ok(
    !countsCte.includes("SELECT * FROM board"),
    "board_counts must not be computed over the board/closed union",
  )

  // Closed reads handed-off jobs only, and only when that tab is open.
  assert.match(data, /\), closed_jobs AS \(/)
  assert.match(data, /WHERE \$\{stage\}::text = 'closed'\s*\n\s*AND l\.handed_off_at IS NOT NULL/)
  assert.match(data, /SELECT \* FROM board WHERE \$\{stage\}::text <> 'closed'\s*\n\s*UNION ALL\s*\n\s*SELECT \* FROM closed_jobs/)

  // Its count is computed apart from board_counts, and honours the test flag
  // like every other lane.
  assert.match(data, /\), closed_count AS \([\s\S]*?count\(\*\)::int AS closed_count/)
  assert.match(data, /closed_count AS \([\s\S]*?\$\{includeTests\}::boolean OR l\.is_test = false/)
  assert.match(data, /closed: Number\(countRow\?\.closed_count \?\? 0\)/)

  // Every interpolation in the new SQL carries its Postgres cast (42P18).
  const closedSql = data.slice(data.indexOf("), closed_jobs AS ("), data.indexOf("), filtered AS ("))
  for (const hole of closedSql.match(/\$\{[^}]+\}(::\w+)?/g) ?? []) {
    assert.match(hole, /::(text|boolean)$/, `uncast interpolation in closed_jobs: ${hole}`)
  }
})
