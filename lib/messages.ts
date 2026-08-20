import { randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notify, notifyAll } from "@/lib/notify"
import { isDefinitiveTwilioError, sendSms, twilioCallbackUrl, twilioSmsConfigured } from "@/lib/twilio"
import { customerSmsAllowed } from "@/lib/messaging-consent"
import { FALLBACK_SHOP_PHONE_E164 } from "@/lib/shop-phone-shared"
import { isReservedCustomerPhone, normalizeUsPhone } from "@/lib/shop-brain-invariants.mjs"

export type MessageRow = {
  id: number
  twilio_sid: string
  direction: "in" | "out"
  from_phone: string
  to_phone: string
  body: string
  crew_body: string | null
  media: Array<Record<string, unknown>>
  status: string
  sent_at: string
  lead_id: number | null
  person_id: number | null
  operator_id: number | null
}

export async function sendSmsPersisted(input: {
  to: string
  body: string
  leadId?: number | null
  personId?: number | null
  operatorId?: number | null
  rescheduleId?: number | null
  idempotencyKey?: string | null
}) {
  const to = normalizeUsPhone(input.to)
  const reservedPhones = [FALLBACK_SHOP_PHONE_E164, process.env.TWILIO_PHONE_NUMBER ?? "", process.env.OWNER_CELL_PHONE ?? ""]
  if (!to || isReservedCustomerPhone(to, reservedPhones)) throw new Error("A real customer phone number is required.")
  if (!twilioSmsConfigured()) throw new Error("Shop texting is waiting for A2P approval.")
  if (!(await customerSmsAllowed(to))) throw new Error("Texting is blocked until this customer opts in. Record their permission or ask them to text the shop first.")
  const from = process.env.TWILIO_PHONE_NUMBER?.trim()
  if (!from) throw new Error("Twilio SMS is not configured.")
  const pendingSid = `pending:${randomUUID()}`
  const sql = getSql()

  // Durable intent first. Provider delivery happens only after these rows exist.
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 180) ?? ""
  const rows = (await sql`
    INSERT INTO messages (
      twilio_sid, direction, from_phone, to_phone, body, status,
      lead_id, person_id, operator_id, reschedule_id, idempotency_key
    ) VALUES (
      ${pendingSid}::text, 'out', ${from}::text, ${to}::text,
      ${input.body}::text, 'persisted', ${input.leadId ?? null}::bigint,
      ${input.personId ?? null}::bigint, ${input.operatorId ?? null}::bigint,
      ${input.rescheduleId ?? null}::bigint, ${idempotencyKey}::text
    ) ON CONFLICT (idempotency_key) WHERE idempotency_key <> '' DO NOTHING
    RETURNING id`) as { id: number }[]
  const existing = rows[0] ? [{ id: Number(rows[0].id), twilio_sid: pendingSid, status: "persisted" }] : idempotencyKey
    ? (await sql`SELECT id, twilio_sid, status FROM messages WHERE idempotency_key = ${idempotencyKey}::text LIMIT 1`) as { id: number; twilio_sid: string; status: string }[]
    : []
  if (!existing[0]) throw new Error("The persisted text could not be found.")
  const messageId = Number(existing[0].id)
  if (["queued", "accepted", "sent", "delivered", "read"].includes(existing[0].status)) return { id: messageId, sid: existing[0].twilio_sid, eventId: null }
  if (["failed", "undelivered", "canceled"].includes(existing[0].status)) throw new Error("That text already failed; open the work order to retry safely.")
  if (existing[0].status === "unknown") throw new Error("Twilio may have accepted this attempt. Check Calls & Messages before sending a new reply.")
  const claimed = (await sql`
    UPDATE messages SET status = 'sending', sending_started_at = now()
    WHERE id = ${messageId}::bigint AND status = 'persisted'
    RETURNING twilio_sid`) as { twilio_sid: string }[]
  if (!claimed[0]) throw new Error("That text is already sending; check Calls & Messages before retrying.")
  const intentSid = claimed[0].twilio_sid
  const eventId = await recordEvent({
    kind: "sms.out",
    actorType: input.operatorId ? "operator" : "system",
    actorId: input.operatorId ?? "",
    leadId: input.leadId,
    personId: input.personId,
    externalId: intentSid,
    body: input.body,
    detail: { messageId },
  })

  try {
    const sent = await sendSms({
      to,
      body: input.body,
      statusCallback: twilioCallbackUrl(`/api/twilio/sms-status?intent=${messageId}`),
    })
    await sql`
      UPDATE messages SET twilio_sid = ${sent.sid}::text, status = ${sent.status}::text
      WHERE id = ${messageId}::bigint AND twilio_sid = ${intentSid}::text AND status = 'sending'`
    return { id: messageId, sid: sent.sid, eventId }
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS delivery failed"
    const definitive = isDefinitiveTwilioError(error)
    const currentReceipt = async () => ((await sql`
      SELECT twilio_sid, status FROM messages WHERE id = ${messageId}::bigint LIMIT 1`) as {
      twilio_sid: string
      status: string
    }[])[0]
    const transitioned = (await sql`
      UPDATE messages SET status = ${definitive ? "failed" : "unknown"}::text, media = ${JSON.stringify([{ error: message, ambiguous: !definitive }])}::jsonb,
        reconciliation_notified_at = CASE WHEN ${!definitive}::boolean THEN now() ELSE reconciliation_notified_at END
      WHERE id = ${messageId}::bigint AND twilio_sid = ${intentSid}::text AND status = 'sending'
      RETURNING id`) as { id: number }[]
    if (!transitioned[0]) {
      const receipt = await currentReceipt()
      if (receipt && !receipt.twilio_sid.startsWith("pending:") && !["failed", "undelivered", "canceled"].includes(receipt.status)) {
        return { id: messageId, sid: receipt.twilio_sid, eventId }
      }
      throw error
    }
    const failureEventId = await recordEvent({
      kind: definitive ? "sms.failed" : "sms.delivery-unknown",
      actorType: "system", leadId: input.leadId, personId: input.personId,
      externalId: `${intentSid}:${definitive ? "failed" : "unknown"}`,
      body: message, crewBody: definitive ? "Text failed." : "Text may have sent. Check Calls & Messages before retrying.",
      detail: { sourceEventId: eventId, messageId, ambiguous: !definitive },
    })
    if (!definitive) {
      const receipt = await currentReceipt()
      if (receipt && !receipt.twilio_sid.startsWith("pending:")) {
        if (!["failed", "undelivered", "canceled"].includes(receipt.status)) {
          return { id: messageId, sid: receipt.twilio_sid, eventId }
        }
        throw error
      }
    }
    const alert = {
      priority: "digest" as const,
      stock: "red" as const,
      title: definitive ? "Text failed" : "Check this text before retrying",
      body: definitive ? message : "Twilio may have accepted it. Check Calls & Messages before sending again.",
      url: input.leadId ? `/ops/leads/${input.leadId}` : "/ops",
      sourceEventId: failureEventId || eventId,
    }
    if (input.operatorId) await notify({ ...alert, operatorId: input.operatorId })
    else await notifyAll(alert)
    if (!definitive) {
      const receipt = await currentReceipt()
      if (receipt && !receipt.twilio_sid.startsWith("pending:")) {
        if (failureEventId) await sql`
          UPDATE notifications SET read_at = COALESCE(read_at, now())
          WHERE source_event_id = ${failureEventId}::bigint AND read_at IS NULL`
        if (!["failed", "undelivered", "canceled"].includes(receipt.status)) {
          return { id: messageId, sid: receipt.twilio_sid, eventId }
        }
      }
    }
    throw error
  }
}

