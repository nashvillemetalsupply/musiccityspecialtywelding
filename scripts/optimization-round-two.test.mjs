import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const source = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n")

test("finished work cannot drift through the generic status editor", () => {
  const actions = source("app/ops/actions.ts")
  const start = actions.indexOf("export async function updateLeadStatus")
  const end = actions.indexOf("export async function markFirstResponse", start)
  const status = actions.slice(start, end)
  assert.match(status, /WITH lead_update AS \([\s\S]*INSERT INTO events/)
  assert.match(status, /completed_at IS NULL AND handed_off_at IS NULL/)
  assert.match(status, /THEN COALESCE\(lost_at, now\(\)\) ELSE NULL END/)
  assert.match(status, /Finished jobs are locked\. Use Undo finish/)
  const page = source("app/ops/leads/[id]/page.tsx")
  assert.match(page, /!lead\.completed_at && !lead\.handed_off_at \? <form action=\{updateLeadStatus\}/)
})

test("concurrent manual payments verify the winning receipt and expose retryable UI", () => {
  const actions = source("app/ops/actions.ts")
  const payment = source("app/ops/leads/[id]/payment-form.tsx")
  assert.match(actions, /SELECT lead_id FROM events[\s\S]*external_id = \$\{externalId\}::text/)
  assert.match(actions, /Number\(winner\[0\]\?\.lead_id\) !== leadId/)
  assert.match(payment, /useActionState\(recordPaymentState, INITIAL_STATE\)/)
  assert.match(payment, /role=\{state\.status === "error" \? "alert" : "status"\}/)
})

test("finish failures reset the swipe and remain actionable", () => {
  const stamp = source("app/ops/leads/[id]/done-stamp.tsx")
  assert.match(stamp, /useActionState\(markLeadCompleteState, INITIAL_FINISH_STATE\)/)
  assert.match(stamp, /if \(finishState\.status !== "error"\) return[\s\S]*submittedRef\.current = false/)
  assert.match(stamp, /const timer = window\.setTimeout\(\(\) => \{/)
  assert.match(stamp, /setSubmitting\(false\)/)
  assert.match(stamp, /role=\{finishState\.status === "error" \? "alert" : "status"\}/)
})

test("repeat-customer calls and texts never guess between active jobs", () => {
  const people = source("lib/people.ts")
  const ingest = source("lib/ingest.ts")
  const calls = source("lib/job-intake.ts")
  const actions = source("app/ops/actions.ts")
  const page = source("app/ops/leads/[id]/page.tsx")
  assert.match(people, /routed_to_lead_id IS NULL/)
  assert.match(people, /const matchingInbox = rows\.find/)
  assert.match(people, /ambiguous: rows\.length > 1/)
  assert.match(ingest, /service: openLead\.ambiguous \? "Needs job match"/)
  assert.match(ingest, /not attached to the wrong work order/)
  assert.match(ingest, /JOIN leads lead ON lead\.id = claim\.lead_id/)
  assert.match(actions, /export async function routeConversationToJob/)
  assert.match(actions, /UPDATE inbound_conversation_claims claim/)
  assert.match(page, /File messages to job/)
  assert.match(calls, /findOpenLeadResolutionForPerson/)
  assert.match(calls, /openLead\.leadId && !openLead\.needsJobMatch/)
  assert.doesNotMatch(calls, /findRecentOpenLeadForPerson/)
})

test("filing a holding conversation moves every mutable projection and late extraction follows it", () => {
  const actions = source("app/ops/actions.ts")
  const extract = source("lib/extract.ts")
  const routing = source("lib/routing.ts")
  assert.match(actions, /duplicate_commitments AS \(/)
  assert.match(actions, /moved_commitments AS \([\s\S]*UPDATE commitments[\s\S]*lead_id = routed\.target_id/)
  assert.match(actions, /moved_claims AS \([\s\S]*UPDATE claims[\s\S]*subject_id = routed\.target_id/)
  assert.match(routing, /SELECT COALESCE\(routed_to_lead_id, id\) AS projection_lead_id/)
  assert.ok((extract.match(/resolveProjectionLeadId\(event\.lead_id\)/g) ?? []).length >= 3)
  assert.match(extract, /reconcileRoutedLeadProjections\(event\.lead_id, finalProjectionLeadId\)/)
  const lowConfidenceDeparture = extract.slice(
    extract.indexOf('if \(object.contact_churn.confidence < 0.85\)'.replaceAll("\\", "")),
    extract.indexOf("const churnEventId"),
  )
  assert.match(lowConfidenceDeparture, /reconcileFinalProjection\(\)[\s\S]*markEventProcessed\(event\.id\)[\s\S]*return/)
  assert.ok((extract.match(/await reconcileFinalProjection\(\)/g) ?? []).length >= 2)
  assert.match(actions, /reconcileRoutedLeadProjections\(sourceLeadId, targetLeadId\)/)
  assert.match(extract, /leadId: projectionLeadId/)
  assert.match(extract, /subjectId: projectionLeadId/)
})

test("an inbound text that overlaps filing cannot strand its message or photos", () => {
  const sms = source("app/api/twilio/sms/route.ts")
  const routing = source("lib/routing.ts")
  const ops = source("lib/ops-data.ts")
  const events = source("lib/events.ts")
  assert.match(routing, /moved_messages AS \([\s\S]*UPDATE messages[\s\S]*lead_id = pair\.target_id/)
  assert.match(routing, /moved_attachments AS \([\s\S]*UPDATE ingest_attachments[\s\S]*lead_id = pair\.target_id/)
  assert.match(sms, /let projectedLeadId = await resolveProjectionLeadId\(conversation\.leadId\)/)
  const afterAttachments = sms.slice(sms.indexOf("const attachmentIds"), sms.indexOf("// The interrupt row"))
  assert.match(afterAttachments, /queueIngestAttachment[\s\S]*reconcileRoutedLeadProjections\(conversation\.leadId\)/)
  assert.match(sms, /url: \`\/ops\/leads\/\$\{projectedLeadId\}#spike\`/)
  assert.ok((ops.match(/COALESCE\(event_lead\.routed_to_lead_id, e\.lead_id\) AS lead_id/g) ?? []).length >= 2)
  assert.ok((ops.match(/COALESCE\(e2_lead\.routed_to_lead_id, e2\.lead_id\) = c\.lead_id/g) ?? []).length >= 2)
  assert.match(events, /routed_source\.routed_to_lead_id = \$\{leadId\}::bigint/)
})

test("holding and routed conversations cannot reply or mutate as ordinary jobs", () => {
  const operators = source("lib/operators.ts")
  const messages = source("app/ops/leads/[id]/message-actions.ts")
  const page = source("app/ops/leads/[id]/page.tsx")
  assert.match(operators, /if \(!options\.allowRoutingInbox && rows\[0\]\.routed_to_lead_id\)/)
  assert.match(operators, /if \(!options\.allowRoutingInbox && rows\[0\]\.service === "Needs job match"\)/)
  assert.match(messages, /if \(lead\.routed_to_lead_id\) throw new Error/)
  assert.match(messages, /if \(lead\.service === "Needs job match"\) throw new Error/)
  assert.match(page, /!needsJobMatch && !routedToLeadId/)
  assert.match(page, /Choose the correct job before replying/)
})

test("routed holding records never inflate jobs, response metrics, or the morning brief", () => {
  const ops = source("lib/ops-data.ts")
  const brief = source("app/api/ops/brief/route.ts")
  const summary = ops.slice(ops.indexOf("export async function getTodayLeadSummary"), ops.indexOf("export type OpsStats"))
  const stats = ops.slice(ops.indexOf("export async function getOpsStats"), ops.indexOf("export type NeedsNowRow"))
  const week = ops.slice(ops.indexOf("export async function getWeekAhead"), ops.indexOf("export type OutTheDoorWeek"))
  assert.equal((summary.match(/routed_to_lead_id IS NULL/g) ?? []).length, 2)
  assert.ok((stats.match(/routed_to_lead_id IS NULL/g) ?? []).length >= 3)
  assert.ok((week.match(/routed_to_lead_id IS NULL/g) ?? []).length >= 3)
  assert.ok((brief.match(/routed_to_lead_id IS NULL/g) ?? []).length >= 6)
})

test("board projections and week-ahead promises fail closed on every linked test identity", () => {
  const ops = source("lib/ops-data.ts")
  const events = source("lib/events.ts")
  const claims = ops.slice(ops.indexOf("async function listBoardActiveClaims"), ops.indexOf("async function listBoardOpenOrBrokenCommitments"))
  const commitments = ops.slice(ops.indexOf("async function listBoardOpenOrBrokenCommitments"), ops.indexOf("async function listBoardNewestPhotoDates"))
  const week = ops.slice(ops.indexOf("export async function getWeekAhead"), ops.indexOf("export type OutTheDoorWeek"))
  for (const projection of [claims, commitments, week]) {
    assert.match(projection, /lead_person\.is_test/)
    assert.match(projection, /source_lead_person\.is_test/)
    assert.match(projection, /source\.detail->>'isTest'/)
    assert.match(projection, /NOT ILIKE '%\[INTERNAL TEST\]%'/)
  }
  const trails = events.slice(events.indexOf("export async function listBoardEventTrails"), events.indexOf("export type TodayEventRow"))
  assert.match(trails, /lead_person\.is_test/)
  assert.match(trails, /p\.is_test/)
})

test("test-partition joins use the real people schema", () => {
  const joinedReaders = [
    source("lib/ops-data.ts"),
    source("lib/events.ts"),
    source("lib/job-line-items.ts"),
  ].join("\n")
  assert.doesNotMatch(
    joinedReaders,
    /\b(?:lead_person|source_person|source_lead_person|event_person|event_lead_person|e2_person|e2_lead_person|commitment_person|commitment_lead_person|commitment_source_person|commitment_source_lead_person|p)\.(?:first_name|last_name|email|phone)\b/,
  )
  assert.match(joinedReaders, /lead_person\.display_name/)
  assert.match(joinedReaders, /lead_person\.phones::text/)
})

test("public health checks the real lead dependency and never caches stale green", () => {
  const health = source("app/api/health/route.ts")
  assert.match(health, /async function canPersistLeadIntake\(\)/)
  assert.match(health, /has_table_privilege\(current_user, 'leads', 'INSERT'\)/)
  assert.match(health, /EXPLAIN \(FORMAT JSON\)[\s\S]*INSERT INTO leads[\s\S]*INSERT INTO events/)
  assert.match(health, /const leadsAccepted = await canPersistLeadIntake\(\)/)
  assert.match(health, /headers: \{ "Cache-Control": "no-store" \}/)
})

test("ordinary customer images have an owner-approved crew promotion path", () => {
  const actions = source("app/ops/actions.ts")
  const page = source("app/ops/leads/[id]/page.tsx")
  assert.match(actions, /export async function classifyLeadAttachment/)
  assert.match(actions, /isSafeRasterImage\(attachment\[0\]\.content_type\)/)
  assert.match(actions, /UPDATE ingest_attachments SET sensitivity = 'photo'/)
  assert.match(page, /Share with crew/)
  assert.match(page, /attachmentSensitivity\.get\(item\.pathname\)/)
})

test("phone navigation exposes search, live work, and the same shell on secondary pages", () => {
  const menu = source("app/ops/more-menu.tsx")
  const board = source("app/board/board.tsx")
  const nav = source("app/board/board-route-nav.tsx")
  assert.match(menu, /className="ops-more-search"/)
  assert.match(menu, /name="q" type="search"/)
  assert.match(menu, /const previousInert = new Map<HTMLElement, boolean>\(\)/)
  assert.match(menu, /surface\.inert = wasInert/)
  assert.match(board, /className="live-call-jump" aria-label="Live MCSW call"/)
  for (const route of ["customers", "calls", "updates"]) {
    assert.match(source(`app/board/${route}/page.tsx`), new RegExp(`<BoardRouteNav role=\\{operator\\.role\\} current="${route}"`))
  }
  assert.match(nav, /href="\/ops\/intake\/new">New job/)
})

test("the board is bounded and inbound alerts identify the welding business", () => {
  assert.match(source("lib/ops-data.ts"), /options\.pageSize \?\? 8\), 1\), 50\)/)
  const voice = source("app/api/twilio/voice/route.ts")
  assert.match(voice, /title: `MCSW call · \$\{name\}`/)
  assert.match(voice, /The welding business is ringing/)
})

test("local service titles and repeated SVG definitions are unique", () => {
  const services = source("lib/service-pages.ts")
  const servicePage = source("app/services/[slug]/page.tsx")
  const home = source("app/page.tsx")
  const weldment = source("components/weldment.tsx")
  for (const title of ["Mobile Welder Nashville", "Trailer Welding Repair Nashville", "Custom Metal Fabrication Nashville"]) {
    assert.match(services, new RegExp(title))
  }
  assert.match(servicePage, /title: service\.seoTitle/)
  assert.doesNotMatch(home, /<WeldSeam \/>/)
  assert.equal((home.match(/<WeldSeam id="wm-bead-/g) ?? []).length, 9)
  assert.match(weldment, /<pattern id=\{id\}/)
})
