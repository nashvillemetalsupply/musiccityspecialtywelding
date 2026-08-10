import { after } from "next/server"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { resolvePhoneConversation } from "@/lib/ingest"
import { notifyAll } from "@/lib/notify"
import { findPersonByPhone, findRecentOpenLeadForPerson } from "@/lib/people"
import { isConfiguredTwilioNumber, readTwilioForm, twilioSmsWebhookConfigured, twiml } from "@/lib/twilio"
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
  const mediaCount = Math.min(Math.max(Number(params.get("NumMedia") ?? 0), 0), 10)
  if (!sid || !from || !to) return twiml("")
  if (!isConfiguredTwilioNumber(to)) return twiml("", 403)

  // Consent-control messages are compliance events, not job intake. Look up an
  // existing customer when possible, but never create a person or work order.
  const conversation = consentKeyword
    ? await (async () => {
        const person = await findPersonByPhone(from)
        const leadId = person ? await findRecentOpenLeadForPerson(person.id, person.is_test) : null
        return { person, leadId, createdLead: false }
      })()
    : await resolvePhoneConversation({ phone: from, body, source: "sms-in" })
  const personId = conversation.person?.id ?? null
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

  const eventKind = consentKeyword ? `sms.consent.${consentKeyword.toLowerCase()}` : "sms.in"
  let eventId = await recordEvent({
    kind: eventKind,
    actorType: "customer",
    actorId: personId,
    leadId: conversation.leadId,
    personId,
    externalId: sid,
    body: body || (mediaCount ? `Customer sent ${mediaCount} attachment(s).` : "Customer texted."),
    detail: { messageId, mediaCount, createdLead: conversation.createdLead, consentKeyword },
  })
  let wasNewLead = conversation.createdLead
  if (!eventId) {
    const prior = (await sql`
      SELECT id, detail FROM events WHERE kind = ${eventKind}::text AND external_id = ${sid}::text LIMIT 1`) as { id: number; detail: { createdLead?: boolean } | null }[]
    eventId = Number(prior[0]?.id) || null
    wasNewLead = Boolean(prior[0]?.detail?.createdLead)
  }

  const attachmentIds: number[] = []
  for (const [index, media] of (consentKeyword ? [] : rawMedia).entries()) {
    if (!media.url) continue
    const extension = media.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin"
    attachmentIds.push(await queueIngestAttachment({ provider: "twilio", externalMessageId: sid, attachmentKey: String(index), leadId: conversation.leadId!, personId, filename: `${index + 1}.${extension}`, contentType: media.contentType, sourceUrl: media.url, context: body, sourceDetail: { messageId, index } }))
  }

  // The interrupt row (and its push attempt) exists before Twilio receives 200.
  // Media copying and extraction remain background work.
  if (eventId && !consentKeyword && !conversation.person?.is_test) await notifyAll({
      priority: "interrupt",
      stock: "white",
      title: wasNewLead ? "New text at the shop" : "Customer texted",
      body: (body || `${mediaCount} photo(s)`).slice(0, 120),
      url: `/ops/leads/${conversation.leadId}#spike`,
      sourceEventId: eventId,
      capExempt: wasNewLead,
      quietHoursExempt: wasNewLead,
      smsFallback: wasNewLead,
    })
  if (eventId && !consentKeyword) after(async () => {
    for (const attachmentId of attachmentIds) await storeQueuedAttachment(attachmentId)
    await processEvent(eventId).catch((error) => console.error("SMS extraction failed:", error))
  })
  return twiml("")
}