/** Never guesses after an ambiguous provider handoff; it puts a red receipt in front of a human. */
export async function reconcileStaleSmsIntents(limit = 20) {
  const sql = getSql()
  const rows = (await sql`
    UPDATE messages SET status = 'unknown', reconciliation_notified_at = now()
    WHERE id IN (
      SELECT id FROM messages
      WHERE direction = 'out' AND status = 'sending' AND reconciliation_notified_at IS NULL
        AND COALESCE(sending_started_at, sent_at) < now() - interval '10 minutes'
      ORDER BY COALESCE(sending_started_at, sent_at) ASC
      LIMIT ${Math.min(Math.max(limit, 1), 50)}::bigint
    )
    RETURNING id, lead_id, person_id, operator_id, body`) as Array<{
      id: number; lead_id: number | null; person_id: number | null; operator_id: number | null; body: string
    }>
  for (const row of rows) {
    const eventId = await recordEvent({
      kind: "sms.delivery-unknown",
      actorType: "system",
      leadId: row.lead_id,
      personId: row.person_id,
      externalId: `sms-unknown:${row.id}`,
      body: "Twilio handoff needs verification before this reply is sent again.",
      crewBody: "Text handoff needs verification before this reply is sent again.",
      detail: { messageId: row.id },
    })
    const alert = {
      priority: "digest" as const,
      stock: "red" as const,
      title: "Check this text before retrying",
      body: "Twilio may have accepted it. Check Calls & Messages, then send a new reply only if needed.",
      crewBody: "The text may have sent. Check Calls & Messages before trying again.",
      url: row.lead_id ? `/ops/leads/${row.lead_id}#spike` : "/board/updates#wire",
      sourceEventId: eventId,
      dedupeKey: `sms-unknown:${row.id}`,
    }
    if (row.operator_id) await notify({ ...alert, operatorId: row.operator_id })
    else await notifyAll(alert)
  }
  return { reconciled: rows.length }
}

export async function listLeadMessages(leadId: number): Promise<MessageRow[]> {
  const sql = getSql()
  return (await sql`
    SELECT * FROM (
      SELECT * FROM messages WHERE lead_id = ${leadId}::bigint
      ORDER BY sent_at DESC, id DESC LIMIT 300
    ) recent ORDER BY sent_at ASC, id ASC`) as MessageRow[]
}
