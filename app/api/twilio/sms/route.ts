import { after } from "next/server"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { resolvePhoneConversation } from "@/lib/ingest"
import { notifyAll, notifyOwnerCellSms } from "@/lib/notify"
import { findPersonByPhone, findRecentOpenLeadForPerson, isReservedShopPhone } from "@/lib/people"
import { isConfiguredTwilioNumber, readTwilioForm, twilioSmsWebhookConfigured, twilioWebhookBaseUrl, twiml } from "@/lib/twilio"
import { isMetaVerificationSms, isUsNumericShortCode } from "@/lib/shop-brain-invariants.mjs"
import { processEvent } from "@/lib/extract"
import { queueIngestAttachment, storeQueuedAttachment } from "@/lib/attachment-retry"
import { classifyTwilioConsentKeyword, recordMessagingConsent } from "@/lib/messaging-consent"
import { resumeSmsProjection } from "@/lib/sms-provider-truth.mjs"
import { runRecoverySweep } from "@/lib/recovery-sweep"
import { wakeGmailIngest } from "@/lib/gmail-wake"
import { reconcileRoutedLeadProjections, resolveProjectionLeadId } from "@/lib/routing"

export const runtime = "nodejs"

export async function POST(req: Request) {
  if (!twilioSmsWebhookConfigured()) return twiml("", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)

  const sid = params.get("MessageSid")?.trim() ?? ""
  const from = params.get("From")?.trim() ?? ""
  const to = params.get("To")?.trim() ?? ""
  const body = params.get("Body")?.trim().slice(0, 8000) ?? ""
  const rawOptOutType = params.get("OptOutType")?.trim().toUpperCase() ?? ""
  const consentKeyword = classifyTwilioConsentKeyword(rawOptOutType, body)
  // System/security SMS is not customer traffic: US short-code senders (5 or 6
  // digits -- Instagram's 32665, banks, Twilio itself) are never valid customer
  // numbers and must be routed here before normalizePhone can reject them, and
  // tightly recognized Meta/Instagram verification texts arrive from ordinary
  // long codes so the body is the only signal.
  const systemSms = isUsNumericShortCode(from)
    ? "short-code"
    : isMetaVerificationSms(body)
      ? "meta-verification"
      : null
  const mediaCount = Math.min(Math.max(Number(params.get("NumMedia") ?? 0), 0), 10)
  if (!sid || !from || !to) return twiml("")
  if (!isConfiguredTwilioNumber(to)) return twiml("", 403)

  const rawMedia = Array.from({ length: mediaCount }, (_, index) => ({
    url: params.get(`MediaUrl${index}`) ?? "",
    contentType: params.get(`MediaContentType${index}`) ?? "application/octet-stream",
    state: "pending",
  }))
  const sql = getSql()
  const eventKind = systemSms
    ? "sms.system.in"
    : consentKeyword
      ? `sms.consent.${consentKeyword.toLowerCase()}`
      : "sms.in"

  // First durable boundary after signature and destination validation: file
  // exactly what Twilio sent, without depending on customer matching, consent,
  // lead creation, attachment copying, extraction, or notification. A crash
  // after this insert is resumed by the signed webhook retry below.
  const inserted = (await sql`
    INSERT INTO messages (
      twilio_sid, direction, from_phone, to_phone, body, media, status,
      lead_id, person_id
    ) VALUES (
      ${sid}::text, 'in', ${from}::text, ${to}::text, ${body}::text,
      ${JSON.stringify(rawMedia)}::jsonb, 'received',
      NULL::bigint, NULL::bigint
    ) ON CONFLICT (twilio_sid) DO NOTHING
    RETURNING id, lead_id, person_id`) as { id: number; lead_id: number | null; person_id: number | null }[]
  const existing = inserted[0] ? [] : (await sql`SELECT id, lead_id, person_id FROM messages WHERE twilio_sid = ${sid}::text LIMIT 1`) as { id: number; lead_id: number | null; person_id: number | null }[]
  const receipt = inserted[0] ?? existing[0]
  const messageId = Number(receipt?.id)
  if (!messageId) return twiml("")

  // A completed event is the strongest projection receipt. A linked messages
  // row covers the narrower crash window after conversation resolution but
  // before the immutable event. Either one pins a signed replay to its
  // original job instead of resolving against whatever happens to be open now.
  const priorProjection = inserted[0] ? [] : (await sql`
    SELECT lead_id, person_id, detail FROM events
    WHERE kind = ${eventKind}::text AND external_id = ${sid}::text
    ORDER BY id ASC LIMIT 1`) as { lead_id: number | null; person_id: number | null; detail: { createdLead?: boolean } | null }[]
  const {
    projected: persistedProjection,
    leadId: persistedLeadId,
    personId: persistedPersonId,
    createdLead: persistedCreatedLead,
  } = resumeSmsProjection({
    messageReceipt: { leadId: receipt?.lead_id, personId: receipt?.person_id },
    priorEvent: priorProjection[0]
      ? { leadId: priorProjection[0].lead_id, personId: priorProjection[0].person_id, createdLead: priorProjection[0].detail?.createdLead }
      : null,
  })
  const persistedPeople = persistedPersonId
    ? (await sql`SELECT id, display_name, is_test FROM people WHERE id = ${persistedPersonId}::bigint LIMIT 1`) as { id: number; display_name: string; is_test: boolean }[]
    : []
  if (persistedPersonId && !persistedPeople[0]) throw new Error("The persisted SMS customer could not be resumed.")

  // Consent-control messages are compliance events, not job intake. Look up an
  // existing customer when possible, but never create a person or work order.
  // System SMS creates nothing at all: no person, no lead, no consent record.
  const conversation = persistedProjection
      ? { person: persistedPeople[0] ?? null, leadId: persistedLeadId, createdLead: persistedCreatedLead, routing: undefined }
    : consentKeyword || systemSms
      ? await (async () => {
        if (systemSms) return { person: null, leadId: null, createdLead: false, routing: undefined }
        const person = await findPersonByPhone(from)
        const leadId = person ? await findRecentOpenLeadForPerson(person.id, person.is_test) : null
        return { person, leadId, createdLead: false, routing: undefined }
      })()
      : await resolvePhoneConversation({ phone: from, body, source: "sms-in" })
  const personId = conversation.person?.id ?? null

  // Persist the chosen link immediately. COALESCE makes duplicate webhook
  // projection monotonic and prevents a replay from replacing the original.
  await sql`
    UPDATE messages SET lead_id = COALESCE(lead_id, ${conversation.leadId ?? null}::bigint),
      person_id = COALESCE(person_id, ${personId}::bigint)
    WHERE id = ${messageId}::bigint AND twilio_sid = ${sid}::text`
  let projectedLeadId = await resolveProjectionLeadId(conversation.leadId)
  if (projectedLeadId && projectedLeadId !== conversation.leadId) {
    await sql`UPDATE messages SET lead_id = ${projectedLeadId}::bigint WHERE id = ${messageId}::bigint`
  }

  if (!systemSms) {
    await recordMessagingConsent({
      phone: from,
      source: consentKeyword ?? "inbound-message",
      externalId: `twilio-consent:${sid}:${consentKeyword ?? "inbound"}`,
      leadId: projectedLeadId,
      personId,
      provenance: {
        messageSid: sid,
        to,
        optOutType: consentKeyword,
        providerHandledReply: Boolean(rawOptOutType && consentKeyword),
        classification: rawOptOutType && consentKeyword ? "provider" : consentKeyword ? "exact-body" : "conversation",
      },
    })
  }
  // The immutable system event is keyed by the external SID and carries a
  // neutral constant body -- the code lives only in the messages row (provider
  // truth) and the owner's cell, never in the journal, Wire, or logs.
  let eventId = await recordEvent({
    kind: eventKind,
    actorType: systemSms ? "system" : "customer",
    actorId: personId,
    leadId: projectedLeadId,
    personId,
    externalId: sid,
    body: systemSms
      ? "System verification text received."
      : body || (mediaCount ? `Customer sent ${mediaCount} attachment(s).` : "Customer texted."),
    detail: { messageId, mediaCount, createdLead: conversation.createdLead, consentKeyword, system: systemSms, isTest: systemSms ? body.includes("[INTERNAL TEST]") : undefined },
  })
  let wasNewLead = conversation.createdLead
  if (!eventId) {
    const prior = (await sql`
      SELECT id, detail FROM events WHERE kind = ${eventKind}::text AND external_id = ${sid}::text LIMIT 1`) as { id: number; detail: { createdLead?: boolean } | null }[]
    eventId = Number(prior[0]?.id) || null
    wasNewLead = Boolean(prior[0]?.detail?.createdLead)
  }

  // This wake-up is independent of attachment, extraction, and notification
  // work below. Only a signed, durably projected, real customer message can
  // spend the recovery lease; consent controls, system codes, and tests cannot.
  if (eventId && !consentKeyword && !systemSms && !conversation.person?.is_test) after(async () => {
    const result = await runRecoverySweep({ trigger: "twilio-sms" })
    if (!result.ok) console.error("Inbound SMS recovery failed:", result.error)
    if (!result.skipped) {
      const gmailResult = await wakeGmailIngest(new URL(req.url).origin)
      if (!gmailResult.ok) console.error("Inbound SMS Gmail wake failed:", gmailResult.reason)
    }
  })

  const attachmentIds: number[] = []
  for (const [index, media] of (consentKeyword || systemSms ? [] : rawMedia).entries()) {
    if (!media.url) continue
    const extension = media.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin"
    attachmentIds.push(await queueIngestAttachment({ provider: "twilio", externalMessageId: sid, attachmentKey: String(index), leadId: projectedLeadId!, personId, filename: `${index + 1}.${extension}`, contentType: media.contentType, sourceUrl: media.url, context: body, sourceDetail: { messageId, index } }))
  }
  if (conversation.leadId) {
    const reconciledTarget = await reconcileRoutedLeadProjections(conversation.leadId)
    if (reconciledTarget) projectedLeadId = reconciledTarget
  }

  // The interrupt row (and its push attempt) exists before Twilio receives 200.
  // Media copying and extraction remain background work.
  if (eventId && !consentKeyword && !systemSms && !conversation.person?.is_test) await notifyAll({
      priority: "interrupt",
      stock: "white",
      title: conversation.routing === "needs-job-match" ? "Text needs a job match" : wasNewLead ? "New text at the shop" : "Customer texted",
      body: conversation.routing === "needs-job-match" ? "Filed separately instead of guessing between this customer's active jobs." : (body || `${mediaCount} photo(s)`).slice(0, 120),
      url: `/ops/leads/${projectedLeadId}#spike`,
      sourceEventId: eventId,
      capExempt: wasNewLead,
      quietHoursExempt: wasNewLead,
    })
  // System verification codes go only to the owner's cell, straight from the
  // signed webhook: title, full body and sender, and the absolute Updates wire
  // URL, exempt from caps and quiet hours, deduped per SID so webhook replays
  // never re-text. [INTERNAL TEST] traffic never alerts.
  if (eventId && systemSms && !body.includes("[INTERNAL TEST]")) {
    await notifyOwnerCellSms({
      title: "Verification code received",
      body: `${from}: ${body || "System verification text."}`.slice(0, 500),
      url: `${twilioWebhookBaseUrl()}/board/updates#wire`,
      sourceEventId: eventId,
      capExempt: true,
      quietHoursExempt: true,
      dedupeKey: `owner-system-sms:${sid}`,
    })
  }
  // Real inbound SMS also copies straight to the owner's cell via Twilio, with
  // the sender name, the message (or photo note), and the direct work-order
  // link. The reserved shop/forwarding numbers are routing infrastructure, not
  // customers, and the stable per-sid dedupe key keeps webhook replays silent.
  else if (eventId && !consentKeyword && !systemSms && !conversation.person?.is_test && !isReservedShopPhone(from)) {
    await notifyOwnerCellSms({
      title: wasNewLead ? "New text at the shop" : "Customer texted",
      body: `${conversation.person?.display_name || from}: ${body || `${mediaCount} photo(s)`}`.slice(0, 500),
      url: `${twilioWebhookBaseUrl()}/ops/leads/${projectedLeadId}#spike`,
      sourceEventId: eventId,
      capExempt: true,
      quietHoursExempt: true,
      dedupeKey: `owner-sms-copy:${sid}`,
    })
  }
  if (eventId && !consentKeyword && !systemSms) after(async () => {
    for (const attachmentId of attachmentIds) await storeQueuedAttachment(attachmentId)
    await processEvent(eventId).catch((error) => console.error("SMS extraction failed:", error))
  })
  return twiml("")
}
