import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  EmailProviderError,
  sendEmailWithProviderTruth,
  strongestEmailReceiptStatus,
} from "../lib/email-provider-truth.mjs"
import { resumeSmsProjection } from "../lib/sms-provider-truth.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("email provider results distinguish rejection from response loss", async () => {
  await assert.rejects(
    sendEmailWithProviderTruth(async () => ({ data: null, error: { message: "Recipient rejected" } })),
    (error) => error instanceof EmailProviderError && error.definitive && error.message === "Recipient rejected",
  )
  await assert.rejects(
    sendEmailWithProviderTruth(async () => { throw new Error("socket closed") }),
    (error) => error instanceof EmailProviderError && !error.definitive && error.message === "socket closed",
  )
  await assert.rejects(
    sendEmailWithProviderTruth(async () => ({ data: null, error: null })),
    (error) => error instanceof EmailProviderError && !error.definitive,
  )
  assert.deepEqual(
    await sendEmailWithProviderTruth(async () => ({ data: { id: "email-receipt-1" }, error: null })),
    { id: "email-receipt-1" },
  )
  assert.equal(strongestEmailReceiptStatus([{ kind: "email.accepted" }, { kind: "email.unknown" }]), "accepted")
  assert.equal(strongestEmailReceiptStatus([{ kind: "email.unknown" }, { kind: "email.delivered" }]), "delivered")
  assert.equal(strongestEmailReceiptStatus([{ kind: "email.accepted" }, { kind: "email.failed" }]), "accepted")
  assert.equal(strongestEmailReceiptStatus([{ kind: "email.accepted" }, { kind: "email.failed", providerType: "email.bounced" }]), "failed")
})

test("lead replies and paperwork quarantine ambiguous email handoffs", () => {
  const reply = source("app/ops/leads/[id]/message-actions.ts")
  const paperwork = source("app/ops/accounts/[id]/actions.ts")
  const workOrder = source("app/ops/leads/[id]/page.tsx")
  const language = source("lib/shop-language.ts")
  const visibility = source("lib/visibility.ts")

  for (const outbound of [reply, paperwork]) {
    assert.match(outbound, /sendEmailWithProviderTruth/)
    assert.match(outbound, /isDefinitiveEmailProviderError/)
    assert.match(outbound, /strongestEmailReceiptStatus/)
    assert.match(outbound, /definitive \? "email\.failed" : "email\.unknown"/)
    assert.match(outbound, /kind = ANY\(ARRAY\['email\.accepted','email\.delivered','email\.failed','email\.unknown'\]::text\[\]\)/)
  }
  assert.match(reply, /receiptStatus === "unknown"[^\n]*may have accepted/i)
  assert.match(paperwork, /receiptStatus === "unknown"[^\n]*may have accepted/i)
  assert.match(workOrder, /strongestEmailReceiptStatus/)
  assert.match(workOrder, /providerType: typeof event\.detail\?\.providerType === "string"/)
  assert.match(paperwork, /reload the account envelope to file a fresh attempt/i)
  assert.match(paperwork, /requestedKey/)
  assert.match(language, /"email\.unknown": "Shop email needs checking"/)
  assert.match(language, /unknown: "Check before retrying"/)
  assert.match(visibility, /\["email\.accepted", "email\.failed", "email\.unknown", "email\.delivered"\]\.includes\(event\.kind\)/)
})

test("signed inbound SMS files raw provider truth before resumable projections", () => {
  const inbound = source("app/api/twilio/sms/route.ts")
  const signature = inbound.indexOf("await readTwilioForm(req)")
  const destination = inbound.indexOf("if (!isConfiguredTwilioNumber(to))")
  const rawInsert = inbound.indexOf("INSERT INTO messages")
  const conversation = inbound.indexOf("await resolvePhoneConversation")
  const consent = inbound.indexOf("await recordMessagingConsent({")
  const projectionLink = inbound.indexOf("UPDATE messages SET lead_id")
  const eventProjection = inbound.indexOf("let eventId = await recordEvent")

  assert.ok(signature >= 0 && signature < rawInsert, "provider signature verification must precede persistence")
  assert.ok(destination >= 0 && destination < rawInsert, "configured destination validation must precede persistence")
  assert.ok(rawInsert > 0 && rawInsert < conversation, "signed raw receipt must precede conversation resolution")
  assert.ok(rawInsert < consent, "signed raw receipt must precede consent projection")
  assert.match(inbound, /ON CONFLICT \(twilio_sid\) DO NOTHING[\s\S]{0,400}SELECT id, lead_id, person_id FROM messages WHERE twilio_sid/)
  assert.match(inbound, /SELECT id, lead_id, person_id FROM messages WHERE twilio_sid/)
  assert.ok(inbound.indexOf("const conversation = persistedProjection") < conversation, "a duplicate must prefer its persisted projection")
  assert.match(inbound, /createdLead: persistedCreatedLead/)
  assert.match(inbound, /'received',[\s\S]{0,120}NULL::bigint, NULL::bigint/)
  assert.ok(projectionLink > conversation && projectionLink < eventProjection, "conversation links must resume before the immutable event projection")
  assert.ok(projectionLink < consent, "the chosen conversation must persist before consent projection")
  assert.match(inbound, /UPDATE messages SET lead_id = COALESCE\(lead_id, \$\{conversation\.leadId \?\? null\}::bigint\)/)
  assert.doesNotMatch(inbound, /if \(!inserted\[0\]\) return twiml/)

  assert.deepEqual(
    resumeSmsProjection({
      messageReceipt: { leadId: 41, personId: 7 },
      priorEvent: { leadId: 41, personId: 7, createdLead: true },
    }),
    { projected: true, leadId: 41, personId: 7, createdLead: true },
  )
  assert.deepEqual(
    resumeSmsProjection({ messageReceipt: { leadId: 41, personId: 7 }, priorEvent: null }),
    { projected: true, leadId: 41, personId: 7, createdLead: false },
    "a crash after linking must resume the original job without resolving again",
  )
  assert.deepEqual(
    resumeSmsProjection({ messageReceipt: { leadId: null, personId: null }, priorEvent: null }),
    { projected: false, leadId: null, personId: null, createdLead: false },
    "a crash immediately after the raw insert must resume conversation resolution",
  )
  assert.deepEqual(
    resumeSmsProjection({ messageReceipt: { leadId: null, personId: null }, priorEvent: { leadId: null, personId: null, createdLead: false } }),
    { projected: true, leadId: null, personId: null, createdLead: false },
    "a completed system or unmatched-consent projection must not be reinterpreted later",
  )
})
