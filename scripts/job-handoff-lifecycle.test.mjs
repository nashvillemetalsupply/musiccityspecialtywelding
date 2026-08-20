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
