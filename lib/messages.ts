import { randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notify, notifyAll } from "@/lib/notify"
import { isDefinitiveTwilioError, sendSms, twilioCallbackUrl, twilioSmsConfigured } from "@/lib/twilio"
import { customerSmsAllowed } from "@/lib/messaging-consent"
import { FALLBACK_SHOP_PHONE_E164 } from "@/lib/shop-phone-shared"
import { isReservedCustomerPhone, normalizeUsPhone } from "@/lib/shop-brain-invariants.ts"
import { getDeferredSmsSendAt, isCentralQuietHours } from "@/lib/sms-quiet-hours.ts"
import { sendIfClaimed } from "@/lib/deferred-sms.ts"
import { SmsNotSentError } from "@/lib/sms-provider-truth.ts"

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
  send_after: string | null
  lead_id: number | null
  person_id: number | null
  operator_id: number | null
}

type SmsIntentRow = {
  id: number
  twilio_sid: string
  to_phone: string
  body: string
  lead_id: number | null
  person_id: number | null
  operator_id: number | null
  idempotency_key: string
  quiet_hours_exempt: boolean
  is_test: boolean
}

type SmsResult = {
  id: number
  sid: string | null
  eventId: number | null
  deferred?: boolean
  sendAfter?: string | null
  quietHoursExempt?: boolean
}

