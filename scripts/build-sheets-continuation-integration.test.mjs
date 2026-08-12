import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("continuation persistence is additive, test-partitioned, and receipt-driven", async () => {
  const migration = await read("scripts/migrate.mjs")
  for (const table of ["build_customer_responses", "build_paperwork_issues", "job_closeouts", "job_closeout_updates"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  }
  assert.match(migration, /UNIQUE \(lead_id, response_key\)/)
  assert.match(migration, /UNIQUE \(paperwork_id, issue_key\)/)
  assert.doesNotMatch(migration, /(?:DROP|TRUNCATE)\s+(?:TABLE\s+)?build_sheets/i)
})

test("customer corrections create a proposed fact and never mutate a locked sheet", async () => {
  const [store, route, page] = await Promise.all([
    read("lib/build-sheets.ts"),
    read("app/j/[token]/build/route.ts"),
    read("app/j/[token]/page.tsx"),
  ])
  assert.match(route, /sameOrigin\(req\)/)
  assert.match(route, /getGlassJob\(token\)/)
  assert.match(route, /job\.is_test/)
  assert.match(store, /export async function respondToCustomerBuildFact/)
  assert.match(store, /'customer'::text, 'customer-correction'::text/)
  assert.match(store, /INSERT INTO claims/)
  assert.match(store, /INSERT INTO build_fact_decisions/)
  assert.match(store, /keyed\.response_state <> 'accepted'/)
  assert.match(store, /keyed\.response_state <> 'corrected'/)
  assert.match(store, /claim\.id = stored\.claim_id/)
  const correctionStore = store.slice(
    store.indexOf("const value = customerCorrectionValue"),
    store.indexOf("export async function issueBuildPaperwork"),
  )
  assert.match(correctionStore, /decision_receipt AS/)
  assert.match(correctionStore, /conflict_receipt AS/)
  assert.match(correctionStore, /JOIN decision_receipt/)
  assert.match(correctionStore, /JOIN conflict_receipt/)
  assert.doesNotMatch(correctionStore, /corrected:\$\{hashItem\(JSON\.stringify\(value\)\)\}:\$\{responseKey\}/)
  assert.doesNotMatch(store.slice(store.indexOf("export async function respondToCustomerBuildFact")), /UPDATE build_sheets/)
  assert.match(page, /What We Understand/)
  assert.match(page, /CustomerBuildDrawing/)
})

test("paperwork issue path recomputes staleness before filing an issue receipt", async () => {
  const [store, route, page] = await Promise.all([
    read("lib/build-sheets.ts"),
    read("app/api/ops/build-paperwork/[id]/route.ts"),
    read("app/ops/leads/[id]/builds/page.tsx"),
  ])
  assert.match(store, /export async function issueBuildPaperwork/)
  assert.match(store, /paperworkIssueDecision/)
  assert.match(store, /INSERT INTO build_paperwork_issues/)
  assert.match(route, /sameOrigin\(req\)/)
  assert.match(route, /issueBuildPaperwork/)
  assert.match(route, /status: 409/)
  assert.match(page, /item\.sourceBuildSheetNumber === latestSheet\?\.number && drawing && <form/)
})

test("closeout filing stores reviewed outcomes without payment coupling", async () => {
  const [actions, component] = await Promise.all([
    read("app/ops/actions.ts"),
    read("app/ops/leads/[id]/done-stamp.tsx"),
  ])
  const completion = actions.slice(actions.indexOf("export async function markLeadComplete"), actions.indexOf("export async function addLeadCompletionNote"))
  assert.match(completion, /validateCloseoutReview/)
  assert.match(completion, /INSERT INTO job_closeouts/)
  assert.match(completion, /INSERT INTO job_closeout_updates/)
  assert.match(completion, /job\.closeout-update/)
  assert.match(completion, /Partial work update filed\. Job remains open\./)
  assert.match(completion, /detail->'closeout' IS DISTINCT FROM/)
  assert.match(completion, /recoveredVoiceIntentId: voiceIntentId/)
  assert.doesNotMatch(completion, /UPDATE events SET detail[\s\S]{0,240}recoveredVoiceIntentId: voiceIntentId/)
  assert.doesNotMatch(completion, /paid_at|invoice|payment/i)
  assert.match(component, /Review closeout/)
  assert.match(component, /One-breath closeout/)
})
