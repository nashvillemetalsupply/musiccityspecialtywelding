import { getSql } from "../db.ts"
import { createOrReuseAssistantGlassLink } from "../glass.ts"
import { glassUrl } from "../glass-delivery.ts"
import { sendSmsPersisted } from "../messages.ts"
import { customerSmsAllowed } from "../messaging-consent.ts"
import { twilioSmsConfigured } from "../twilio.ts"
import { isReservedCustomerPhone, normalizeUsPhone } from "../shop-brain-invariants.ts"
import { stripAssistantMoney } from "./money.ts"
import type { AssistantFields } from "./turn.ts"

function assistantCallbackPhone(value: string | null | undefined) {
  const normalized = normalizeUsPhone(value ?? "")
  const reserved = ["+16157033296", "+16158104910", ...[
    "TWILIO_PHONE_NUMBER", "OWNER_CELL_PHONE", "NEXT_PUBLIC_TWILIO_PHONE_NUMBER_GOOGLE",
    "NEXT_PUBLIC_TWILIO_PHONE_NUMBER_FACEBOOK", "TWILIO_PHONE_NUMBER_LD2R",
    "TWILIO_PHONE_NUMBER_GREASE", "TWILIO_PHONE_NUMBER_RAILING",
  ].map((key) => process.env[key] ?? "")]
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(normalized) && !isReservedCustomerPhone(normalized, reserved) ? normalized : ""
}

export async function followUpAssistantLead(input: {
  leadId: number; eventId: number; fields: AssistantFields; isTest: boolean
}) {
  const sql = getSql()
  // The durable assistant receipt fences all projections and customer contact.
  const rows = (await sql`
    SELECT l.phone, l.person_id, l.is_test, COALESCE(p.is_test, false) AS person_is_test,
      e.detail->'fields' AS receipt_fields,
      (l.source = ANY(ARRAY['website-chat','phone-assistant']::text[])
        AND (l.intake_key LIKE 'assistant:%' OR l.intake_key LIKE 'call:%')
        AND (l.message LIKE 'Partial assistant request.%'
          OR l.message LIKE '[INTERNAL TEST] Partial assistant request.%')) AS assistant_partial
    FROM leads l LEFT JOIN people p ON p.id = l.person_id
    JOIN events e ON e.id = ${input.eventId}::bigint AND e.lead_id = l.id
      AND e.kind = ANY(ARRAY['assistant.chat','assistant.voice']::text[]) AND e.is_test = l.is_test
    WHERE l.id = ${input.leadId}::bigint AND l.is_test = ${input.isTest}::boolean
      AND l.status <> 'lost'`) as {
        phone: string; person_id: number | null; is_test: boolean; person_is_test: boolean
        receipt_fields: Partial<AssistantFields> | null; assistant_partial: boolean
      }[]
  const lead = rows[0]
  if (!lead) throw new Error("The assistant lead receipt could not be confirmed.")
  if (lead.assistant_partial && lead.receipt_fields) {
    // A customer answering the callback invitation must become callable on the
    // same work order. Only receipt evidence can fill a missing contact field;
    // an owner correction or an established identity is never overwritten.
    const captured = lead.receipt_fields
    const name = stripAssistantMoney(captured.name ?? "").slice(0, 120)
    const phone = assistantCallbackPhone(captured.callback_phone)
    const candidate = captured.email?.trim() ?? ""
    const email = candidate.length <= 254 && /^[^\s<>@\p{Cc}]+@[^\s<>@\p{Cc}]+\.[^\s<>@\p{Cc}]+$/u.test(candidate) ? candidate : ""
    if (name || phone || email) {
      const projected = (await sql`
        UPDATE leads SET
          first_name = CASE WHEN trim(first_name) = '' OR first_name = 'Assistant callback (partial)'
            THEN COALESCE(NULLIF(${name}::text, ''), first_name) ELSE first_name END,
          phone = CASE WHEN trim(phone) = '' OR phone_is_placeholder
            THEN COALESCE(NULLIF(${phone}::text, ''), phone) ELSE phone END,
          phone_is_placeholder = CASE WHEN (trim(phone) = '' OR phone_is_placeholder) AND ${phone}::text <> ''
            THEN false ELSE phone_is_placeholder END,
          email = CASE WHEN trim(email) = '' THEN COALESCE(NULLIF(${email}::text, ''), email) ELSE email END,
          updated_at = now()
        WHERE id = ${input.leadId}::bigint AND is_test = ${input.isTest}::boolean AND status <> 'lost'
          AND source = ANY(ARRAY['website-chat','phone-assistant']::text[])
          AND (intake_key LIKE 'assistant:%' OR intake_key LIKE 'call:%')
          AND (message LIKE 'Partial assistant request.%' OR message LIKE '[INTERNAL TEST] Partial assistant request.%')
        RETURNING phone`) as { phone: string }[]
      if (projected[0]) lead.phone = projected[0].phone
    }
  }
  const window = stripAssistantMoney(input.fields.callback_window ?? "").slice(0, 160)
  if (window) {
    const note = `Assistant callback requested: ${window}`
    // Only our labelled line is replaceable; owner notes never become crew text.
    await sql`
      UPDATE leads SET notes = concat_ws(E'\n', NULLIF(trim(regexp_replace(COALESCE(notes, ''),
          '(^|\n)Assistant callback requested: [^\n]*', '', 'g')), ''), ${note}::text),
        crew_notes = concat_ws(E'\n', NULLIF(trim(regexp_replace(COALESCE(crew_notes, ''),
          '(^|\n)Assistant callback requested: [^\n]*', '', 'g')), ''), ${note}::text),
        updated_at = now()
      WHERE id = ${input.leadId}::bigint AND is_test = ${input.isTest}::boolean`
  }
  const phone = assistantCallbackPhone(input.fields.callback_phone)
  if (input.isTest || lead.is_test || lead.person_is_test || !twilioSmsConfigured()
    || !phone || phone !== normalizeUsPhone(lead.phone) || !await customerSmsAllowed(phone)) return
  const key = `assistant-photo:${input.leadId}`
  const prior = (await sql`
    SELECT to_phone, status FROM messages WHERE idempotency_key = ${key}::text
      AND lead_id = ${input.leadId}::bigint LIMIT 1`) as { to_phone: string; status: string }[]
  // A changed callback must never resume an old unsent intent to a stale number.
  if (prior[0] && normalizeUsPhone(prior[0].to_phone) !== phone) return
  const token = await createOrReuseAssistantGlassLink(input.leadId)
  if (!token) return
  try {
    await sendSmsPersisted({
      to: phone, leadId: input.leadId, personId: lead.person_id, idempotencyKey: key,
      body: `Music City Specialty Welding: add photos of the item and the damage here: ${glassUrl(token)}`,
    })
  } catch (error) {
    // Persisted delivery failures already belong to the SMS recovery/operator
    // path. They must not trap every later assistant turn or mint a new key.
    const intents = (await sql`
      SELECT status FROM messages WHERE idempotency_key = ${key}::text
        AND lead_id = ${input.leadId}::bigint LIMIT 1`) as { status: string }[]
    if (!intents[0] || !["sending", "queued", "accepted", "sent", "delivered", "read",
      "failed", "undelivered", "unknown", "canceled"].includes(intents[0].status)) throw error
  }
}
