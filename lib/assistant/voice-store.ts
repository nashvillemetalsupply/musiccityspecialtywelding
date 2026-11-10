import { getSql } from "../db.ts"
import { recordEvent } from "@/lib/events"
import { fileAssistantLead } from "@/lib/job-intake"
import { consumeStrictRateLimit, rateLimitFingerprint } from "@/lib/rate-limit"
import { getShopPhone } from "@/lib/shop-contact"
import { stripAssistantMoney } from "./money.ts"
import { PostgresAssistantStore } from "./store.ts"
import { handleAssistantTurn } from "./turn.ts"
import { voiceCallbackPhone } from "./voice.ts"
import type { AssistantDependencies } from "./service.ts"

export async function voiceDependencies(callSid: string, from: string) {
  // CallerName is often absent on subsequent Gather requests. Resolve every
  // existing test marker before AI or intake, including linked test customers.
  const rows = (await getSql()`
    SELECT c.from_phone, c.lead_id, l.is_test AS lead_is_test, (
      c.is_test OR lower(COALESCE(c.detail->>'isTest', 'false')) = 'true'
      OR COALESCE(c.detail->>'callerName', '') LIKE '%[INTERNAL TEST]%'
      OR COALESCE(l.is_test, false) OR COALESCE(p.is_test, false)
      OR EXISTS (SELECT 1 FROM people lp WHERE lp.id = l.person_id AND lp.is_test)
      OR EXISTS (SELECT 1 FROM call_intake_drafts d WHERE d.call_sid = c.twilio_sid AND d.is_test)
    ) AS is_test
    FROM calls c LEFT JOIN leads l ON l.id = c.lead_id LEFT JOIN people p ON p.id = c.person_id
    WHERE c.twilio_sid = ${callSid}::text AND c.direction = 'in' LIMIT 1`) as {
      from_phone: string; is_test: boolean; lead_id: number | null; lead_is_test: boolean | null
    }[]
  if (!rows[0] || rows[0].from_phone !== from) throw new Error("Inbound call receipt could not be confirmed.")
  const deps: AssistantDependencies = {
    store: new PostgresAssistantStore(`call:${callSid}`), phone: getShopPhone(),
    rateLimit: consumeStrictRateLimit, fingerprint: rateLimitFingerprint,
    model: handleAssistantTurn, validPhone: voiceCallbackPhone,
    handoff: async (input) => {
      const { deliverAssistantHandoff } = await import("./handoff.ts")
      return deliverAssistantHandoff({ ...input, leadId: input.leadId ?? rows[0].lead_id,
        channel: "voice", callSid, from, callbackPhone: voiceCallbackPhone(from), deferDelivery: true })
    },
    followUpLead: async (input) => {
      const { followUpAssistantLead } = await import("./followup.ts")
      await followUpAssistantLead(input)
    },
    fileLead: async (input) => {
      const filed = rows[0].lead_id
        ? { leadId: Number(rows[0].lead_id), isTest: rows[0].lead_is_test === true }
        : await fileAssistantLead({ ...input, channel: "voice", callSid })
      if (filed.isTest !== input.isTest) throw new Error("Voice intake test partition changed.")
      const linked = (await getSql()`
        WITH linked AS (
          UPDATE calls c SET lead_id = l.id, person_id = COALESCE(c.person_id, l.person_id),
            is_test = c.is_test OR l.is_test, updated_at = now()
          FROM leads l WHERE c.twilio_sid = ${callSid}::text AND l.id = ${filed.leadId}::bigint
            AND (c.lead_id IS NULL OR c.lead_id = l.id) AND NOT (c.is_test AND NOT l.is_test)
          RETURNING c.lead_id, c.person_id, c.is_test
        ), saved_draft AS (
          UPDATE call_intake_drafts d SET status = 'saved', lead_id = c.lead_id,
            person_id = COALESCE(d.person_id, c.person_id), is_test = d.is_test OR c.is_test,
            saved_at = COALESCE(d.saved_at, now()), last_error = '', updated_at = now()
          FROM linked c WHERE d.call_sid = ${callSid}::text
            AND (d.status = ANY(ARRAY['pending','failed','unknown']::text[])
              OR (d.status = 'saved' AND d.lead_id = c.lead_id))
          RETURNING d.id
        ) SELECT lead_id FROM linked`) as { lead_id: number }[]
      if (Number(linked[0]?.lead_id) !== filed.leadId) throw new Error("Voice lead could not be linked to the call.")
      return filed
    },
    receipt: async ({ sessionId, turnIndex, leadId, fields, isTest }) => {
      const externalId = `${callSid}:${turnIndex}`
      const body = stripAssistantMoney([
        isTest ? "[INTERNAL TEST]" : "", fields.need, fields.material_size, fields.location,
        fields.timing ? `Requested timing: ${fields.timing}` : "",
        fields.callback_window ? `Callback requested: ${fields.callback_window}` : "",
      ].filter(Boolean).join(" · ")).slice(0, 1200)
      const eventId = await recordEvent({
        kind: "assistant.voice", actorType: "customer", leadId, externalId, body, crewBody: body,
        detail: { callSid, sessionId, turnIndex, fields, isTest },
      })
      if (eventId) return eventId
      const prior = (await getSql()`SELECT id FROM events WHERE kind = 'assistant.voice' AND external_id = ${externalId}::text LIMIT 1`) as { id: number }[]
      if (!prior[0]) throw new Error("Voice receipt could not be confirmed.")
      return Number(prior[0].id)
    },
    notify: async ({ sessionId, turnIndex, leadId, fields }) => {
      const { deliverAssistantHandoff } = await import("./handoff.ts")
      await deliverAssistantHandoff({ sessionId, turnIndex, leadId, fields, message: "",
        reason: "lead", isTest: false, channel: "voice", callSid, from, callbackPhone: voiceCallbackPhone(from), deferDelivery: true })
    },
  }
  return { deps, isTest: rows[0].is_test, from: rows[0].from_phone, leadId: rows[0].lead_id }
}