async function sendClaimedSms(intent: SmsIntentRow, deferred = false, sendAfter: Date | null = null): Promise<SmsResult> {
  const sql = getSql()
  const messageId = Number(intent.id)
  const intentSid = intent.twilio_sid
  const quietHoursExempt = Boolean(intent.quiet_hours_exempt)
  const glassLink = /^glass:([a-f0-9]{64}):send:([0-9]+)$/i.exec(intent.idempotency_key)
  let eventId: number | null = null
  let blockedReason = ""
  try {
    const to = normalizeUsPhone(intent.to_phone)
    const reservedPhones = [FALLBACK_SHOP_PHONE_E164, process.env.TWILIO_PHONE_NUMBER ?? "", process.env.OWNER_CELL_PHONE ?? ""]
    if (intent.is_test) blockedReason = "Internal test messages never contact customers."
    else if (!to || isReservedCustomerPhone(to, reservedPhones)) blockedReason = "A real customer phone number is required."
    if (blockedReason) throw new Error(blockedReason)
    if (!twilioSmsConfigured()) throw new Error("Shop texting is waiting for A2P approval.")
    if (!process.env.TWILIO_PHONE_NUMBER?.trim()) throw new Error("Twilio SMS is not configured.")
    if (!(await customerSmsAllowed(to))) blockedReason = "Text canceled: this customer no longer has texting permission."
    if (blockedReason) throw new Error(blockedReason)
    if (!sendAfter) eventId = await recordEvent({
      kind: "sms.out",
      actorType: intent.operator_id ? "operator" : "system",
      actorId: intent.operator_id ?? "",
      leadId: intent.lead_id,
      personId: intent.person_id,
      externalId: intentSid,
      body: intent.body,
      detail: { messageId, quietHoursExempt },
    })
  } catch (error) {
    // No provider call has happened. Keep a transient journal/consent lookup
    // failure retryable; a revoked consent or test message is canceled.
    // Finish this attempt's link cleanup before exposing the text to a retry.
    // A late cleanup must never release a newer Customer Page send claim.
    if (glassLink) await sql`
      UPDATE glass_links SET send_claimed_at = NULL,
        send_status = ${blockedReason ? (intent.is_test ? "suppressed" : "failed") : deferred ? "deferred" : "failed"}::text
      WHERE token_hash = ${glassLink[1].toLowerCase()}::text AND sent_at IS NULL
        AND send_attempts = ${Number(glassLink[2])}::integer`
    await sql`
      UPDATE messages SET status = ${blockedReason ? "canceled" : deferred ? "queued" : "persisted"}::text,
        sending_started_at = NULL, send_after = ${!blockedReason && deferred ? new Date().toISOString() : null}::timestamptz
      WHERE id = ${messageId}::bigint AND twilio_sid = ${intentSid}::text AND status = 'sending'`
    throw new SmsNotSentError(error instanceof Error ? error.message : "Text was not sent. Try again.", !blockedReason)
  }

  // Once published, the deferred worker may send this intent independently.
  // A lost queue response must stay ambiguous rather than offer a new key.
  if (sendAfter) {
    const queued = (await sql`
      UPDATE messages SET status = 'queued', send_after = ${sendAfter.toISOString()}::timestamptz,
        sending_started_at = NULL
      WHERE id = ${messageId}::bigint AND twilio_sid = ${intentSid}::text AND status = 'sending'
      RETURNING id`) as { id: number }[]
    if (!queued[0]) throw new Error("That text is already being handled; check Calls & Messages before retrying.")
    return { id: messageId, sid: null, eventId: null, deferred: true, sendAfter: sendAfter.toISOString(), quietHoursExempt: false }
  }

  try {
    const sent = await sendSms({
      to: intent.to_phone,
      body: intent.body,
      statusCallback: twilioCallbackUrl(`/api/twilio/sms-status?intent=${messageId}`),
    })
    await sql`
      UPDATE messages SET twilio_sid = ${sent.sid}::text, status = ${sent.status}::text,
        sending_started_at = NULL
      WHERE id = ${messageId}::bigint AND twilio_sid = ${intentSid}::text AND status = 'sending'`
    if (glassLink) {
      const hash = glassLink[1].toLowerCase()
      await sql`
        UPDATE glass_links SET sent_at = COALESCE(sent_at, now()), send_claimed_at = NULL, send_status = 'accepted'
        WHERE token_hash = ${hash}::text AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
      await recordEvent({
        kind: "glass.sent",
        actorType: "operator",
        actorId: intent.operator_id ?? "",
        leadId: intent.lead_id,
        personId: intent.person_id,
        externalId: `glass:${hash}:sent`,
        body: "Customer Page sent from the shop number",
        crewBody: "Customer Page sent from the shop number",
        detail: { messageId },
      })
    }
    return { id: messageId, sid: sent.sid, eventId, quietHoursExempt }
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS delivery failed"
    const definitive = isDefinitiveTwilioError(error)
    const currentReceipt = async () => ((await sql`
      SELECT twilio_sid, status FROM messages WHERE id = ${messageId}::bigint LIMIT 1`) as {
      twilio_sid: string
      status: string
    }[])[0]
    const transitioned = (await sql`
      UPDATE messages SET status = ${definitive ? "failed" : "unknown"}::text, sending_started_at = NULL,
        media = ${JSON.stringify([{ error: message, ambiguous: !definitive }])}::jsonb,
        reconciliation_notified_at = CASE WHEN ${!definitive}::boolean THEN now() ELSE reconciliation_notified_at END
      WHERE id = ${messageId}::bigint AND twilio_sid = ${intentSid}::text AND status = 'sending'
      RETURNING id`) as { id: number }[]
    if (glassLink && transitioned[0]) {
      await sql`
        UPDATE glass_links SET send_claimed_at = NULL,
          send_status = ${definitive ? "failed" : "unknown"}::text
        WHERE token_hash = ${glassLink[1].toLowerCase()}::text AND sent_at IS NULL`
    }
    if (!transitioned[0]) {
      const receipt = await currentReceipt()
      if (receipt && !receipt.twilio_sid.startsWith("pending:") && !["failed", "undelivered", "canceled"].includes(receipt.status)) {
        return { id: messageId, sid: receipt.twilio_sid, eventId, quietHoursExempt }
      }
      throw error
    }
    const failureEventId = await recordEvent({
      kind: definitive ? "sms.failed" : "sms.delivery-unknown",
      actorType: "system", leadId: intent.lead_id, personId: intent.person_id,
      externalId: `${intentSid}:${definitive ? "failed" : "unknown"}`,
      body: message, crewBody: definitive ? "Text failed." : "Text may have sent. Check Calls & Messages before retrying.",
      detail: { sourceEventId: eventId, messageId, ambiguous: !definitive },
    })
    if (!definitive) {
      const receipt = await currentReceipt()
      if (receipt && !receipt.twilio_sid.startsWith("pending:")) {
        if (!["failed", "undelivered", "canceled"].includes(receipt.status)) {
          return { id: messageId, sid: receipt.twilio_sid, eventId, quietHoursExempt }
        }
        throw error
      }
    }
    const alert = {
      priority: "digest" as const,
      stock: "red" as const,
      title: definitive ? "Text failed" : "Check this text before retrying",
      body: definitive ? message : "Twilio may have accepted it. Check Calls & Messages before sending again.",
      url: intent.lead_id ? `/ops/leads/${intent.lead_id}` : "/ops",
      sourceEventId: failureEventId || eventId,
    }
    if (intent.operator_id) await notify({ ...alert, operatorId: intent.operator_id })
    else await notifyAll(alert)
    if (!definitive) {
      const receipt = await currentReceipt()
      if (receipt && !receipt.twilio_sid.startsWith("pending:")) {
        if (failureEventId) await sql`
          UPDATE notifications SET read_at = COALESCE(read_at, now())
          WHERE source_event_id = ${failureEventId}::bigint AND read_at IS NULL`
        if (!["failed", "undelivered", "canceled"].includes(receipt.status)) {
          return { id: messageId, sid: receipt.twilio_sid, eventId, quietHoursExempt }
        }
      }
    }
    throw error
  }
}

export async function sendSmsPersisted(input: {
  to: string
  body: string
  leadId?: number | null
  personId?: number | null
  operatorId?: number | null
  rescheduleId?: number | null
  idempotencyKey?: string | null
  ownerInitiated?: boolean
}) {
  const to = normalizeUsPhone(input.to)
  const from = process.env.TWILIO_PHONE_NUMBER?.trim() ?? ""
  const pendingSid = `pending:${randomUUID()}`
  const sql = getSql()

  // Durable intent first. Provider delivery happens only after these rows exist.
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 180) ?? ""
  const now = new Date()
  const quietHoursExempt = Boolean(input.ownerInitiated && isCentralQuietHours(now))
  const sendAfter = quietHoursExempt ? null : getDeferredSmsSendAt(now)
  // Claim the durable key before validation can classify an attempt as unsent.
  // A replay may already be queued, accepted, or in a provider handoff.
  const initialStatus = "persisted"
  const rows = (await sql`
    INSERT INTO messages (
      twilio_sid, direction, from_phone, to_phone, body, status,
      lead_id, person_id, operator_id, reschedule_id, idempotency_key,
      send_after, quiet_hours_exempt, is_test
    ) VALUES (
      ${pendingSid}::text, 'out', ${from}::text, ${to}::text,
      ${input.body}::text, ${initialStatus}::text, ${input.leadId ?? null}::bigint,
      ${input.personId ?? null}::bigint, ${input.operatorId ?? null}::bigint,
      ${input.rescheduleId ?? null}::bigint, ${idempotencyKey}::text,
      ${sendAfter?.toISOString() ?? null}::timestamptz, ${quietHoursExempt}::boolean,
      mcsw_is_test_row(${input.leadId ?? null}::bigint, ${input.personId ?? null}::bigint,
        NULL::bigint, NULL::text, NULL::jsonb, ${input.body}::text)
    ) ON CONFLICT (idempotency_key) WHERE idempotency_key <> '' DO NOTHING
    RETURNING id, twilio_sid, status, send_after, quiet_hours_exempt, is_test`) as Array<{
      id: number; twilio_sid: string; status: string; send_after: string | null; quiet_hours_exempt: boolean; is_test: boolean
    }>
  const existing = rows[0] ? rows : idempotencyKey
    ? (await sql`SELECT id, twilio_sid, status, send_after, quiet_hours_exempt, is_test FROM messages WHERE idempotency_key = ${idempotencyKey}::text LIMIT 1`) as Array<{
      id: number; twilio_sid: string; status: string; send_after: string | null; quiet_hours_exempt: boolean; is_test: boolean
    }>
    : []
  if (!existing[0]) throw new Error("The persisted text could not be found.")
  const messageId = Number(existing[0].id)
  if (existing[0].is_test) {
    await sql`UPDATE messages SET status = 'canceled', send_after = NULL
      WHERE id = ${messageId}::bigint AND status IN ('persisted','queued')`
    throw new SmsNotSentError("Internal test messages never contact customers.")
  }
  if (existing[0].status === "queued" && existing[0].send_after) {
    return { id: messageId, sid: null, eventId: null, deferred: true, sendAfter: existing[0].send_after, quietHoursExempt: false }
  }
  if (["queued", "accepted", "sent", "delivered", "read"].includes(existing[0].status)) {
    return { id: messageId, sid: existing[0].twilio_sid, eventId: null, quietHoursExempt: Boolean(existing[0].quiet_hours_exempt) }
  }
  if (existing[0].status === "canceled") throw new SmsNotSentError("That text was canceled before sending. Check customer permission before trying again.")
  if (["failed", "undelivered"].includes(existing[0].status)) throw new Error("That text already failed; open the work order to retry safely.")
  if (existing[0].status === "unknown") throw new Error("Twilio may have accepted this attempt. Check Calls & Messages before sending a new reply.")
  const claimed = (await sql`
    UPDATE messages SET status = 'sending', sending_started_at = now(), send_after = NULL, from_phone = ${from}::text
    WHERE id = ${messageId}::bigint AND status = 'persisted'
    RETURNING id, twilio_sid, to_phone, body, lead_id, person_id, operator_id,
      idempotency_key, quiet_hours_exempt, is_test`) as SmsIntentRow[]
  if (!claimed[0]) throw new Error("That text is already sending; check Calls & Messages before retrying.")
  return sendClaimedSms(claimed[0], false, sendAfter)
}

/** Claim each due row once before the provider handoff; a crash leaves it ambiguous, never replayable. */
export async function sendDeferredSms(limit = 40) {
  const sql = getSql()
  const boundedLimit = Math.min(Math.max(Math.trunc(Number(limit) || 1), 1), 100)
  const candidates = (await sql`
    SELECT id FROM messages
    WHERE direction = 'out' AND status = 'queued' AND send_after IS NOT NULL AND send_after <= now()
    ORDER BY send_after ASC, id ASC LIMIT ${boundedLimit}::bigint`) as { id: number }[]
  let sent = 0
  let lostClaims = 0
  let failed = 0
  for (const candidate of candidates) {
    try {
      const claimed = await sendIfClaimed(async () => {
        const rows = (await sql`
          UPDATE messages SET status = 'sending', send_after = NULL, sending_started_at = now()
          WHERE id = ${candidate.id}::bigint AND direction = 'out' AND status = 'queued'
            AND send_after IS NOT NULL AND send_after <= now()
          RETURNING id, twilio_sid, to_phone, body, lead_id, person_id, operator_id,
            idempotency_key, quiet_hours_exempt, is_test`) as SmsIntentRow[]
        return rows[0] ?? null
      }, (intent) => sendClaimedSms(intent, true))
      if (claimed) sent += 1
      else lostClaims += 1
    } catch (error) {
      failed += 1
      console.error("Deferred customer text needs attention:", error)
    }
  }
  return { checked: candidates.length, sent, lostClaims, failed }
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
