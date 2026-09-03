import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")

const SUMMARY = read("../lib/call-summary.ts")
const MIGRATE = read("../scripts/migrate.mjs")
const TRANSCRIPT_ROUTE = read("../app/api/twilio/transcript/route.ts")
const SWEEP = read("../lib/recovery-sweep.ts")
const CALLS = read("../app/board/recent-calls.tsx")
const BOARD = read("../app/board/board.tsx")
const STORE = read("../lib/call-sketch-store.ts")

// The live sketch identified a part on 4 of 56 calls in 30 days; the transcript
// existed for all 56. The summary reads that transcript once, after the call.
test("the summary is one post-call model read, never a live poll", () => {
  assert.match(TRANSCRIPT_ROUTE, /if \(transcript\) after\(\(\) => summarizeCallDraft\(call\.twilio_sid\)/)
  assert.doesNotMatch(SUMMARY, /setInterval|call_live_transcript_items/)
  assert.match(SUMMARY, /model: AI_MODELS\.extraction/)
})

test("the gateway is read first and the shop's DeepSeek key is the fallback, both through one schema", () => {
  const AI = read("../lib/ai.ts")
  assert.match(AI, /export async function jsonWithDeepSeek/)
  assert.match(AI, /response_format: \{ type: "json_object" \}/)
  assert.match(SUMMARY, /if \(!deepseekConfigured\(\)\) throw gatewayError/)
  assert.match(SUMMARY, /const object = await jsonWithDeepSeek\(\{ system: `\$\{SYSTEM\} \$\{JSON_SHAPE\}`, prompt \}\)\s+return callSummarySchema\.parse\(object\)/)
  assert.match(SUMMARY, /WHERE summary_status = 'pending' AND updated_at < now\(\) - interval '10 minutes'/)
  assert.match(SUMMARY, /setTimeout\(resolve, 1500\)/)
})

test("intent is persisted before the model is called, and one call is read once", () => {
  const claim = SUMMARY.indexOf("SET summary_status = 'pending', summary_attempts = summary_attempts + 1")
  const model = SUMMARY.indexOf("await readCall(")
  assert.ok(claim > -1 && model > claim, "the claim UPDATE must come before the model read")
  assert.match(SUMMARY, /AND summary_status = ANY\(ARRAY\['', 'failed'\]::text\[\]\)\s+AND summary_attempts < 3\s+RETURNING id/)
  assert.match(SUMMARY, /if \(!claimed\[0\]\) return \{ summarized: false, reason: "already-claimed" \}/)
})

test("the migration is additive and idempotent", () => {
  for (const column of ["summary JSONB", "summary_status TEXT NOT NULL DEFAULT ''", "summary_attempts INT NOT NULL DEFAULT 0", "summary_at TIMESTAMPTZ", "summary_error TEXT NOT NULL DEFAULT ''"]) {
    assert.match(MIGRATE, new RegExp(`ALTER TABLE call_intake_drafts ADD COLUMN IF NOT EXISTS ${column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  }
  assert.doesNotMatch(MIGRATE, /DROP COLUMN|RENAME COLUMN/)
})

test("every interpolation in the summary SQL carries a cast", () => {
  const sqlBlocks = [...SUMMARY.matchAll(/sql`([\s\S]*?)`/g)].map((match) => match[1])
  assert.ok(sqlBlocks.length >= 4)
  for (const block of sqlBlocks) {
    for (const hole of block.matchAll(/\$\{[^}]+\}(::\w+(?:\[\])?)?/g)) {
      assert.ok(hole[1], `uncast interpolation in summary SQL: ${hole[0]}`)
    }
  }
})

test("money never reaches a stored summary, and test calls stay marked", () => {
  assert.match(SUMMARY, /const MONEY = /)
  assert.match(SUMMARY, /const summary = scrub\(await readCall\(/)
  assert.match(SUMMARY, /return callSummarySchema\.parse\(result\.output\)/)
  assert.match(SUMMARY, /Never include prices, quotes, dollar amounts/)
  assert.match(SUMMARY, /const isTest = draft\.is_test \|\| \/\\\[INTERNAL TEST\\\]\/i\.test\(draft\.transcript\)/)
  assert.match(SUMMARY, /\[INTERNAL TEST\] /)
})

test("the summary fills only what ring time left blank", () => {
  assert.match(SUMMARY, /need = CASE WHEN need = '' THEN /)
  assert.match(SUMMARY, /caller_name = CASE\s+WHEN \$\{name !== ""\}::boolean AND \(caller_name = '' OR caller_name ~\* '\^\(caller \\\\d\{4\}\|private caller\|caller\)\$'\) THEN \$\{name\}::text\s+ELSE caller_name END/)
})

test("the sweep backfills up to thirty per pass, newest first, three tries each", () => {
  assert.match(SWEEP, /detail\.callSummaries = await summarizePendingCalls\(\)/)
  assert.match(SUMMARY, /export async function summarizePendingCalls\(limit = 30\)/)
  assert.match(SUMMARY, /AND d\.summary_attempts < 3\s+AND c\.transcript_status = 'ready' AND c\.transcript <> ''\s+ORDER BY d\.created_at DESC/)
})

test("the calls dropdown and the live card read the summary", () => {
  assert.match(CALLS, /const said = summary\?\.need\.trim\(\) \|\| call\.need\.trim\(\)/)
  assert.match(CALLS, /const notJob = summary\?\.is_job === "no"/)
  assert.match(CALLS, /Probably not a job/)
  assert.match(STORE, /summary: call\.summary \?\? null,/)
  assert.match(BOARD, /const showSummary = !drawing\.hasDrawing && summary !== null/)
  assert.match(BOARD, /\{!showHeard && !showSummary && <>/)
  assert.match(BOARD, /<h2 className="t-title">Live call<\/h2>/)
})
