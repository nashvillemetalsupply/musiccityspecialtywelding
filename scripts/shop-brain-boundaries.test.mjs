import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { formatSmsBody, isGmailMessageGone, isMetaVerificationSms, isUsNumericShortCode } from "../lib/shop-brain-invariants.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("crew searches and receipts cross a role-aware server boundary", () => {
  const events = source("lib/events.ts")
  const receipts = source("app/api/ops/receipts/route.ts")
  assert.match(events, /THEN e\.tsv ELSE e\.crew_tsv END/)
  assert.match(receipts, /projectEventForRole\(event, operator\.role\)/)
  assert.doesNotMatch(receipts, /receipts:\s*rows\.map\(\(\{.*body/s)
})

test("crew lead and account tools share one fail-closed money projection", () => {
  const opsData = source("lib/ops-data.ts")
  const accounts = source("lib/accounts.ts")
  const ask = source("app/api/ops/ask/route.ts")
  assert.match(opsData, /export function projectLeadForRole/)
  for (const field of ["estimate_value_cents", "revenue_cents", "paid_amount_cents", "invoice_total_cents"]) {
    assert.match(opsData, new RegExp(`${field}: null`))
  }
  assert.match(opsData, /invoice_pay_url: ""/)
  assert.match(opsData, /message: redactCrewText\(lead\.crew_message/)
  assert.match(accounts, /projectLeadForRole\(lead, role\)/)
  assert.match(ask, /getLead\(id, operator\.role\)/)
  assert.match(ask, /getAccount\(person_id, operator\.role/)
})

test("crew claim values recursively redact money even under safe predicates", () => {
  const visibility = source("lib/visibility.ts")
  const accounts = source("lib/accounts.ts")
  const workOrder = source("app/ops/leads/[id]/page.tsx")
  assert.match(visibility, /OWNER_ONLY_VALUE_KEY/)
  assert.match(visibility, /CURRENCY_MARKER/)
  assert.match(visibility, /containsMoneyMarker\(value\)/)
  assert.match(visibility, /Array\.isArray\(value\).*value\.map\(projectClaimValue\)/s)
  assert.match(visibility, /typeof value === "string".*redactCrewText\(value\)/s)
  assert.match(accounts, /projectClaimForRole\(claim, role\)/)
  assert.match(workOrder, /projectClaimForRole\(claim, operator\.role\)/)
})

test("clean additive migrations create GLASS before widening it", () => {
  const migration = source("scripts/migrate.mjs")
  const create = migration.indexOf("CREATE TABLE IF NOT EXISTS glass_links")
  assert.ok(create >= 0)
  assert.ok(create < migration.indexOf("ALTER TABLE glass_links ADD COLUMN IF NOT EXISTS send_status"))
  assert.ok(create < migration.indexOf("ALTER TABLE glass_links ADD COLUMN IF NOT EXISTS send_attempts"))
})

test("crew morning audio cannot fall back to the owner tape", () => {
  const latest = source("app/api/ops/brief/latest/route.ts")
  const audio = source("app/api/ops/brief/audio/route.ts")
  assert.match(latest, /selectBriefAudioPath\(operator\.role/)
  assert.match(audio, /THEN detail->>'audioPath' ELSE detail->>'crewAudioPath' END/)
})

test("Twilio retry and internal-test side effects stay gated", () => {
  const smsStatus = source("app/api/twilio/sms-status/route.ts")
  const voiceStatus = source("app/api/twilio/voice-status/route.ts")
  assert.match(smsStatus, /externalId: `\$\{sid\}:\$\{effectiveStatus\}`/)
  assert.match(smsStatus, /status IN \('read', 'failed', 'undelivered', 'canceled'\)/)
  assert.match(smsStatus, /WHEN 'delivered' THEN 4 WHEN 'read' THEN 5/)
  assert.match(smsStatus, /if \(!twilioSmsWebhookConfigured\(\)\)/)
  assert.match(smsStatus, /if \(!eventId\)[\s\S]{0,260}SELECT id FROM events/)
  assert.match(smsStatus, /!tests\[0\]\?\.is_test/)
  assert.match(voiceStatus, /if \(!eventId \|\| call\.is_test\)/)
  assert.match(voiceStatus, /actorType: "operator"/)
})

test("the sole notification gate suppresses every INTERNAL TEST source", () => {
  const notify = source("lib/notify.ts")
  const gmail = source("app/api/ingest/gmail/route.ts")
  const voice = source("app/api/twilio/voice/route.ts")
  assert.match(notify, /LEFT JOIN leads l ON l\.id = e\.lead_id/)
  assert.match(notify, /detail->>'isTest'/)
  assert.match(notify, /reason: "internal-test"/)
  assert.ok(gmail.indexOf("const isTest = `${subject}\\n${body}`") < gmail.indexOf("if (isAuthenticatedIntuitPayment"), "Gmail must partition test payment mail before money routing")
  assert.match(gmail, /AND is_test = \$\{isTest\}::boolean/)
  assert.match(voice, /isTest: person\?\.is_test \?\? isTestCall/)
  assert.match(voice, /!isTestCall && !person\?\.is_test && !\(prepared\.kind === "draft" && prepared\.draft\.is_test\)/)
})

test("marking mail Not a job also closes its unread alert retries", () => {
  const actions = source("app/ops/actions.ts")
  const updateStatus = actions.slice(actions.indexOf("export async function updateLeadStatus"), actions.indexOf("export async function markFirstResponse"))
  assert.match(updateStatus, /if \(status === "spam"\)/)
  assert.match(updateStatus, /UPDATE notifications n SET[\s\S]*read_at = COALESCE\(n\.read_at, now\(\)\)/)
  assert.match(updateStatus, /delivery_status IN \('pending','sending','retry'\)[\s\S]*THEN 'filed'/)
  assert.match(updateStatus, /FROM events e[\s\S]*e\.lead_id = \$\{leadId\}::bigint/)
})

test("work orders render old and new email bodies as readable text", () => {
  const workOrder = source("app/ops/leads/[id]/page.tsx")
  assert.match(workOrder, /import \{ readableEmailText \} from "@\/lib\/gmail-plaintext\.mjs"/)
  assert.match(workOrder, /return readableEmailText\(text\) \|\|/)
})

test("tracked calling rejects the shop number and test work", () => {
  const call = source("app/api/ops/call/route.ts")
  const button = source("app/ops/tracked-call-button.tsx")
  assert.match(call, /isReservedShopPhone\(targetPhone\)/)
  assert.match(call, /lead\.is_test/)
  assert.match(button, /targetPhone: phone/)
  assert.match(call, /That phone is not attached to this customer account/)
  assert.match(call, /INSERT INTO calls/)
  assert.ok(call.indexOf("INSERT INTO calls") < call.indexOf("await startVoiceCall"), "call intent must persist before provider delivery")
})

test("tracked return calls clear waiting work and exempt alerts do not spend the budget", () => {
  const needs = source("lib/ops-data.ts")
  const notify = source("lib/notify.ts")
  const quote = source("app/api/quote/route.ts")
  assert.match(needs, /'call\.answered','call\.out'/)
  assert.match(notify, /budget_exempt = false/)
  assert.match(notify, /input\.capExempt \?\? false/)
  assert.match(quote, /capExempt: true,[\s\S]{0,80}quietHoursExempt: true/)
})

test("durable interrupt intents retry through the same quiet-hour and budget gate", () => {
  const notify = source("lib/notify.ts")
  const recovery = source("lib/recovery-sweep.ts")
  const migration = source("scripts/migrate.mjs")
  assert.match(migration, /delivery_status TEXT NOT NULL DEFAULT 'filed'/)
  assert.match(notify, /export async function retryPendingInterrupts/)
  assert.match(notify, /delivery_attempts < 5/)
  assert.match(notify, /delivery_status = 'pending' AND created_at < now\(\) - interval '10 minutes'/)
  assert.match(notify, /timezone\('America\/Chicago', sent_at\)/)
  assert.match(notify, /Daily interrupt budget was already full/)
  assert.match(notify, /More happened\. Check Updates\./)
  assert.match(notify, /The coalesced alert could not reach a registered push channel/)
  assert.match(notify, /Alert delivery failed/)
  assert.match(recovery, /retryPendingInterrupts\(\)/)
  assert.doesNotMatch(notify, /sendSms\([\s\S]{0,180}\.then\(\(\) => true\)\.catch\(\(\) => false\)/)
  assert.match(notify, /smsDeliveryUnknown = !isDefinitiveTwilioError\(error\)/)
  assert.match(notify, /delivery_status = 'unknown'[\s\S]{0,260}automatic repeat is quarantined/)
  const initialClaim = notify.indexOf("delivery_status = 'sending', delivery_attempts = delivery_attempts + 1")
  const initialPush = notify.indexOf("await sendPushToOperator(input.operatorId")
  assert.ok(initialClaim >= 0 && initialClaim < initialPush, "the durable alert row must be claimed before the first provider call")
  assert.match(notify, /provider may have accepted it, so automatic repeat is quarantined/)
  assert.match(notify, /WHERE priority = 'interrupt' AND sent_at IS NULL AND delivery_status = 'sending'/)
  assert.doesNotMatch(notify, /OR \(delivery_status = 'sending' AND delivery_last_attempt_at < now\(\) - interval '10 minutes'\)/)
  assert.doesNotMatch(notify, /Â·/)
})

test("operator SMS alerts reconcile signed provider delivery callbacks", () => {
  const notify = source("lib/notify.ts")
  const callback = source("app/api/twilio/notification-status/route.ts")
  const migration = source("scripts/migrate.mjs")
  assert.match(migration, /provider_message_sid TEXT/)
  assert.match(migration, /provider_status TEXT/)
  assert.match(notify, /twilioCallbackUrl\(`\/api\/twilio\/notification-status\?notification=\$\{(?:id|row\.id)\}`\)/)
  assert.match(callback, /readTwilioForm\(req\)/)
  assert.match(callback, /provider_message_sid = \$\{sid\}::text/)
  assert.match(callback, /delivery_status = CASE[\s\S]{0,500}'delivered'/)
  assert.match(callback, /WHEN delivery_status IN \('delivered','dead'\) THEN delivery_status/)
  assert.match(notify, /provider_status = COALESCE\(provider_status, \$\{sms\.status\}::text\)/)
  assert.match(notify, /delivery_status = CASE WHEN delivery_status IN \('delivered','dead'\) THEN delivery_status ELSE 'accepted' END/)
})

test("the database protects immutable event truth while allowing one-way enrichment", () => {
  const migration = source("scripts/migrate.mjs")
  const manualIntake = source("app/ops/actions.ts")
  const callIntake = source("lib/job-intake.ts")
  const recoveredCalls = source("lib/call-artifacts.ts")
  const extraction = source("lib/extract.ts")
  assert.match(migration, /CREATE OR REPLACE FUNCTION protect_event_journal_truth\(\)/)
  for (const column of ["occurred_at", "recorded_at", "kind", "actor_type", "actor_id", "external_id", "body"]) {
    assert.match(migration, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`))
  }
  assert.match(migration, /OLD\.lead_id IS NOT NULL AND NEW\.lead_id IS DISTINCT FROM OLD\.lead_id/)
  assert.match(migration, /OLD\.person_id IS NOT NULL AND NEW\.person_id IS DISTINCT FROM OLD\.person_id/)
  assert.match(migration, /OLD\.detail IS NOT NULL AND NOT \(COALESCE\(NEW\.detail, '\{\}'::jsonb\) @> OLD\.detail\)/)
  assert.match(migration, /CREATE TRIGGER events_truth_immutable/)
  assert.match(manualIntake, /UPDATE events SET processed_at = NULL, extraction_status = 'pending'/)
  assert.match(callIntake, /UPDATE events SET processed_at = NULL, extraction_status = 'pending'/)
  assert.doesNotMatch(manualIntake, /detail\s*=\s*COALESCE\(detail, '\{\}'::jsonb\)\s*-\s*'intakeUndoDeferred'/)
  assert.doesNotMatch(callIntake, /detail\s*=\s*COALESCE\(detail, '\{\}'::jsonb\)\s*-\s*'intakeUndoDeferred'/)
  assert.doesNotMatch(recoveredCalls, /UPDATE events[\s\S]{0,250}actor_id\s*=/)
  assert.match(extraction, /UPDATE events SET crew_body = COALESCE\(crew_body, \$\{crewSafeBody\}::text\)/)
})

test("unlinked INTERNAL TEST receipts never enter Handset search", () => {
  const events = source("lib/events.ts")
  assert.match(events, /COALESCE\(l\.is_test, false\) = false/)
  assert.match(events, /COALESCE\(p\.is_test, false\) = false/)
  assert.match(events, /e\.detail->>'isTest'/)
})

test("money evidence outranks raster attachment convenience", () => {
  const retry = source("lib/attachment-retry.ts")
  const sms = source("app/api/twilio/sms/route.ts")
  assert.ok(retry.indexOf('return "owner_paperwork"') < retry.indexOf('return "photo"'))
  assert.match(retry, /classifyAttachmentSensitivity\(input\.filename, input\.contentType, input\.context\)/)
  assert.match(sms, /context: body/)
  assert.doesNotMatch(sms, /sensitivity: media\.contentType\.startsWith/)
})

test("attachment pointers persist before provider bytes are copied", () => {
  const retry = source("lib/attachment-retry.ts")
  assert.match(retry, /INSERT INTO ingest_attachments/)
  assert.match(retry, /attempts < CASE WHEN provider = 'gmail' THEN 72 ELSE 12 END/)
  assert.match(retry, /dead_lettered_at/)
  assert.match(retry, /actionKind: "attachment-retry"/)
  assert.match(retry, /UPDATE ingest_attachments SET status = 'stored'/)
  assert.match(retry, /status = 'copying' AND updated_at < now\(\) - interval '10 minutes'/)
  assert.match(retry, /status = 'projecting' AND updated_at < now\(\) - interval '10 minutes'/)
  assert.match(retry, /UPDATE ingest_attachments SET status = 'projecting'/)
  assert.match(retry, /projected_at = now\(\)/)
  assert.match(retry, /jsonb_set\(COALESCE\(media/)
})

test("deterministic private Blob writes can resume after response loss", () => {
  const transcribe = source("app/api/ops/transcribe/route.ts")
  const brief = source("app/api/ops/brief/route.ts")
  const actions = source("app/ops/actions.ts")
  const attachments = source("lib/attachment-retry.ts")
  assert.match(transcribe, /voice-notes\/\$\{operator\.id\}\/\$\{id\}[\s\S]{0,180}allowOverwrite: true/)
  assert.equal((brief.match(/allowOverwrite: true/g) ?? []).length, 2)
  assert.ok((actions.match(/allowOverwrite: true/g) ?? []).length >= 4)
  assert.match(attachments, /allowOverwrite: true/)
})

test("Gmail does not advance its checkpoint after a partial failure", () => {
  const gmail = source("app/api/ingest/gmail/route.ts")
  assert.match(gmail, /if \(counters\.failures === 0\) await sql/)
  assert.match(gmail, /checkpointAdvanced: counters\.failures === 0/)
})

test("every real inbound Gmail reply reaches the capped interrupt gate", () => {
  const gmail = source("app/api/ingest/gmail/route.ts")
  const inboundNotify = gmail.slice(gmail.indexOf("const paperworkRequested"), gmail.indexOf("after(() => processEvent"))
  assert.match(inboundNotify, /if \(!conversation\.person\.is_test && !sent\) await notifyAll/)
  assert.match(inboundNotify, /priority: "interrupt"/)
  assert.match(inboundNotify, /capExempt: conversation\.createdLead/)
  assert.match(inboundNotify, /quietHoursExempt: conversation\.createdLead/)
  assert.match(inboundNotify, /sourceEventId: eventId/)
})

test("Gmail tombstones advance the checkpoint without retries or false-green schedulers", () => {
  assert.equal(isGmailMessageGone(Object.assign(new Error("Gmail API 404"), { status: 404 })), true)
  assert.equal(isGmailMessageGone(Object.assign(new Error("Gmail API 429"), { status: 429 })), false)
  assert.equal(isGmailMessageGone(new Error("Gmail API 404")), false, "status text alone is not trusted")
  assert.equal(isGmailMessageGone(null), false)

  const ingest = source("app/api/ingest/gmail/route.ts")
  const fetchStart = ingest.indexOf("getGmailMessage(token, id)")
  const routeEnd = ingest.indexOf("const headers = gmailHeaders(message)", fetchStart)
  const fetchBoundary = ingest.slice(fetchStart, routeEnd)
  assert.match(fetchBoundary, /isGmailMessageGone\(error\)/)
  assert.match(fetchBoundary, /counters\.gone\+\+/)
  assert.doesNotMatch(fetchBoundary, /gmail_ingest_failures/)

  const workflow = source(".github/workflows/gmail-sync.yml")
  assert.match(workflow, /jq -e '\.ok == true'/)
  assert.match(workflow, /Gmail sync returned ok=false/)
})

test("every real inbound SMS persists an owner-cell copy without test or routing loops", () => {
  const inbound = source("app/api/twilio/sms/route.ts")
  const notify = source("lib/notify.ts")
  const migration = source("scripts/migrate.mjs")

  assert.match(inbound, /!isReservedShopPhone\(from\)/)
  assert.match(inbound, /await notifyOwnerCellSms\(/)
  assert.match(inbound, /dedupeKey: `owner-sms-copy:\$\{sid\}`/)
  assert.match(inbound, /capExempt: true/)
  assert.match(inbound, /quietHoursExempt: true/)
  assert.match(inbound, /\/ops\/leads\/\$\{conversation\.leadId\}#spike/)
  assert.match(notify, /export async function notifyOwnerCellSms/)
  assert.match(notify, /getOperatorByPhone\(ownerCell\)/)
  assert.match(notify, /smsOnly: true/)
  assert.match(notify, /input\.smsOnly/)
  assert.match(notify, /row\.sms_only/)
  const insert = notify.slice(notify.indexOf("INSERT INTO notifications"), notify.indexOf("ON CONFLICT"))
  const columnList = insert.slice(insert.indexOf("("), insert.indexOf(") VALUES"))
  const valueList = insert.slice(insert.indexOf("VALUES ("))
  assert.match(columnList, /sms_fallback,\s*sms_only/)
  const columnCount = (columnList.match(/,/g) ?? []).length + 1
  const valueCount = valueList.split(/,\r?\n/).length
  assert.equal(columnCount, valueCount,
    "INSERT INTO notifications must list a column for every supplied value")
  assert.match(migration, /sms_only BOOLEAN NOT NULL DEFAULT false/)
})

test("US short codes and Meta verification texts are system SMS, never customer traffic", () => {
  // US numeric short codes: 5 or 6 digits after optional punctuation. A short
  // code is sender infrastructure, never a customer identity, and the 10/11-
  // digit normalizePhone path must never be asked to resolve one.
  assert.equal(isUsNumericShortCode("32665"), true)
  assert.equal(isUsNumericShortCode("+32665"), true)
  assert.equal(isUsNumericShortCode("326-65"), true)
  assert.equal(isUsNumericShortCode("  32665  "), true)
  assert.equal(isUsNumericShortCode("6155551234"), false)
  assert.equal(isUsNumericShortCode("615-555-1234"), false)
  assert.equal(isUsNumericShortCode("+16155551234"), false)
  assert.equal(isUsNumericShortCode(""), false)
  assert.equal(isUsNumericShortCode("NUMBER"), false)
  assert.equal(isUsNumericShortCode(null), false)

  // Meta/Instagram verification from an ordinary sender is recognized only by
  // the body, and only when BOTH the brand and code language are present.
  assert.equal(isMetaVerificationSms("32665 is your Instagram code. Don't share it."), true)
  assert.equal(isMetaVerificationSms("Your Instagram code is 481516. Don't share it."), true)
  assert.equal(isMetaVerificationSms("Confirm it's you: your Instagram login code is 481516."), true)
  assert.equal(isMetaVerificationSms("Meta: security code 481516 for your account."), true)
  assert.equal(isMetaVerificationSms("Instagram is great for reaching customers"), false, "brand alone is not a verification text")
  assert.equal(isMetaVerificationSms("Your code is 481516. Reply STOP to opt out."), false, "code language alone is not a verification text")
  assert.equal(isMetaVerificationSms("Can you weld this gate by Friday?"), false)
  assert.equal(isMetaVerificationSms(""), false)
  assert.equal(isMetaVerificationSms(null), false)
})

test("signed inbound verification SMS bypasses customers and crew, and texts only the owner", () => {
  const inbound = source("app/api/twilio/sms/route.ts")

  // Classification runs before any customer intake, so a short code can never
  // reach resolvePhoneConversation and be rejected by normalizePhone.
  assert.ok(inbound.indexOf("isUsNumericShortCode(from)") < inbound.lastIndexOf("resolvePhoneConversation"),
    "short-code classification must precede customer intake")
  // System SMS inserts a message with nullable lead/person and never records
  // messaging consent.
  assert.match(inbound, /systemSms[\s\S]{0,260}return \{ person: null, leadId: null, createdLead: false \}/)
  assert.match(inbound, /if \(!systemSms\)[\s\S]{0,120}recordMessagingConsent/)
  // The immutable event is sms.system.in, keyed by the external SID, and its
  // body is a neutral constant so the code is never exposed or logged.
  assert.match(inbound, /const eventKind = systemSms[\s\S]{0,80}"sms\.system\.in"/)
  assert.match(inbound, /externalId: sid/)
  assert.match(inbound, /System verification text received\./)
  assert.doesNotMatch(inbound.slice(inbound.indexOf("const eventKind"), inbound.indexOf("let wasNewLead")), /body: body/,
    "the immutable system event must not carry the code-bearing body")
  // No crew alert, no attachments, no extraction, no fake job for system SMS.
  assert.match(inbound, /!consentKeyword && !systemSms[\s\S]{0,60}notifyAll/)
  assert.match(inbound, /\(consentKeyword \|\| systemSms \? \[\] : rawMedia\)/)
  assert.match(inbound, /!consentKeyword && !systemSms[\s\S]{0,40}after\(/)
  // The owner-only copy: verification title, full body and sender, absolute
  // Updates URL, cap and quiet-hours exempt, stable per-SID dedupe.
  assert.match(inbound, /title: "Verification code received"/)
  assert.match(inbound, /body: `\$\{from\}: \$\{body/)
  assert.match(inbound, /\/board\/updates#wire/)
  assert.match(inbound, /dedupeKey: `owner-system-sms:\$\{sid\}`/)
  assert.match(inbound, /capExempt: true/)
  assert.match(inbound, /quietHoursExempt: true/)
  // The customer copy path survives beside it, gated off for system SMS.
  assert.match(inbound, /else if \(eventId && !consentKeyword && !systemSms[\s\S]{0,80}isReservedShopPhone\(from\)\)/)
  assert.match(inbound, /dedupeKey: `owner-sms-copy:\$\{sid\}`/)
  // The internal-test boundary still suppresses the owner copy.
  assert.match(inbound, /\[INTERNAL TEST\]/)
})

test("owner sms-only bodies keep the direct URL whole inside the 500-char cap", () => {
  const url = "https://shop.example.com/ops/leads/42#spike"
  const long = formatSmsBody({ title: "New text at the shop", body: "x".repeat(600), url, smsOnly: true })
  assert.ok(long.length <= 500)
  assert.ok(long.endsWith(` ${url}`), "the direct work-order URL must survive truncation")
  assert.ok(long.startsWith("New text at the shop: "), "the copy is truncated from its end, never the title")

  const short = formatSmsBody({ title: "New text at the shop", body: "Dana: On my way", url, smsOnly: true })
  assert.equal(short, "New text at the shop: Dana: On my way https://shop.example.com/ops/leads/42#spike")

  // Fallback SMS keeps the old cap-only shape: no URL appended, hard 500 cap.
  const fallback = formatSmsBody({ title: "New text at the shop", body: "x".repeat(600), url, smsOnly: false })
  assert.equal(fallback.length, 500)
  assert.ok(!fallback.includes(url))

  // The retry path reads the stored row; the shared formatter keeps outputs identical.
  const retry = formatSmsBody({ title: "New text at the shop", body: "Dana: On my way", url, smsOnly: true })
  assert.equal(retry, short)
})

test("sent Gmail promises preserve the numeric operator byline", () => {
  const gmail = source("app/api/ingest/gmail/route.ts")
  assert.match(gmail, /SELECT id FROM operators[\s\S]{0,220}lower\(email\) = lower\(\$\{from\}::text\)/)
  assert.match(gmail, /actorId: sent \? sentOperatorId \?\? ""/)
  assert.doesNotMatch(gmail, /actorId: sent \? "sales@"/)
})

test("payment never masquerades as job completion", () => {
  const gmail = source("app/api/ingest/gmail/route.ts")
  const wire = source("app/api/ops/wire/action/route.ts")
  const needs = source("lib/ops-data.ts")
  const people = source("lib/people.ts")
  assert.match(gmail, /status = CASE WHEN \$\{fullyPaid\}::boolean THEN 'won' ELSE status END/)
  assert.match(wire, /status = CASE WHEN \$\{fullyPaid\}::boolean THEN 'won' ELSE status END/)
  assert.doesNotMatch(gmail.slice(gmail.indexOf("async function ingestPayment"), gmail.indexOf("async function ingestDeposit")), /completed_at\s*=/)
  assert.match(needs, /l\.completed_at IS NULL AND l\.status NOT IN \('lost','spam'\)/)
  assert.match(people, /status = 'won' AND completed_at IS NULL/)
})

test("verified PAID rolls the monthly odometer and stays on the board until finished", () => {
  // C7 archived active-job-index; the board renders the same live-jobs query.
  const opsData = source("lib/ops-data.ts")
  const board = source("app/board/page.tsx")
  assert.match(opsData, /WHERE status = 'won' AND won_at >= date_trunc\('month', now\(\)\)/)
  assert.match(opsData, /l\.status = 'won' AND l\.completed_at IS NULL/)
  assert.match(board, /listBoardJobs\(/)
})

test("PAID receipts come only from verified payment ingestion", () => {
  // C7 retired the /ops home's PaidMoment strip; the ingestion-side receipt
  // wiring is the surviving guarantee.
  const gmail = source("app/api/ingest/gmail/route.ts")
  assert.match(gmail, /sourceEventId: paidEventId \|\| eventId/)
  assert.match(gmail, /sourceEventId: partialEventId \|\| eventId/)
  assert.match(gmail, /kind: "invoice\.payment-received"/)
})

test("DONE and peel-back atomically preserve their Wire receipts", () => {
  const actions = source("app/ops/actions.ts")
  assert.match(actions, /wire_receipts AS \([\s\S]{0,900}INSERT INTO notifications/)
  const undo = actions.slice(actions.indexOf("export async function undoLeadComplete"))
  assert.match(undo, /immutable_receipt AS \([\s\S]*undo_wire AS \(/)
  assert.match(actions, /completion-undo:/)
  assert.match(actions, /status_source_event_id = r\.id/)
})

test("all tracked SMS paths reject shop and forwarding numbers centrally", () => {
  const messages = source("lib/messages.ts")
  const workOrder = source("app/ops/leads/[id]/page.tsx")
  const promises = source("app/ops/leads/[id]/promise-actions.ts")
  assert.match(messages, /isReservedCustomerPhone\(to, reservedPhones\)/)
  assert.match(messages, /A real customer phone number is required/)
  assert.match(workOrder, /const hasCustomerPhone = Boolean\(lead\.phone && !lead\.phone_is_placeholder && !isReservedShopPhone\(lead\.phone\)\)/)
  assert.match(promises, /isReservedShopPhone\(lead\.phone\)/)
})

test("unmatched QuickBooks receipts bind invoice identity and trusted totals", () => {
  const wireAction = source("app/api/ops/wire/action/route.ts")
  assert.match(wireAction, /events\[0\]\.detail\.invoiceTotalCents/)
  assert.match(wireAction, /INSERT INTO invoice_identities/)
  assert.match(wireAction, /invoice_number = CASE WHEN invoice_number = ''/)
  assert.match(wireAction, /events\[0\]\.detail\.balanceCents === 0/)
})

test("full-trust GLASS is owner-only in UI and server actions", () => {
  const page = source("app/ops/leads/[id]/page.tsx")
  const actions = source("app/ops/leads/[id]/glass-actions.ts")
  assert.match(page, /operator\.role === "owner" && <GlassControl/)
  assert.equal((actions.match(/operator\.role !== "owner"/g) ?? []).length, 2)
})

test("customer email truth is intent, acceptance, then signed delivery", () => {
  const messageActions = source("app/ops/leads/[id]/message-actions.ts")
  const webhook = source("app/api/resend/webhook/route.ts")
  assert.ok(messageActions.indexOf("eventId = await recordEvent") < messageActions.indexOf("await sendEmailWithProviderTruth"), "email intent must persist before the provider handoff")
  assert.match(messageActions, /kind: "email\.accepted"/)
  assert.match(messageActions, /kind = definitive \? "email\.failed" : "email\.unknown"/)
  assert.match(webhook, /\.webhooks\.verify/)
  assert.match(webhook, /"email\.delivered"/)
  assert.match(webhook, /"email\.bounced"/)
  assert.match(webhook, /if \(!eventId\)[\s\S]{0,260}SELECT id FROM events/)
})

test("Wire one-tap actions claim durable work before external effects", () => {
  const wire = source("app/api/ops/wire/action/route.ts")
  const paperwork = source("app/ops/accounts/[id]/actions.ts")
  assert.match(wire, /action_status = 'processing'/)
  assert.ok(wire.indexOf("action_status = 'processing'") < wire.indexOf("await sendSmsPersisted"), "Wire action must claim before SMS")
  assert.ok(wire.indexOf("action_status = 'processing'") < wire.indexOf("await sendUsualPaperwork"), "Wire action must claim before email")
  assert.match(paperwork, /\^\[a-f0-9-\]\{36\}\$/i)
  assert.match(wire, /createHash\("sha256"\)\.update\(`wire:\$\{notificationId\}:paperwork`\)\.digest\("hex"\)/)
  assert.match(wire, /form\.set\("idempotencyKey", paperworkIntent\)/)
  assert.doesNotMatch(wire, /form\.set\("idempotencyKey", `wire:\$\{notificationId\}:paperwork`\)/)
  assert.match(wire, /action_status = 'done'/)
  assert.match(wire, /action_status = 'failed'/)
})

test("DONE captions are AI-separated, DLP checked, and revisioned", () => {
  const actions = source("app/ops/actions.ts")
  const extract = source("lib/extract.ts")
  assert.doesNotMatch(actions, /glass_caption_draft\s*=\s*\$\{note/)
  assert.match(extract, /For an active closeout receipt only \(job\.completed or a linked closeout note\)/)
  assert.match(extract, /sourceAddendumEventId/)
  assert.match(extract, /glass_caption_revisions/)
  assert.match(extract, /glass_clean_approvals >= 10/)
  assert.match(extract, /caption[\s\S]{0,220}unsafe/)
})

test("GLASS exposes only an owner-selected primary delivery promise", () => {
  const promiseActions = source("app/ops/leads/[id]/promise-actions.ts")
  const glass = source("lib/glass.ts")
  const migration = source("scripts/migrate.mjs")
  assert.match(promiseActions, /glass_primary = true, visible_on_glass = true/)
  assert.match(promiseActions, /operator\.role !== "owner"/)
  assert.match(glass, /c\.glass_primary = true AND c\.status = 'open'/)
  assert.match(migration, /commitments_one_public_promise_idx/)
})

test("Gmail threads never drift between concurrent RFQs and retries resume", () => {
  const gmail = source("app/api/ingest/gmail/route.ts")
  const migration = source("scripts/migrate.mjs")
  assert.match(migration, /CREATE TABLE IF NOT EXISTS external_threads/)
  assert.ok(gmail.indexOf("FROM external_threads") < gmail.indexOf(": await resolveEmailConversation"), "known Gmail thread must resolve before recency")
  assert.match(gmail, /SELECT id FROM events WHERE kind = \$\{kind\}/)
  assert.match(gmail, /Email receipt could not be resumed/)
})

test("identity races, private attachments, and closed GLASS fail safely", () => {
  const people = source("lib/people.ts")
  const migration = source("scripts/migrate.mjs")
  const visibility = source("lib/visibility.ts")
  const photo = source("app/api/glass/photo/route.ts")
  assert.match(migration, /PRIMARY KEY \(kind, value, is_test\)/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS person_identity_conflicts/)
  assert.match(people, /existing\.length > 1/)
  assert.match(people, /new Set\(priorWinners\)\.size > 1/)
  assert.match(people, /ON CONFLICT \(kind, value, is_test\) DO NOTHING/)
  assert.match(visibility, /CREW_SAFE_CLAIM_PREDICATES/)
  assert.match(visibility, /sensitivity === "drawing"/)
  assert.match(photo, /job\.status === "closed"/)
})

test("time, transcript, and activity windows preserve current truth", () => {
  const brief = source("app/api/ops/brief/route.ts")
  const calls = source("lib/calls.ts")
  const messages = source("lib/messages.ts")
  const events = source("lib/events.ts")
  assert.match(brief, /timeZone: "America\/Chicago"/)
  assert.match(brief, /6:30 AM-noon America\/Chicago recovery window/)
  assert.match(brief, /brief_audio_status = 'submitting'/)
  assert.match(calls, /ORDER BY started_at DESC, id DESC LIMIT 200\) recent ORDER BY started_at ASC/)
  assert.match(messages, /ORDER BY sent_at DESC, id DESC LIMIT 300[\s\S]{0,80}recent ORDER BY sent_at ASC/)
  assert.match(events, /ORDER BY occurred_at DESC, id DESC[\s\S]{0,120}recent ORDER BY occurred_at ASC/)
})

test("deployed schedulers preserve cost-aware Gmail cadence and both Central brief offsets", () => {
  const gmailWorkflow = source(".github/workflows/gmail-sync.yml")
  const remindersWorkflow = source(".github/workflows/follow-up-reminders.yml")
  const briefWorkflow = source(".github/workflows/morning-brief.yml")
  assert.match(gmailWorkflow, /cron: "5,20,35,50 12-23 \* \* \*"/)
  assert.match(gmailWorkflow, /cron: "5 0-11 \* \* \*"/)
  assert.doesNotMatch(gmailWorkflow, /cron: "\*\/5 \* \* \* \*"/)
  assert.match(gmailWorkflow, /api\/ingest\/gmail/)
  assert.match(remindersWorkflow, /cron: "5,20,35,50 12-23 \* \* \*"/)
  assert.match(remindersWorkflow, /cron: "5 0-11 \* \* \*"/)
  assert.match(remindersWorkflow, /jq -e '\.ok == true'/)
  assert.match(briefWorkflow, /cron: "30 11,12 \* \* \*"/)
  assert.match(briefWorkflow, /api\/ops\/brief/)
  assert.doesNotMatch(gmailWorkflow, /echo "\$body"/)
  assert.doesNotMatch(remindersWorkflow, /echo "\$body"/)
  assert.doesNotMatch(briefWorkflow, /echo "\$body"/)
})

test("bounded recovery has a daily catch-up, an honest lease, and safe opportunistic triggers", () => {
  const migration = source("scripts/migrate.mjs")
  const recovery = source("lib/recovery-sweep.ts")
  const reminders = source("app/api/ops/reminders/route.ts")
  const board = source("app/board/page.tsx")
  const action = source("app/board/recovery-actions.ts")
  const menu = source("app/ops/more-menu.tsx")
  const sms = source("app/api/twilio/sms/route.ts")
  const voice = source("app/api/twilio/voice-status/route.ts")
  const vercel = JSON.parse(source("vercel.json"))

  assert.match(migration, /CREATE TABLE IF NOT EXISTS automation_leases/)
  assert.match(migration, /holder TEXT NOT NULL/)
  assert.match(migration, /lease_expires_at TIMESTAMPTZ NOT NULL/)
  assert.match(migration, /last_finished_at TIMESTAMPTZ/)
  assert.match(recovery, /automation_leases\.lease_expires_at <= now\(\)/)
  assert.match(recovery, /\$\{force\}::boolean OR automation_leases\.last_finished_at IS NULL/)
  assert.match(recovery, /last_finished_at <= now\(\) - interval '10 minutes'/)
  assert.match(recovery, /now\(\) \+ interval '15 minutes'/)
  assert.match(recovery, /WHERE key = \$\{RECOVERY_LEASE_KEY\}::text AND holder = \$\{holder\}::text/)
  assert.match(recovery, /UPDATE automation_leases[\s\S]{0,320}RETURNING key/)
  assert.match(recovery, /if \(!rows\[0\]\) throw new Error\("Recovery lease ownership was lost before release\."\)/)

  const skippedReturn = recovery.indexOf('reason: "lease-active-or-recent"')
  const runLog = recovery.indexOf("INSERT INTO automation_runs")
  assert.ok(skippedReturn >= 0 && skippedReturn < runLog, "a skipped lease must return before automation freshness is logged")
  assert.ok(recovery.indexOf("await releaseRecoveryLease(holder)") < runLog, "lease release truth must be known before the automation result is logged")
  assert.doesNotMatch(reminders, /INSERT INTO automation_runs/)
  assert.match(reminders, /runRecoverySweep\(\{ trigger/)

  for (const reconciler of [
    "retryPendingAttachments", "retryCallTranscriptions", "retryVoiceTranscriptions",
    "reconcileStaleSmsIntents", "reconcileRawInboundCalls", "reconcileStaleCallIntakes",
    "reconcileStaleOutboundCalls", "reconcileStaleCommitmentReschedules",
    "reconcileGlassUploads", "retryPendingInterrupts",
  ]) assert.match(recovery, new RegExp(`${reconciler}\\(\\)`))

  assert.ok(vercel.crons.some((cron) => cron.path === "/api/ops/reminders" && cron.schedule === "15 13 * * *"))
  assert.match(board, /operator\.role === "owner"[\s\S]{0,220}after\([\s\S]{0,300}trigger: "owner-board"/)
  assert.match(action, /operator\.role !== "owner"/)
  assert.match(action, /trigger: "owner-manual", force: true/)
  assert.match(menu, /role === "owner" && <RecoveryControl/)

  assert.ok(sms.indexOf("const { params, valid } = await readTwilioForm(req)") < sms.indexOf('trigger: "twilio-sms"'))
  assert.match(sms, /eventId && !consentKeyword && !systemSms && !conversation\.person\?\.is_test[\s\S]{0,180}after\([\s\S]{0,220}trigger: "twilio-sms"/)
  assert.ok(voice.indexOf("if (!valid) return twiml(\"\", 403)") < voice.indexOf('trigger: "twilio-call"'))
  assert.match(voice, /SELECT is_test FROM people WHERE id = calls\.person_id/)
  assert.match(voice, /call\.is_test = call\.is_test \|\| prepared\.person\.is_test/)
  assert.match(voice, /call\.is_test = call\.is_test \|\| Boolean\(prepared\.person\?\.is_test \|\| prepared\.draft\.is_test\)/)
  assert.match(voice, /if \(call && !call\.is_test\)[\s\S]{0,180}after\([\s\S]{0,220}trigger: "twilio-call"/)
})

test("existing push endpoints rebind to the punched-in operator", () => {
  const push = source("app/ops/push-toggle.tsx")
  const migration = source("scripts/migrate.mjs")
  assert.match(push, /if \(subscription\)[\s\S]{0,300}fetch\("\/api\/ops\/push"/)
  assert.match(migration, /UPDATE push_subscriptions SET operator_id/)
})

test("provider response loss is quarantined while definitive rejection is retryable", () => {
  const twilio = source("lib/twilio.ts")
  const messages = source("lib/messages.ts")
  const promise = source("app/ops/leads/[id]/promise-actions.ts")
  const glass = source("lib/glass-delivery.ts")
  assert.match(twilio, /TwilioProviderError[\s\S]*definitive/)
  assert.match(messages, /definitive \? "failed" : "unknown"/)
  assert.match(promise, /status === "unknown"[\s\S]*Check Calls & Messages/)
  assert.match(promise, /:attempt:\$\{attempt\[0\]\.attempts\}/)
  assert.match(glass, /send_status IN \('pending','failed','sending'\)/)
  assert.match(glass, /send_status = \$\{isDefinitiveTwilioError\(error\) \? "failed" : "unknown"\}/)
})

test("customer-controlled SVG can never execute from the CRM origin", () => {
  const media = source("lib/media-safety.ts")
  const retry = source("lib/attachment-retry.ts")
  const attachment = source("app/api/ops/attachment/route.ts")
  const photo = source("app/api/ops/photo/route.ts")
  const glassPhoto = source("app/api/glass/photo/route.ts")
  assert.doesNotMatch(media, /image\/svg/)
  assert.match(retry, /if \(isSafeRasterImage\(contentType\)\) return "photo"/)
  for (const route of [attachment, photo, glassPhoto]) {
    assert.match(route, /isSafeRasterImage/)
    assert.match(route, /X-Content-Type-Options/)
    assert.match(route, /Content-Security-Policy/)
  }
})

test("private callers cannot starve raw-call recovery", () => {
  const ingest = source("lib/ingest.ts")
  const intake = source("lib/job-intake.ts")
  assert.match(ingest, /detail->>'reconciliationHandled'/)
  assert.match(ingest, /await prepareInboundCallIntake\(/)
  assert.match(intake, /const person = phone\s*\? await findOrCreatePerson[\s\S]*?: null/)
  assert.match(intake, /"Private caller"/)
  assert.match(intake, /reconciliationHandled: true/)
  assert.match(intake, /reconciliationOutcome: "call-draft"/)
  assert.doesNotMatch(intake, /if \(!phone\) throw/)
})

test("late call enrichment reattaches missed-call and auto-reply receipts", () => {
  const artifacts = source("lib/call-artifacts.ts")
  const intake = source("lib/job-intake.ts")
  assert.match(artifacts, /export async function attachRecoveredCallArtifacts/)
  assert.match(artifacts, /e\.detail->>'callSid' = \$\{callSid\}::text/)
  assert.match(artifacts, /idempotency_key = \$\{`missed-call:\$\{callSid\}:auto-reply`\}/)
  assert.match(artifacts, /UPDATE notifications n SET url = \$\{`\/ops\/leads\/\$\{leadId\}#spike`\}/)
  assert.ok((intake.match(/await attachRecoveredCallArtifacts\(/g) ?? []).length >= 3, "existing, saved, and reconciled calls must all attach early receipts")
})

test("answered calls and transcripts survive status-before-enrichment ordering", () => {
  const artifacts = source("lib/call-artifacts.ts")
  const recording = source("app/api/twilio/recording/route.ts")
  const transcript = source("app/api/twilio/transcript/route.ts")
  const extract = source("lib/extract.ts")
  assert.match(artifacts, /\["answered", "completed"\]\.includes\(call\.status\)/)
  assert.match(artifacts, /externalId: `\$\{callSid\}:answered`/)
  assert.match(artifacts, /first_response_at = COALESCE\(first_response_at, now\(\)\)/)
  assert.match(artifacts, /e\.kind = 'call\.transcript'.*e\.lead_id IS NULL THEN NULL/s)
  assert.match(recording, /detail: \{ callSid, isTest: rows\[0\]\.is_test \}/)
  assert.doesNotMatch(recording, /recording_sid IS DISTINCT FROM/)
  assert.match(recording, /WHEN recording_sid = \$\{recordingSid\}::text THEN transcript_status/)
  assert.match(transcript, /isTest: existing\[0\]\?\.is_test \?\? false/)
  assert.match(extract, /event\.detail\?\.isTest/)
})

test("status-before-enrichment cannot buzz or text for an INTERNAL TEST call", () => {
  const voice = source("app/api/twilio/voice/route.ts")
  const status = source("app/api/twilio/voice-status/route.ts")
  assert.match(voice, /privateCaller: !normalizePhone\(from\), isTest: isTestCall/)
  assert.match(status, /calls\.detail->>'isTest'/)
  assert.match(status, /calls\.detail->>'callerName'/)
  assert.match(status, /if \(!eventId \|\| call\.is_test\) return twiml\(""\)/)
})

test("signed provider callbacks resume every projection after an inserted receipt", () => {
  const inboundSms = source("app/api/twilio/sms/route.ts")
  const sms = source("app/api/twilio/sms-status/route.ts")
  const recording = source("app/api/twilio/recording/route.ts")
  const resend = source("app/api/resend/webhook/route.ts")
  const voice = source("app/api/twilio/voice-status/route.ts")
  const outbound = source("app/api/twilio/outbound-status/route.ts")
  assert.match(inboundSms, /let eventId = await recordEvent/)
  assert.doesNotMatch(inboundSms, /inserted\[0\] \? await recordEvent/)
  assert.ok(sms.indexOf("UPDATE messages SET") < sms.indexOf("let eventId = await recordEvent"))
  assert.match(sms, /WHEN twilio_sid LIKE 'pending:%' AND \$\{status\}::text IN/)
  assert.match(sms, /id = \$\{intentId\}::bigint AND twilio_sid LIKE 'pending:%'/)
  assert.match(sms, /if \(!eventId\)[\s\S]{0,260}kind = 'sms\.failed'/)
  assert.match(resend, /if \(!eventId\)[\s\S]{0,300}SELECT id FROM events/)
  assert.doesNotMatch(voice, /if \(eventId\)[\s\S]{0,200}UPDATE leads/)
  assert.doesNotMatch(outbound, /if \(eventId\)[\s\S]{0,200}UPDATE leads/)
  assert.ok(voice.indexOf("await recordEvent") < voice.indexOf("UPDATE leads SET"))
  assert.ok(outbound.indexOf("await recordEvent") < outbound.indexOf("UPDATE leads SET"))
  assert.doesNotMatch(recording, /recording_sid IS DISTINCT FROM/)
  assert.ok(recording.indexOf("UPDATE calls SET") < recording.indexOf("await recordEvent"))
})

test("stale provider claims become visible unknown receipts without automatic repeats", () => {
  const calls = source("lib/calls.ts")
  const commitments = source("lib/commitments.ts")
  const glass = source("lib/glass-delivery.ts")
  const recovery = source("lib/recovery-sweep.ts")
  const migration = source("scripts/migrate.mjs")
  assert.match(calls, /status = 'starting'[\s\S]{0,160}interval '10 minutes'/)
  assert.match(calls, /kind: "call\.out\.unknown"/)
  assert.match(commitments, /status = 'sending'[\s\S]{0,160}interval '10 minutes'/)
  assert.match(commitments, /kind: "commitment\.reschedule-unknown"/)
  assert.match(glass, /send_status IN \('pending','failed','sending'\)/)
  assert.match(glass, /send_claimed_at < now\(\) - interval '5 minutes'/)
  assert.match(migration, /commitment_reschedules ADD COLUMN IF NOT EXISTS sending_started_at/)
  assert.match(recovery, /reconcileStaleOutboundCalls\(\)/)
  assert.match(recovery, /reconcileStaleCommitmentReschedules\(\)/)
})

test("GLASS corrections and Gmail test threads resume without crossing partitions", () => {
  const correction = source("app/j/[token]/correct/route.ts")
  const glassPage = source("app/j/[token]/page.tsx")
  const gmail = source("app/api/ingest/gmail/route.ts")
  const notify = source("lib/notify.ts")
  assert.match(correction, /if \(!eventId\)[\s\S]{0,300}glass\.correction/)
  assert.match(correction, /sourceEventId: eventId/)
  assert.match(gmail, /JOIN leads l ON l\.id = et\.lead_id/)
  assert.match(gmail, /l\.is_test = \$\{isTest\}::boolean/)
  assert.match(gmail, /deliveryStatus: sent \? "delivered" : null, isTest/)
  assert.match(glassPage, /if \(!eventId\)[\s\S]{0,300}glass\.view/)
  assert.match(glassPage, /daily_view_count\) >= 3/)
  assert.match(notify, /COALESCE\(l\.is_test, false\)[\s\S]{0,140}COALESCE\(p\.is_test, false\)[\s\S]{0,140}detail->>'isTest'/)
})

test("account successors keep their exact tracked reply channel", () => {
  const account = source("app/ops/accounts/[id]/page.tsx")
  const workOrder = source("app/ops/leads/[id]/page.tsx")
  const reply = source("app/ops/leads/[id]/message-actions.ts")
  assert.match(account, /replyTo=\$\{activeContact\.id\}&replyChannel=/)
  assert.match(account, /replyChannel=email#spike/)
  assert.match(workOrder, /target\.emails\[1\] AS email/)
  assert.match(reply, /replyEmail = targets\[0\]\.email/)
})

test("Punch Rack and GLASS deterministic secrets fail closed below 32 bytes", () => {
  const operators = source("lib/operators.ts")
  const glass = source("lib/glass.ts")
  const health = source("app/api/health/route.ts")
  assert.match(operators, /Buffer\.byteLength\(secret, "utf8"\) < 32/)
  assert.match(glass, /Buffer\.byteLength\(secret, "utf8"\) < 32/)
  assert.equal((health.match(/Buffer\.byteLength\([^\n]+>= 32/g) ?? []).length, 3)
  const auth = source("lib/ops-auth.ts")
  assert.match(auth, /createHmac\("sha256", secret\)\.update\(`sms-login:\$\{phone\}:\$\{code\}`\)/)
  assert.match(auth, /Buffer\.byteLength\(secret, "utf8"\) < 32/)
  assert.doesNotMatch(auth, /hashToken\(`\$\{(?:operator\.cell_phone|phone)\}:\$\{code\}`\)/)
})

test("cron and Deepgram callbacks reject weak shared secrets", () => {
  const auth = source("lib/ops-auth.ts")
  const calls = source("lib/call-transcription.ts")
  const transcript = source("app/api/twilio/transcript/route.ts")
  assert.match(auth, /Buffer\.byteLength\(secret, "utf8"\) < 32/)
  assert.match(calls, /DEEPGRAM_CALLBACK_SECRET[\s\S]{0,120}>= 32/)
  assert.match(calls, /AND transcript_status = 'submitting'/)
  assert.match(calls, /\["ready", "empty"\]\.includes/)
  assert.match(transcript, /deepgramCallbackSecretConfigured\(\)/)
})

test("the board never hides paid work that has not been finished", () => {
  const opsData = source("lib/ops-data.ts")
  assert.match(opsData, /l\.status = 'won' AND l\.completed_at IS NULL/)
})

test("Ask Jobs answers save into a bounded role-scoped source list", () => {
  const migration = source("scripts/migrate.mjs")
  const route = source("app/api/ops/handset-slips/route.ts")
  const dock = source("app/ops/shop-dock.tsx")
  assert.match(migration, /CREATE TABLE IF NOT EXISTS handset_slips/)
  assert.match(route, /operator_id = \$\{operator\.id\}::bigint AND operator_role = \$\{operator\.role\}::text/)
  assert.match(route, /ORDER BY id DESC LIMIT 5/)
  assert.match(dock, /Clear answer/)
  assert.match(dock, /Saved answers/)
  assert.match(dock, /\/api\/ops\/receipts\?ids=/)
})

test("GLASS never labels an internal estimate as an approved quote", () => {
  const glass = source("app/j/[token]/page.tsx")
  const invariants = source("lib/shop-brain-invariants.mjs")
  assert.match(glass, /job\.quoted_at && job\.estimate_value_cents/)
  assert.doesNotMatch(invariants, /estimate_value_cents/)
})

test("owner can kill or rotate a GLASS bearer and Gmail junk never becomes work", () => {
  const glass = source("lib/glass.ts")
  const actions = source("app/ops/leads/[id]/glass-actions.ts")
  const control = source("app/ops/leads/[id]/glass-control.tsx")
  const gmail = source("app/api/ingest/gmail/route.ts")
  assert.match(glass, /export async function rotateGlassLink/)
  assert.match(glass, /'glass\.rotated'::text[\s\S]{0,900}UPDATE glass_links SET revoked_at[\s\S]{0,900}INSERT INTO glass_links/)
  assert.match(glass, /export async function revokeGlassLinks/)
  assert.match(glass, /'glass\.revoked'::text[\s\S]{0,700}UPDATE glass_links SET revoked_at/)
  assert.match(actions, /operator\.role !== "owner"/)
  assert.match(control, /Replace link/)
  assert.match(control, /Close Customer Page/)
  assert.match(gmail, /"SPAM", "TRASH"/)
  assert.match(gmail, /label === "DRAFT" && !sent/)
})

test("quote handoff and manual GLASS reuse one resumable bearer", () => {
  const glass = source("lib/glass.ts")
  const actions = source("app/ops/actions.ts")
  const glassActions = source("app/ops/leads/[id]/glass-actions.ts")
  assert.match(glass, /createOrReuseQuoteGlassLink/)
  assert.match(glass, /SELECT token_hash, token_nonce FROM glass_links/)
  assert.match(glass, /hashGlassToken\(token\) !== active\[0\]\.token_hash/)
  assert.match(actions, /createOrReuseQuoteGlassLink\(leadId, operator\.id\)/)
  assert.match(glassActions, /createOrReuseQuoteGlassLink\(leadId, operator\.id\)/)
})

test("DONE voice addenda remain playable from their receipt", () => {
  const voice = source("app/api/ops/voice-note/route.ts")
  const capture = source("app/ops/voice-capture-button.tsx")
  const done = source("app/ops/leads/[id]/done-stamp.tsx")
  const actions = source("app/ops/actions.ts")
  assert.match(voice, /ARRAY\['job\.completed','note\.voice'\]/)
  assert.match(voice, /detail->>'voicePath'/)
  assert.match(capture, /onTranscript: \(transcript: string, intentId\?: string\)/)
  assert.match(done, /name="voiceIntentId" value=\{voiceIntentId\}/)
  assert.match(actions, /FROM voice_transcription_intents[\s\S]{0,260}recovery_key = \$\{`closeout:\$\{leadId\}`\}/)
  assert.match(actions, /FROM voice_transcription_intents[\s\S]{0,260}recovery_key = \$\{`done:\$\{leadId\}`\}/)
  assert.match(actions, /recoveredVoiceIntentId/)
})

test("voice capture persists audio locally before upload and never calls a missing intent safe", () => {
  const voice = source("app/ops/voice-capture-button.tsx")
  assert.match(voice, /indexedDB\.open\(VOICE_DB, 1\)/)
  assert.match(voice, /await saveVoiceIntent\([\s\S]{0,220}localStorage\.setItem/)
  assert.ok(voice.indexOf("await saveVoiceIntent") < voice.indexOf("response = await uploadSavedVoice"))
  assert.match(voice, /response\.status === 404 && saved && !resubmitted/)
  assert.match(voice, /catch \{[\s\S]{0,100}resubmitted = false[\s\S]{0,80}continue/)
  assert.match(voice, /if \(!serverHasIntent\) throw new Error\("That voice note never reached the shop/)
  assert.match(voice, /const pendingId = window\.localStorage\.getItem\(storageKey\)[\s\S]{0,500}await recoverTranscript\(pendingId\)[\s\S]{0,500}return/)
  assert.match(voice, /await deleteVoiceIntent/)
})

test("Swipe to Finish keeps the closeout cue and one-tap photo", () => {
  const done = source("app/ops/leads/[id]/done-stamp.tsx")
  assert.match(done, /SpeechSynthesisUtterance\("Say what you did\."\)/)
  assert.match(done, /navigator\.vibrate/)
  assert.match(done, /swipeFinishDecision/)
  assert.match(done, /Press again to finish/)
  assert.match(done, /files\?\.length[\s\S]{0,120}requestSubmit\(\)/)
})

test("the paperwork envelope addresses the exact active contact with email", () => {
  const account = source("app/ops/accounts/[id]/page.tsx")
  assert.match(account, /const paperworkContact = account\.people\.find\(\(person\) => person\.status === "active" && person\.emails\?\.\[0\]\)/)
  assert.match(account, /name="personId" value=\{paperworkContact\?\.id/)
  assert.match(account, /paperworkContact \? <PaperworkSubmit \/>/)
})
