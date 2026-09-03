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
  // Parse loosely, store tightly: lengths are cut in scrub, never refused.
  const SHARED = read("../lib/call-summary-shared.ts")
  assert.match(SHARED, /need: z\.string\(\)\.max\(2000\)\.nullable\(\)\.transform\(\(value\) => value \?\? ""\)/)
  assert.match(SHARED, /details: z\.array\(z\.string\(\)\.max\(400\)\)\.max\(12\)\.catch\(\[\]\)/)
  // The browser half never imports the server half: that pull of web-push
  // into the client bundle is what broke two production builds on 2026-09-03.
  assert.doesNotMatch(SHARED, /@\/lib\/(db|ai|notify|job-intake|people)/)
  assert.match(BOARD, /import \{ outcomeLine \} from "@\/lib\/call-summary-shared"/)
  assert.match(SUMMARY, /need: noMoney\(summary\.need\)\.slice\(0, 200\)/)
  assert.match(SUMMARY, /noMoney\(item\)\.slice\(0, 80\)\)\.filter\(Boolean\)\.slice\(0, 5\)/)
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
  assert.match(BOARD, /<h2 className="t-title">\{onTheLine \? "On the phone" : "Last call"\}<\/h2>/)
  // the sketch tile only earns its third of the card when something is drawn
  assert.match(BOARD, /const showTile = drawing\.hasDrawing \|\| !showSummary/)
  assert.match(BOARD, /\{showTile && <div>\s+<figure className="tile">/)
  // an ended call folds the whole transcript behind one line
  assert.match(BOARD, /<summary>Read the whole call · \{sketch\.totalLines\} line/)
})

// The owner answers on his own phone and opens the app afterwards. The read
// does the tap for him when the call asked for shop work.
test("a call that asked for shop work becomes a job with no tap, attributed to the system", () => {
  const INTAKE = read("../lib/job-intake.ts")
  const settle = SUMMARY.slice(SUMMARY.indexOf("async function settleCall"), SUMMARY.indexOf("export async function summarizePendingCalls"))
  assert.match(settle, /if \(!OPEN_DRAFT\.includes\(draft\.status\)\) \{\s+outcome = "already"/)
  assert.match(settle, /else if \(summary\.is_job === "yes"\)/)
  assert.match(settle, /operatorId: null,\s+automatic: true,/)
  // the summary is stored before settle runs, so a failed save never loses the read
  assert.ok(SUMMARY.indexOf("summary_status = 'ready'") < SUMMARY.indexOf("await settleCall(draft, summary, name, isTest)"))
  assert.match(settle, /outcome = "failed"/)
  // attribution: no operator saved it, so no operator is named
  assert.match(INTAKE, /operatorId: number \| null/)
  assert.match(INTAKE, /actor: input\.operatorId == null \? "system" : String\(input\.operatorId\)/)
  assert.equal((INTAKE.match(/actorType: input\.operatorId == null \? "system" : "operator",/g) ?? []).length, 2)
})

test("a repeat caller with an open job is filed onto it, never duplicated", () => {
  const INTAKE = read("../lib/job-intake.ts")
  const settle = SUMMARY.slice(SUMMARY.indexOf("async function settleCall"), SUMMARY.indexOf("export async function summarizePendingCalls"))
  assert.match(settle, /await findOpenLeadResolutionForPerson\(draft\.person_id, draft\.is_test\)/)
  assert.match(settle, /if \(open\?\.leadId && !open\.needsJobMatch\)[\s\S]{0,200}fileCallOntoOpenLead\(\{ publicId: draft\.public_id, leadId: open\.leadId \}\)/)
  assert.match(INTAKE, /export async function fileCallOntoOpenLead/)
  assert.match(INTAKE, /externalId: `\$\{draft\.call_sid\}:intake-filed`/)
  assert.match(INTAKE, /'\{"intakeOutcome":"filed"\}'::jsonb/)
})

test("calls read before auto-save existed are settled quietly by the sweep, once", () => {
  const sweep = SUMMARY.slice(SUMMARY.indexOf("export async function summarizePendingCalls"))
  assert.match(sweep, /AND d\.summary_status = 'ready' AND d\.summary IS NOT NULL\s+AND \(d\.summary->>'auto'\) IS NULL/)
  assert.match(sweep, /await settleCall\(row, row\.summary, row\.summary\.caller_name\?\.trim\(\) \?\? "", row\.is_test, true\)/)
  assert.match(SUMMARY, /if \(quiet \|\| isTest \|\| summary\.is_job === "no" \|\| outcome === "already"\) return/)
})

test("one push per read tells the owner what the call was and what happened", () => {
  const settle = SUMMARY.slice(SUMMARY.indexOf("async function settleCall"), SUMMARY.indexOf("export async function summarizePendingCalls"))
  // tests never alert; wrong numbers wait quietly; a call already handled says nothing
  assert.match(settle, /if \(quiet \|\| isTest \|\| summary\.is_job === "no" \|\| outcome === "already"\) return/)
  assert.match(settle, /priority: "interrupt",/)
  assert.match(settle, /ownerOnly: true,\s+smsFallback: false,\s+dedupeKey: `call-read:\$\{draft\.call_sid\}`,/)
  assert.match(settle, /url: leadId != null \? `\/ops\/leads\/\$\{leadId\}` : "\/board",/)
})

// Zero of 61 jobs in 60 days carried a price while 14 prices were heard on
// calls. The quote-capture slip sat in a digest; now it rides on the row.
test("a price heard on the call shows on the board row for the owner to confirm, never for crew", () => {
  const OPS = read("../lib/ops-data.ts")
  assert.match(OPS, /heard_quote_cents: number \| null/)
  assert.match(OPS, /WHERE n\.action_kind = 'quote-capture' AND n\.read_at IS NULL\s+AND \(n\.action_detail->>'leadId'\)::bigint = p\.id/)
  assert.match(OPS, /: \{ \.\.\.projected, board_score: 0, board_hot: false, heard_quote_cents: null \}/, "crew money is removed server-side")
  assert.match(BOARD, /if \(lead\.heard_quote_cents !== null && lead\.heard_quote_cents > 0\)/)
  assert.match(BOARD, /confirmHref: `\/ops\/leads\/\$\{lead\.id\}#quote-capture`/)
  // the row order stays honest: a confirmed estimate beats a heard one
  assert.ok(BOARD.indexOf('note: "estimated"') < BOARD.indexOf('note: "confirm", confirmHref'))
})

test("a call the read called not a job clears itself after a week, restorable and journaled", () => {
  const sweep = SUMMARY.slice(SUMMARY.indexOf("export async function summarizePendingCalls"))
  assert.match(sweep, /SET status = 'dismissed', dismissed_at = COALESCE\(dismissed_at, now\(\)\)[\s\S]{0,200}AND summary->>'is_job' = 'no'\s+AND created_at < now\(\) - interval '7 days'/)
  assert.match(sweep, /kind: "call\.intake\.dismissed",\s+actorType: "system",/)
  assert.match(sweep, /'\{"intakeOutcome":"dismissed"\}'::jsonb/)
})
