import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("inline job receipts defer interpretation and Undo is a guarded durable transition", () => {
  const actions = source("app/ops/intake/actions.ts")
  const intake = source("lib/job-intake.ts")
  const manual = source("app/ops/actions.ts")
  const view = source("app/ops/intake/inline-job-intake.tsx")

  assert.match(actions, /saveCallDraftRecord\(formData, \{ deferExtraction: true \}\)/)
  assert.match(actions, /createManualLeadRecord\(formData, \{ deferExtraction: true \}\)/)
  assert.match(actions, /\^\[a-zA-Z0-9_-\]\{12,80\}\$/)
  assert.match(manual, /extraction_next_attempt_at = now\(\) \+ interval '11 minutes'/)
  assert.match(intake, /status = ANY\(ARRAY\['pending','failed','unknown'\]::text\[\]\)[\s\S]{0,80}RETURNING id, save_started_at/)
  assert.doesNotMatch(intake.slice(intake.indexOf("export async function dismissInboundCallDraft"), intake.indexOf("export async function restoreInboundCallDraft")), /'saving'/)
  assert.match(intake, /FOR UPDATE OF l, d, call_row/)
  assert.match(intake, /UPDATE calls c SET\s+lead_id = NULL/)
  assert.match(intake, /status_reason = 'Intake undone'/)
  assert.match(intake, /NOT EXISTS \(\s*SELECT 1 FROM commitments c WHERE c\.lead_id = l\.id/)
  assert.match(intake, /NOT EXISTS \(\s*SELECT 1 FROM claims c/)
  assert.match(intake, /intakeUndoDeferred/)
  assert.match(view, /Job saved/)
  assert.match(view, /undoInlineJobAction/)
  // The receipt is pinned by where the link goes and what it says; the class
  // moved to the board vocabulary when the legacy sheets were retired.
  assert.match(view, /<Link className="[^"]*" href=\{`\/ops\/leads\/\$\{savedJob\.leadId\}`\}>[\s\S]{0,100}Open job to call or text/)
})

test("website quote retries reuse one lead, one provider intent, one alert, and deterministic photos", () => {
  const client = source("components/mainstreet-contact.tsx")
  const quote = source("app/api/quote/route.ts")
  const leads = source("lib/leads.ts")

  assert.match(client, /const intakeKeyRef = useRef\(""\)/)
  assert.match(client, /if \(!intakeKeyRef\.current\) intakeKeyRef\.current = crypto\.randomUUID\(\)/)
  assert.ok(client.indexOf('intakeKeyRef.current = ""') > client.indexOf("if (!response.ok)"))
  assert.match(quote, /intakeKey: `website:\$\{intakeKey\}`/)
  assert.match(quote, /idempotencyKey: input\.intent/)
  assert.match(quote, /intent: `quote-owner:\$\{intakeKey\}`/)
  assert.match(quote, /intent: `quote-customer:\$\{intakeKey\}`/)
  assert.match(quote, /addRandomSuffix: false,[\s\S]{0,80}allowOverwrite: true/)
  assert.match(quote, /dedupeKey: `quote-intake:\$\{intakeKey\}:new-lead`/)
  assert.match(quote, /if \(lead\.reused\)[\s\S]{0,900}status: 409/)
  assert.match(leads, /WHERE intake_key = \$\{intakeKey\}::text/)
  assert.match(leads, /quote-consent:\$\{publicId\}/)
  assert.match(leads, /normalizePhone\(existingSnapshot\.phone\) !== webTextConsent\.phoneE164/)
})

test("email acceptance, uncertainty, and signed callbacks remain distinct", () => {
  const quote = source("app/api/quote/route.ts")
  const operatorEmail = source("app/ops/actions.ts")
  const webhook = source("app/api/resend/webhook/route.ts")
  const leads = source("lib/leads.ts")

  assert.match(quote, /kind: "email\.out"[\s\S]{0,600}deliveryStatus: "pending"/)
  assert.ok(quote.indexOf('kind: "email.out"') < quote.indexOf("input.resend.emails.send"))
  assert.match(quote, /kind: "email\.accepted"/)
  assert.match(quote, /kind: "email\.unknown"/)
  assert.match(operatorEmail, /recordDeliveryProblem\("email\.unknown", message\)/)
  assert.match(leads, /WHEN email_delivery_status = ANY\(ARRAY\['failed','sent','delivered'\]::text\[\]\) THEN email_delivery_status/)

  assert.match(webhook, /webhooks\.verify/)
  assert.match(webhook, /status: 503, headers: \{ "Retry-After": "15" \}/)
  assert.match(webhook, /accepted\[0\]\.audience === "shop"/)
  assert.match(webhook, /WHEN email_delivery_status = 'failed' OR \$\{failed\}::boolean THEN 'failed'/)
  assert.match(webhook, /WHEN email_delivery_status = ANY\(ARRAY\['sent','delivered'\]::text\[\]\) THEN email_delivery_status/)
  assert.match(webhook, /WHEN \$\{!failed && !delayed\}::boolean THEN 'delivered'/)
  assert.match(webhook, /email_delivered_at = CASE[\s\S]{0,180}COALESCE\(email_delivered_at, now\(\)\)/)
  assert.match(webhook, /if \(!eventId\)[\s\S]{0,240}SELECT id FROM events/)
  assert.match(webhook, /dedupeKey: `resend-failure:\$\{webhook\.data\.email_id\}`/)
})
