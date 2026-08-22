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
  assert.match(actions, /completed_at IS NOT NULL\s+AND handed_off_at IS NULL\s+FOR UPDATE/)
  assert.match(actions, /'handoff_completed'::text/)
  assert.match(actions, /'job\.handed-off'::text/)
  assert.match(actions, /handed_off_at = receipt\.occurred_at/)
  assert.match(actions, /FROM target t CROSS JOIN immutable_receipt receipt/)
  assert.match(actions, /Response-loss or double-tap recovery/)
  assert.match(actions, /lead\.actor_id === String\(operator\.id\)/)
  assert.match(actions, /actionEventId: Number\(rows\[0\]\.event_id\)/)

  assert.match(actions, /receipt\.actor_id = \$\{String\(operator\.id\)\}::text/)
  assert.match(actions, /receipt\.occurred_at >= now\(\) - interval '10 seconds'/)
  assert.match(actions, /l\.handed_off_at = receipt\.occurred_at/)
  assert.match(actions, /FOR UPDATE OF l/)
  assert.match(actions, /'handoff_undone'::text/)
  assert.match(actions, /'job\.handoff-undone'::text/)
  assert.match(actions, /UPDATE leads l SET handed_off_at = NULL/)
  assert.match(actions, /Undo is only available to the operator who recorded this handoff, for 10 seconds/)

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
  assert.match(page, /lead\.handed_off_at\s+\? "Handed Off"/)
  assert.match(control, /Customer received it/)
  assert.match(control, /Nothing is deleted/)
  assert.match(control, /Work order and customer history kept/)
  assert.match(control, /Undo handoff \(10 sec\)/)
  assert.match(control, /aria-live="polite"/)
  assert.match(control, /role="alert"/)
  assert.match(control, /SafeSubmitButton/)
  assert.match(control, /handoffDisplayState/)
  assert.match(control, /expiredHandoffEventId !== handoffEventId/)
  assert.match(control, /isHandedOff && handoffState\.status === "handed-off"/)
  assert.match(css, /\.ops-done-bench, \.ops-handoff-control\) :is\(button, summary\) \{ min-height: 44px/)
  assert.match(language, /"job\.handed-off": "Customer handoff complete"/)
  assert.match(language, /"job\.handoff-undone": "Customer handoff undone"/)
})

test("the board clears a Ready job without leaving the board", () => {
  // Handoff was reachable only from the work order, so Ready accumulated jobs
  // the shop had already finished and "Open jobs" counted every one of them.
  const board = source("app/board/board.tsx")
  const css = source("app/board/board.css")

  assert.match(board, /import \{ markJobHandedOff \} from "@\/app\/ops\/leads\/\[id\]\/handoff-actions"/)
  assert.match(board, /useActionState\(markJobHandedOff, HANDOFF_IDLE\)/)
  // Handoff belongs in the opened panel, never in the row. The row's actions
  // cell is a fixed track sharing a line with the reason chip, and a third
  // control there painted straight over it. Both directions are pinned.
  const cellStart = board.indexOf('<span className="doing c-do">')
  const rowCell = board.slice(cellStart, board.indexOf("</span>", cellStart))
  assert.ok(!rowCell.includes("HandoffButton"), "handoff must not sit in the row")
  assert.ok(
    board.indexOf("<HandoffButton") > board.indexOf("job-detail-"),
    "handoff must render inside the opened detail panel",
  )
  assert.match(board, /Customer received it/)
  assert.match(board, /aria-label=\{`Record that \$\{customer\} received their job`\}/)
  // The row tracks stay exactly as the locked layout had them.
  assert.ok(css.includes("56px minmax(0,1.6fr) 100px 168px 116px"))
  assert.ok(css.includes("56px minmax(220px,1.8fr) 108px 120px 180px 116px"))
  // The row toggles the panel on click and exempts anything inside a button;
  // SafeSubmitButton renders one, so the submit must not also expand the row.
  assert.match(board, /SafeSubmitButton/)
  assert.match(board, /closest\("a, button"\)/)
  // The removed row has to disappear, and only a refetch does that.
  assert.match(board, /if \(state\.status === "handed-off"\) router\.refresh\(\)/)
  assert.match(board, /state\.status === "error" && <span className="t-caption" role="alert">/)
  assert.match(css, /\.why-end \.end form\{display:contents\}/)
})

test("Closed is its own tab and can never reach the Open jobs figure", () => {
  const data = source("lib/ops-data.ts")
  const board = source("app/board/board.tsx")

  // Tab order: working stages, then the two look-back views, All jobs last.
  assert.match(
    data,
    /JOB_BOARD_STAGES = \["attention", "shop", "waiting", "ready", "closed", "board"\] as const/,
  )
  assert.ok(
    board.indexOf('closed: "Closed"') < board.indexOf('board: "All jobs"'),
    "the Closed tab must sit before All jobs",
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
