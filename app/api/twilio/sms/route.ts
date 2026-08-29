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

  // Consent-control messages are compliance events, not job intake. Look up an
  // existing customer when possible, but never create a person or work order.
  // System SMS creates nothing at all: no person, no lead, no consent record.
  const conversation = consentKeyword || systemSms
    ? await (async () => {
        if (systemSms) return { person: null, leadId: null, createdLead: false }
        const person = await findPersonByPhone(from)
        const leadId = person ? await findRecentOpenLeadForPerson(person.id, person.is_test) : null
        return { person, leadId, createdLead: false }
      })()
    : await resolvePhoneConversation({ phone: from, body, source: "sms-in" })
  const personId = conversation.person?.id ?? null
  if (!systemSms) {
    await recordMessagingConsent({
      phone: from,
      source: consentKeyword ?? "inbound-message",
      externalId: `twilio-consent:${sid}:${consentKeyword ?? "inbound"}`,
      leadId: conversation.leadId,
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
  const rawMedia = Array.from({ length: mediaCount }, (_, index) => ({
    url: params.get(`MediaUrl${index}`) ?? "",
    contentType: params.get(`MediaContentType${index}`) ?? "application/octet-stream",
    state: "pending",
  }))
  const sql = getSql()

  // Provider truth and immutable event exist before media copying or notification.
  const inserted = (await sql`
    INSERT INTO messages (
      twilio_sid, direction, from_phone, to_phone, body, media, status,
      lead_id, person_id
    ) VALUES (
      ${sid}::text, 'in', ${from}::text, ${to}::text, ${body}::text,
      ${JSON.stringify(rawMedia)}::jsonb, 'received',
      ${conversation.leadId ?? null}::bigint, ${personId}::bigint
    ) ON CONFLICT (twilio_sid) DO NOTHING
    RETURNING id`) as { id: number }[]
  const existing = inserted[0] ? [] : (await sql`SELECT id FROM messages WHERE twilio_sid = ${sid}::text LIMIT 1`) as { id: number }[]
  const messageId = Number(inserted[0]?.id ?? existing[0]?.id)
  if (!messageId) return twiml("")

  const eventKind = systemSms
    ? "sms.system.in"
    : consentKeyword
      ? `sms.consent.${consentKeyword.toLowerCase()}`
      : "sms.in"
  // The immutable system event is keyed by the external SID and carries a
  // neutral constant body -- the code lives only in the messages row (provider
  // truth) and the owner's cell, never in the journal, Wire, or logs.
  let eventId = await recordEvent({
    kind: eventKind,
    actorType: systemSms ? "system" : "customer",
    actorId: personId,
    leadId: conversation.leadId,
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

  const attachmentIds: number[] = []
  for (const [index, media] of (consentKeyword || systemSms ? [] : rawMedia).entries()) {
    if (!media.url) continue
    const extension = media.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin"
    attachmentIds.push(await queueIngestAttachment({ provider: "twilio", externalMessageId: sid, attachmentKey: String(index), leadId: conversation.leadId!, personId, filename: `${index + 1}.${extension}`, contentType: media.contentType, sourceUrl: media.url, context: body, sourceDetail: { messageId, index } }))
  }

  // The interrupt row (and its push attempt) exists before Twilio receives 200.
  // Media copying and extraction remain background work.
  if (eventId && !consentKeyword && !systemSms && !conversation.person?.is_test) await notifyAll({
      priority: "interrupt",
      stock: "white",
      title: wasNewLead ? "New text at the shop" : "Customer texted",
      body: (body || `${mediaCount} photo(s)`).slice(0, 120),
      url: `/ops/leads/${conversation.leadId}#spike`,
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
      url: `${twilioWebhookBaseUrl()}/ops/leads/${conversation.leadId}#spike`,
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
