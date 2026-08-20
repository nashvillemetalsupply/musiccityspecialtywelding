import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

function section(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker)
  assert.notEqual(start, -1, `Missing section start: ${startMarker}`)
  const end = value.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `Missing section end: ${endMarker}`)
  return value.slice(start, end)
}

function assertInOrder(value, markers, message) {
  let cursor = -1
  for (const marker of markers) {
    const next = value.indexOf(marker, cursor + 1)
    assert.ok(next > cursor, `${message}: expected ${marker}`)
    cursor = next
  }
}

async function loadPureTypescriptModule(path) {
  const result = ts.transpileModule(source(path), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: path,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `${path} must transpile before its pure helpers are exercised`)
  const encoded = Buffer.from(result.outputText).toString("base64")
  return import(`data:text/javascript;base64,${encoded}`)
}

test("design previews do not add build-time font fetches", () => {
  const previewPages = [
    "app/design-preview/mcsw-jobs-call-concepts/page.tsx",
    "app/design-preview/mcsw-jobs-call-sketch/page.tsx",
    "app/design-preview/mcsw-jobs-directions/page.tsx",
    "app/design-preview/mcsw-jobs-finalists/page.tsx",
    "app/design-preview/mcsw-jobs-hybrid-directions/page.tsx",
  ]

  for (const page of previewPages) {
    assert.doesNotMatch(source(page), /from ["']next\/font\/google["']/)
  }
})

test("Active Jobs clamps stale pages and renders the captured customer need", () => {
  // C7 archived active-job-index; the board's tracker row is the live renderer.
  const data = section(source("lib/ops-data.ts"), "export async function listBoardJobs", "export async function getLead")
  const row = source("app/board/board.tsx")

  assert.match(data, /const page\s*=\s*Math\.max\(1,\s*Math\.floor\(options\.page\s*\?\?\s*1\)\)/)
  assertInOrder(data, [
    "const resultTotal",
    "const lastPage",
    "if (page > lastPage)",
    "page: lastPage",
    "const items",
  ], "Stale-page correction must happen after the count and before rows are returned")
  assert.match(data, /return listBoardJobs\(\{\s*\.\.\.options,\s*page:\s*lastPage,\s*pageSize\s*\},\s*role\)/)

  assert.match(row, /<span>\{lead\.message\.trim\(\)\s*\|\|\s*lead\.service\}<\/span>/)
  assert.doesNotMatch(row, /<span>\{lead\.service\}<\/span>/)
})

test("lead snapshot stays truthful and contact actions stay consent-gated", () => {
  // C7 retired the /ops home; the job page is where contact actions live, and
  // they must still check the consent ledger before offering Text.
  const data = section(source("lib/ops-data.ts"), "export async function getTodayLeadSummary", "export async function getLeadEvents")
  const job = source("app/ops/leads/[id]/page.tsx")

  assert.match(data, /America\/Chicago/)
  assert.match(data, /is_test = false AND status <> 'spam'/)
  assert.match(data, /btrim\(gclid\) <> ''/)
  assert.match(job, /getMessagingConsentState\(lead\.phone\)/)
  assert.match(job, /hasCustomerPhone && <TrackedCallButton/)
  assert.match(job, /customerTextReady && <Link[^>]*href="#spike">Text<\/Link>/)
})

test("shared pagination normalizes hostile inputs and makes empty data page one", async () => {
  const { clampPageToTotal, normalizePage, pageCountForTotal } = await loadPureTypescriptModule("lib/pagination.ts")

  assert.equal(normalizePage("3.9"), 3)
  assert.equal(normalizePage(-20), 1)
  assert.equal(normalizePage(Number.POSITIVE_INFINITY), 1)
  assert.equal(normalizePage("not-a-page"), 1)
  assert.equal(pageCountForTotal(0, 50), 1)
  assert.equal(pageCountForTotal(101, 50), 3)
  assert.equal(clampPageToTotal(999, 0, 50), 1)
  assert.equal(clampPageToTotal(999, 101, 50), 3)
  assert.equal(clampPageToTotal(2, 101, 50), 2)
})

test("pending calls use a bounded, clamped database page", () => {
  // C7 retired the /ops home and its calls queue view; the clamped query
  // contract in lib/job-intake.ts is what still ships.
  const intake = section(source("lib/job-intake.ts"), "export async function listPendingCallIntakes", "export async function saveInboundCallAsJob")

  assert.match(intake, /const pageSize\s*=\s*Math\.min\(Math\.max\(Math\.floor\(options\.pageSize\s*\?\?\s*3\),\s*1\),\s*20\)/)
  assert.match(intake, /const requestedPage\s*=\s*Math\.max\(1,\s*Math\.floor\(options\.page\s*\?\?\s*1\)\)/)
  assertInOrder(intake, [
    "SELECT count(*)::int AS total_count",
    "const total",
    "const page = Math.min(requestedPage",
    "const offset = (page - 1) * pageSize",
    "ORDER BY d.created_at DESC",
    "LIMIT ${pageSize}",
    "OFFSET ${offset}",
    "return { items: rows, total, page, pageSize }",
  ], "Pending-call pagination must count, clamp, and then fetch the requested slice")
})

test("Needs Attention clamps to its returned page", () => {
  // C7 retired the /ops home's Needs Attention panel; the board's attention
  // stage renders from listBoardJobs. The clamped query contract still ships.
  const data = section(source("lib/ops-data.ts"), "export async function getNeedsNow", "export async function getMonthRevenueCents")

  assert.match(data, /count\(\*\) OVER\(\)::int AS total_count/)
  assertInOrder(data, [
    "if (items.length === 0 && requestedPage > 1)",
    "getNeedsNow({ page: 1, pageSize: 1 }, role)",
    "clampPageToTotal(requestedPage, firstPage.total, pageSize)",
    "page: requestedPage",
  ], "Needs Attention must recover its count before returning an oversized page")
})

test("Promises, Regular Customers, and Updates return clamped pages", () => {
  // C7 retired the /ops home's Updates/Promises/Regulars views; the clamped
  // query contracts in lib remain the shipped behavior.
  const wall = source("lib/wall-data.ts")
  const wire = section(source("lib/notify.ts"), "export async function listWire", "export async function countUnreadWire")

  assert.ok((wall.match(/count\(\*\) OVER\(\)::int AS total_count/g) ?? []).length >= 2)
  assert.match(wall, /listWallCommitments\(role,\s*\{\s*page:\s*clampPageToTotal\(requestedPage, firstPage\.total, pageSize\),\s*pageSize\s*\}\)/)
  assert.match(wall, /listRegularAccounts\(\{\s*\.\.\.options,\s*page:\s*clampPageToTotal\(requestedPage, firstPage\.total, pageSize\),\s*pageSize\s*\}\)/)
  assert.match(wire, /count\(\*\) OVER\(\)::int AS total_count/)
  assert.match(wire, /listWire\(operatorId, role, \{ \.\.\.options, page: clampPageToTotal\(requestedPage, firstPage\.total, pageSize\), pageSize \}\)/)
})

test("account job history counts filtered rows before fetching its clamped page", () => {
  const account = section(source("lib/accounts.ts"), "export async function getAccount", "return {")
  const page = source("app/ops/accounts/[id]/page.tsx")

  assertInOrder(account, [
    "const requestedPage",
    "AS filtered_total",
    "const filteredTotal",
    "const page = clampPageToTotal(requestedPage, filteredTotal, 16)",
    "const offset = (page - 1) * 16",
    "const leads",
  ], "Account history must clamp against the same filtered job set before applying OFFSET")
  assert.ok((account.match(/CASE WHEN \$\{role\}::text = 'owner' THEN l\.notes ELSE COALESCE\(l\.crew_notes, ''\) END/g) ?? []).length >= 2)
  assert.match(page, /getAccount\(personId, operator\.role, \{ page: requestedPage, query, year \}\)/)
  assert.match(page, /const page\s*=\s*account\.page/)
  assert.match(page, /page=\$\{page\s*-\s*1\}[\s\S]*encodeURIComponent\(query\)[\s\S]*year=\$\{year\}/)
})

test("Full Record refetches and navigates with its role-filtered clamped page", () => {
  const events = section(source("lib/events.ts"), "export async function listLeadEventPage", "export async function searchEvents")
  const page = source("app/ops/leads/[id]/page.tsx")
  const record = section(page, "<details className=\"job-record\"", "</details>")

  assertInOrder(events, [
    "const totalRows",
    "const clampedPage = clampPageToTotal(safePage, totalRows, pageSize)",
    "if (clampedPage !== safePage)",
    "listLeadEventPage(leadId, clampedPage, pageSize, role)",
    "page: clampedPage",
  ], "Full Record must preserve its role filter while refetching the truthful last page")
  assert.match(page, /listLeadEventPage\(leadId, requestedActivityPage, 25, operator\.role\)/)
  assert.match(page, /const activityPageNumber\s*=\s*activityPage\.page/)
  assert.match(record, /activityPage=\$\{activityPageNumber\s*-\s*1\}/)
  assert.match(record, /Page \{activityPageNumber\} of \{activityPages\}/)
  assert.match(record, /activityPage=\$\{activityPageNumber\s*\+\s*1\}/)
})

test("private missing routes stay inside the Jobs brand without marketing chrome", () => {
  const missing = source("app/ops/not-found.tsx")

  // The surface is pinned by what it says and what it refuses to render, not by
  // the stylesheet hook it happens to wear: `jobs-route-state` belonged to the
  // sheets Task 7 deletes, so pinning it would have outlawed the conversion.
  assert.match(missing, /<main\b/)
  assert.match(missing, /Job or customer not found\./)
  assert.doesNotMatch(missing, /jobs-route-state|jobs-panel|jobs-brand/)
  assert.match(missing, /Nothing was changed/)
  assert.match(missing, /href="\/ops"[^>]*>Back to Jobs<\/Link>/)
  assert.doesNotMatch(missing, /(?:import|<)(?:Navbar|Footer|MainstreetMenu|MainstreetContact)\b/)
})

test("inline call edits stay attached to one draft identity", () => {
  const intake = source("app/ops/intake/inline-job-intake.tsx")
  const identity = section(intake, "const [source", "const [walkInFields")
  const fieldUpdate = section(intake, "const setFields", "const canSave")

  assertInOrder(identity, [
    "const callIdentity",
    "const serverCallFields",
    "const [callEdit",
    "const callFields",
  ], "Draft identity must be established before editable fields are selected")
  assert.match(identity, /callEdit\?\.identity\s*===\s*callIdentity\s*\?\s*callEdit\.fields\s*:\s*serverCallFields/)
  assert.match(fieldUpdate, /identity:\s*callIdentity/)
  assert.match(fieldUpdate, /current\?\.identity\s*===\s*callIdentity\s*\?\s*current\.fields\s*:\s*serverCallFields/)
})

test("inline undo restores the exact draft that was dismissed", () => {
  const intake = source("app/ops/intake/inline-job-intake.tsx")
  const disposition = section(intake, "async function changeDisposition", "async function undoSavedJob")

  const targetId = disposition.split("\n").find((line) => line.includes("const targetPublicId")) ?? ""
  assert.match(targetId, /intent\s*===\s*"restore"/)
  assert.match(targetId, /dismissedCall\?\.publicId/)
  assert.match(targetId, /activeDraft\?\.publicId/)
  assert.ok(targetId.indexOf("dismissedCall?.publicId") < targetId.indexOf("activeDraft?.publicId"))
  assert.match(disposition, /intent\s*===\s*"restore"\s*\?\s*dismissedCall\?\.fields\s*\?\?\s*fields\s*:\s*fields/)
  assertInOrder(disposition, [
    "const targetPublicId",
    "const targetFields",
    "data.set(\"draftId\", targetPublicId)",
    "changeCallDraftDispositionAction(data)",
    "publicId: targetPublicId",
  ], "Dismiss and restore must keep using the captured draft receipt")
})

test("shop language removes evidence syntax while preserving readable punctuation", async () => {
  const { withoutEvidenceMarkers } = await loadPureTypescriptModule("lib/shop-language.ts")

  assert.equal(withoutEvidenceMarkers("Gate hinge is cracked [e:42]."), "Gate hinge is cracked.")
  assert.equal(withoutEvidenceMarkers("Cut [e:1], weld [E:22]; ready [e:3]!"), "Cut, weld; ready!")
  assert.equal(withoutEvidenceMarkers("Parts ordered [e:"), "Parts ordered")
  assert.equal(withoutEvidenceMarkers("Use [A36] plate"), "Use [A36] plate")
})

test("shop language turns internal values into stable human labels", async () => {
  const { shopDeliveryLabel, shopEventLabel, shopJobStatusLabel, shopSourceLabel } = await loadPureTypescriptModule("lib/shop-language.ts")

  assert.equal(shopEventLabel("call.out"), "Shop call")
  assert.equal(shopEventLabel("sms.delivery-unknown"), "Text update")
  assert.equal(shopEventLabel("provider.opaque-state"), "Job update")
  assert.equal(shopJobStatusLabel("qualified"), "Pricing next")
  assert.equal(shopJobStatusLabel("provider-only"), "Job update")
  assert.equal(shopDeliveryLabel("undelivered"), "Not delivered")
  assert.equal(shopDeliveryLabel("provider-only"), "Delivery update")
  assert.equal(shopSourceLabel(" PHONE-IN "), "Phone call")
  assert.equal(shopSourceLabel("provider-only"), "Other")
})

test("Swipe to Finish separates assistive clicks, key repeats, and blur cancellation", () => {
  const done = source("app/ops/leads/[id]/done-stamp.tsx")
  const arming = section(done, "function armOrFinish", "return <section")
  const control = section(done, "className={`ops-swipe-finish", "<span className=\"ops-swipe-track\"")
  const click = section(control, "onClick={(event) => {", "onBlur=")
  const keyboard = section(control, "onKeyDown={(event) => {", "\n      >")

  assertInOrder(arming, ["if (submitting) return", "if (keyboardArmed) finish()", "else setKeyboardArmed(true)"], "Assistive activation must arm before it can finish")
  assert.match(click, /event\.detail\s*===\s*0/)
  assert.match(click, /armOrFinish\(\)/)
  assert.doesNotMatch(click, /\bfinish\(\)/)
  assert.match(control, /onBlur=\{\(\)\s*=>\s*setKeyboardArmed\(false\)\}/)
  assertInOrder(keyboard, [
    "if (event.repeat) return",
    "event.key === \"Escape\"",
    "event.preventDefault()",
    "armOrFinish()",
  ], "Keyboard activation must reject repeats and remain cancelable")
})

test("VoiceCapture gives virtual clicks a toggle and releases on repeat-safe blur", () => {
  const voice = source("app/ops/voice-capture-button.tsx")
  const control = section(voice, "return <button", "</button>")
  const click = section(control, "onClick={(event) => {", "onBlur=")
  const keyDown = section(control, "onKeyDown={(event) => {", "onKeyUp=")

  assertInOrder(click, [
    "if (event.detail !== 0) return",
    "pressEnd()",
    "else pressStart()",
  ], "Virtual activation must toggle recording without replaying pointer clicks")
  assert.match(control, /onBlur=\{\(\)\s*=>\s*\{\s*if \(pressedRef\.current\) pressEnd\(\)\s*\}\}/)
  assert.match(keyDown, /if \(!event\.repeat\s*&&\s*\(event\.key\s*===\s*"Enter"\s*\|\|\s*event\.key\s*===\s*" "\)\)/)
  assert.match(keyDown, /event\.preventDefault\(\)/)
  assert.match(keyDown, /pressStart\(\)/)
  assert.match(control, /onKeyUp=\{\(event\)\s*=>\s*\{[\s\S]*pressEnd\(\)/)
})

test("phone login uses Twilio Verify without enabling customer SMS", () => {
  const twilio = source("lib/twilio.ts")
  const request = source("app/api/ops/sms-login/request/route.ts")
  const verify = source("app/api/ops/sms-login/verify/route.ts")
  const install = source("app/ops/install/page.tsx")

  assert.match(twilio, /TWILIO_VERIFY_SERVICE_SID/)
  assert.match(twilio, /twilioPhoneLoginConfigured\(\)[\s\S]*twilioVerifyConfigured\(\) \|\| twilioSmsConfigured\(\)/)
  assertInOrder(request, ["createSmsVerificationIntent(operator)", "startPhoneLoginVerification(phone)"], "Verify intent must persist before provider send")
  assertInOrder(verify, ["checkPhoneLoginVerification(phone, code)", "redeemSmsVerificationIntent(operator)"], "Provider approval must precede session creation")
  assert.match(install, /operators=\{operators\} smsReady=\{smsReady\}/)
})

// "Active Jobs tolerates a not-yet-ready text-ready set" was retired with
// active-job-index in C7 (archive/ops-legacy-2026-08-20); the board tracker
// does not carry a textReadyLeadIds prop.

test("lead summary groups source labels and wire body stays table-qualified", () => {
  const summary = section(source("lib/ops-data.ts"), "export async function getTodayLeadSummary", "export async function getLeadEvents")
  const wire = section(source("lib/notify.ts"), "export async function listWire", "export async function countUnreadWire")

  // gclid is folded into a CASE source label and grouped by that label, so the
  // aggregate no longer leaves a bare gclid column outside GROUP BY.
  assert.match(summary, /END AS source/)
  assert.match(summary, /count\(\*\)::int AS count/)
  assert.match(summary, /GROUP BY 1/)

  // The notifications/events join must qualify body/title so the column is not
  // ambiguous across notifications and events.
  assert.match(wire, /LEFT JOIN events source ON source\.id = n\.source_event_id/)
  assert.match(wire, /n\.title ILIKE/)
  assert.match(wire, /n\.body ILIKE/)
})

test("lead projection redacts money in place without a dangling redactMoney helper", () => {
  const data = source("lib/ops-data.ts")
  const lead = section(data, "export async function getLead", "export async function getRepeatJobCounts")

  assert.doesNotMatch(data, /\bredactMoney\b/)
  assert.match(lead, /projectLeadForRole\(rows\[0\], role\)/)
})

test("extract.ts parses and the ops feature modules resolve their exports", () => {
  const result = ts.transpileModule(source("lib/extract.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "lib/extract.ts",
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], "lib/extract.ts must not contain syntax errors")

  const modules = [
    ["app/ops/login-form.tsx", "OpsLoginForm"],
    ["app/ops/leads/[id]/done-stamp.tsx", "DoneStamp"],
    ["app/ops/leads/[id]/glass-control.tsx", "GlassControl"],
    ["app/ops/ops-live.tsx", "OpsLive"],
    ["app/ops/shop-dock.tsx", "ShopDock"],
  ]
  for (const [file, name] of modules) {
    assert.match(source(file), new RegExp(`export function ${name}\\b`), `${file} must export ${name}`)
  }
})
