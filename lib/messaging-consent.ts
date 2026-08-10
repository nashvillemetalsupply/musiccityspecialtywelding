import { getSql } from "@/lib/db"
import {
  classifyTwilioConsentKeyword,
  normalizeUsPhone,
  type TwilioConsentKeyword,
} from "@/lib/shop-brain-invariants.mjs"

export { classifyTwilioConsentKeyword }
export type { TwilioConsentKeyword }

export type MessagingConsentSource = "web" | "inbound-message" | "verbal-operator" | "START" | "STOP" | "HELP"
export type MessagingConsentEffect = "granted" | "revoked" | "recorded"
export type MessagingConsentState = "granted" | "revoked" | "unknown"

const EFFECT_BY_SOURCE: Record<MessagingConsentSource, MessagingConsentEffect> = {
  web: "granted",
  "inbound-message": "granted",
  "verbal-operator": "granted",
  START: "granted",
  STOP: "revoked",
  HELP: "recorded",
}

export async function recordMessagingConsent(input: {
  phone: string
  source: MessagingConsentSource
  externalId: string
  leadId?: number | null
  personId?: number | null
  operatorId?: number | null
  occurredAt?: string | null
  provenance?: Record<string, unknown>
}) {
  const phone = normalizeUsPhone(input.phone)
  const externalId = input.externalId.trim().slice(0, 220)
  if (!phone) throw new Error("A valid mobile number is required to record text consent.")
  if (!externalId) throw new Error("Consent provenance requires a stable external ID.")
  const effect = EFFECT_BY_SOURCE[input.source]
  if (!effect) throw new Error("Unknown text-consent source.")
  const sql = getSql()
  const rows = (await sql`
    INSERT INTO messaging_consents (
      phone_e164, lead_id, person_id, operator_id, source, effect,
      external_id, occurred_at, provenance
    ) VALUES (
      ${phone}::text, ${input.leadId ?? null}::bigint,
      ${input.personId ?? null}::bigint, ${input.operatorId ?? null}::bigint,
      ${input.source}::text, ${effect}::text, ${externalId}::text,
      ${input.occurredAt ?? new Date().toISOString()}::timestamptz,
      ${JSON.stringify(input.provenance ?? {})}::jsonb
    ) ON CONFLICT (external_id) DO NOTHING
    RETURNING id`) as { id: number }[]
  return { inserted: Boolean(rows[0]), effect, phone }
}

export async function getMessagingConsentState(phoneValue: string): Promise<MessagingConsentState> {
  const phone = normalizeUsPhone(phoneValue)
  if (!phone) return "unknown"
  const sql = getSql()
  const rows = (await sql`
    WITH keyword_state AS (
      SELECT source FROM messaging_consents
      WHERE phone_e164 = ${phone}::text AND source IN ('STOP', 'START')
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
    )
    SELECT CASE
      WHEN (SELECT source FROM keyword_state) = 'STOP' THEN 'revoked'
      WHEN (SELECT source FROM keyword_state) = 'START' THEN 'granted'
      WHEN EXISTS (
        SELECT 1 FROM messaging_consents
        WHERE phone_e164 = ${phone}::text AND effect = 'granted'
      ) THEN 'granted'
      ELSE 'unknown'
    END AS state`) as { state: MessagingConsentState }[]
  return rows[0]?.state ?? "unknown"
}

export async function customerSmsAllowed(phone: string) {
  return (await getMessagingConsentState(phone)) === "granted"
}

export function consentDisclosure() {
  return "By checking this box, you agree to receive job-related texts from Music City Specialty Welding. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is optional and is not a condition of purchase."
}
