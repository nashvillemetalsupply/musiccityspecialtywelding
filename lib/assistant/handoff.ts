import { randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { fileAssistantLead } from "@/lib/job-intake"
import { emailAssistantTranscript, notifyAll, notifyOwnerCellSms } from "@/lib/notify"
import { getShopPhone } from "@/lib/shop-contact"
import { stripAssistantMoney } from "./money.ts"
import { extractAssistantContact, ASSISTANT_SHOP_EMAIL, type AssistantHandoffReason } from "./contact.ts"
import type { AssistantFields, AssistantMessage } from "./turn.ts"
import type { AssistantResponse } from "./service.ts"

export type HandoffInput = {
  sessionId: string
  turnIndex: number
  message: string
  reply?: string
  fields?: AssistantFields
  reason: AssistantHandoffReason | "idle" | "unavailable" | "voice-no-answer" | "lead"
  deliveryReason?: string
  leadId?: number | null
  isTest: boolean
  channel?: "voice"
  callSid?: string
  from?: string
  callbackPhone?: string
  deferDelivery?: boolean
}

type StoredTurn = {
  turn_index: number; inbound: string
  result: { fields: AssistantFields; reply: string } | null
  response: AssistantResponse | null
}

function cleanFields(fields: AssistantFields): AssistantFields {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
    typeof value === "string" ? stripAssistantMoney(value) : value,
  ])) as AssistantFields
}

// The immutable request is a recoverable outbox item, distinct from delivery.
// It also preserves a throttled/conflicting inbound that never reached a turn.
export async function deliverAssistantHandoff(input: HandoffInput): Promise<{ leadId: number | null }> {
  let isTest = input.isTest || /\[INTERNAL TEST\]/i.test(JSON.stringify(input))
  const sql = getSql()
  await sql`INSERT INTO assistant_sessions (id, is_test) VALUES (${input.sessionId}::uuid, ${isTest}::boolean)
    ON CONFLICT (id) DO NOTHING`
  const contexts = (await sql`
    SELECT COALESCE(s.lead_id, ${input.leadId ?? null}::bigint) AS lead_id, l.is_test AS lead_is_test,
      (s.is_test OR COALESCE(l.is_test, false) OR COALESCE(p.is_test, false)
        OR EXISTS (SELECT 1 FROM assistant_turns t WHERE t.session_id = s.id
          AND (t.is_test OR t.inbound ILIKE '%[INTERNAL TEST]%'))
      ) AS is_test
    FROM assistant_sessions s LEFT JOIN leads l ON l.id = COALESCE(s.lead_id, ${input.leadId ?? null}::bigint)
      LEFT JOIN people p ON p.id = l.person_id
    WHERE s.id = ${input.sessionId}::uuid LIMIT 1`) as { lead_id: number | null; lead_is_test: boolean | null; is_test: boolean }[]
  const context = contexts[0]
  if (!context) throw new Error("Assistant handoff session could not be confirmed.")
  isTest ||= context.is_test
  const turns = (await sql`
    SELECT turn_index, inbound, result, response FROM assistant_turns
    WHERE session_id = ${input.sessionId}::uuid ORDER BY turn_index ASC LIMIT 30`) as StoredTurn[]
  const messages: AssistantMessage[] = turns.flatMap((turn) => [
    { role: "user" as const, content: turn.inbound },
    ...((turn.response?.reply ?? turn.result?.reply)
      ? [{ role: "assistant" as const, content: (turn.response?.reply ?? turn.result!.reply) }] : []),
  ])
  if (input.message && !turns.some((turn) => turn.turn_index === input.turnIndex && turn.inbound === stripAssistantMoney(input.message))) {
    messages.push({ role: "user", content: input.message })
  }
  if (input.reply && messages.at(-1)?.content !== input.reply) messages.push({ role: "assistant", content: input.reply })
  const contact = extractAssistantContact(messages)
  const { voiceCallbackPhone } = await import("./voice.ts")
  const callbackPhone = voiceCallbackPhone(input.callbackPhone || contact.callback_phone || "")
  const previous = turns.map((turn) => turn.result?.fields ?? turn.response?.fields).filter(Boolean)
  let fields: AssistantFields = {
    name: null, callback_phone: null, need: "", material_size: null, location: null,
    timing: null, callback_window: null, is_job: "unsure",
  }
  for (const captured of [...previous, input.fields]) {
    if (captured) fields = { ...fields, ...Object.fromEntries(Object.entries(captured).filter(([, value]) => value != null && value !== "")) }
  }
  fields = cleanFields({ ...fields, callback_phone: callbackPhone || null,
    ...(contact.email ? { email: contact.email } : {}) })
  const transcript = messages.map((message) => `${message.role === "user" ? "Customer" : "Assistant"}: ${stripAssistantMoney(message.content)}`).join("\n")
    || "No assistant speech was captured before the shop handoff."
  isTest ||= /\[INTERNAL TEST\]/i.test(transcript)
  // A test can retain its evidence and file a test lead, but cannot relabel an
  // existing customer job or create recoverable outbound work for that job.
  if (isTest) {
    if (context.lead_id && context.lead_is_test === false) return { leadId: context.lead_id }
    const marked = (await sql`UPDATE assistant_sessions s SET is_test = true
      WHERE s.id = ${input.sessionId}::uuid AND NOT EXISTS (
        SELECT 1 FROM leads l WHERE l.id = s.lead_id AND l.is_test = false)
      RETURNING s.id`) as { id: string }[]
    if (!marked[0]) return { leadId: context.lead_id }
  }
  // Each later turn carries its own immutable snapshot. A retry reuses that
  // exact snapshot, while newly supplied contact/details reach the inbox too.
  const deliveryReason = input.deliveryReason ?? `${input.reason}${input.turnIndex > 0 ? `-${input.turnIndex}` : ""}`
  const key = `assistant-handoff:${input.sessionId}:${deliveryReason}`
  const snapshot: HandoffInput = { ...input, message: stripAssistantMoney(input.message),
    reply: input.reply ? stripAssistantMoney(input.reply) : undefined, fields, leadId: context.lead_id, isTest, deliveryReason }
  const requested = await recordEvent({
    kind: "assistant.handoff-request", externalId: key, actorType: "system",
    leadId: context.lead_id, body: transcript, crewBody: transcript,
    detail: { ...snapshot, sessionId: input.sessionId, isTest },
  })
  // Always reuse the first snapshot, including after a crash or a later turn.
  const prior = requested ? null : ((await sql`
    SELECT body, detail FROM events WHERE kind = 'assistant.handoff-request' AND external_id = ${key}::text LIMIT 1`) as {
    body: string; detail: HandoffInput
  }[])[0]
  if (!requested && !prior) throw new Error("Assistant handoff request could not be confirmed.")
  // Throttled requests retain evidence without bypassing the public request
  // budget for provider work. The bounded existing recovery pass delivers it.
  if (input.deferDelivery) return { leadId: context.lead_id }
  const savedTranscript = prior?.body ?? transcript
  let leadId = context.lead_id
  const hasContact = Boolean(fields.callback_phone || fields.email)
  if (!leadId && hasContact) {
    const intake = {
      sessionId: input.sessionId, fields, isTest, partial: true, transcript: savedTranscript,
    }
    let filed: { leadId: number; isTest: boolean }
    if (input.channel === "voice") {
      const { voiceDependencies } = await import("./voice-store.ts")
      const voice = await voiceDependencies(input.callSid!, input.from ?? input.callbackPhone ?? "")
      filed = await voice.deps.fileLead(intake)
    } else filed = await fileAssistantLead(intake)
    if (filed.isTest !== isTest) throw new Error("Assistant handoff intake test partition changed.")
    const linked = (await sql`
      UPDATE assistant_sessions SET lead_id = COALESCE(lead_id, ${filed.leadId}::bigint), updated_at = now()
      WHERE id = ${input.sessionId}::uuid AND is_test = ${isTest}::boolean RETURNING lead_id`) as { lead_id: number }[]
    if (!linked[0] || Number(linked[0].lead_id) !== filed.leadId) throw new Error("Assistant handoff lead could not be linked.")
    leadId = filed.leadId
  }
  const inserted = await recordEvent({
    kind: "assistant.handoff", externalId: key, actorType: "system", leadId,
    body: savedTranscript, crewBody: savedTranscript,
    detail: { sessionId: input.sessionId, reason: input.reason, fields, isTest },
  })
  const existingEvent = inserted ? null : ((await sql`
    SELECT id, lead_id FROM events WHERE kind = 'assistant.handoff' AND external_id = ${key}::text LIMIT 1`) as { id: number; lead_id: number | null }[])[0]
  const eventId = inserted ?? Number(existingEvent?.id)
  if (!eventId) throw new Error("Assistant handoff receipt could not be confirmed.")
  if (isTest) return { leadId }
  const url = leadId ? `/ops/leads/${leadId}` : `/board/updates?receipt=${eventId}#receipt`
  const work = [
    emailAssistantTranscript({ eventId, sessionId: input.sessionId, reason: deliveryReason, transcript: savedTranscript,
      leadId: inserted ? leadId : existingEvent!.lead_id, isTest: false }).then(async (status) => {
      if (status && status !== "accepted" && status !== "suppressed") {
        await notifyOwnerCellSms({ title: "Check assistant transcript email",
          body: `Transcript email to ${ASSISTANT_SHOP_EMAIL} is ${status}. Open the saved conversation and contact the customer.`,
          sourceEventId: eventId, url, dedupeKey: `${key}:email-status`, capExempt: true, quietHoursExempt: true })
      }
    }),
    notifyOwnerCellSms({ title: "Customer needs the shop", body: savedTranscript.slice(0, 400),
      sourceEventId: eventId, url, dedupeKey: `${key}:phone`, capExempt: true, quietHoursExempt: true }).then((alert) => {
      if (alert.reason === "not-for-role") throw new Error("The assistant shop phone recipient is not configured.")
    }),
    notifyAll({ priority: "interrupt", stock: "manila", title: "Customer needs the shop",
      body: savedTranscript.slice(0, 400), crewBody: savedTranscript.slice(0, 400),
      sourceEventId: eventId, url, dedupeKey: key, smsFallback: false }),
  ]
  if (leadId) work.push(notifyAll({
    priority: "interrupt", stock: "green", title: input.channel === "voice" ? "New welding request by phone" : "New welding request from chat",
    body: stripAssistantMoney(`${fields.name || "Callback requested"}: ${fields.need || "Partial assistant request"}`).slice(0, 400),
    crewBody: stripAssistantMoney(`${fields.name || "Callback requested"}: ${fields.need || "Partial assistant request"}`).slice(0, 400),
    sourceEventId: eventId, url, capExempt: true, dedupeKey: `assistant-lead:${input.sessionId}`, smsFallback: false,
  }))
  const outcomes = await Promise.allSettled(work)
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason
  await recordEvent({ kind: "assistant.handoff-complete", externalId: key, actorType: "system", leadId,
    body: "Assistant handoff projected to the shop delivery paths.",
    crewBody: "Assistant handoff projected to the shop delivery paths.",
    detail: { sessionId: input.sessionId, reason: input.reason, isTest: false } })
  return { leadId }
}

export async function recoverAssistantHandoffs(limit = 30, sessionId: string | null = null) {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return { recovered: 0, idle: 0, failed: 0 }
  const chat = process.env.NEXT_PUBLIC_ASSISTANT_CHAT === "1"
  const voice = process.env.ASSISTANT_VOICE === "1"
  if (!chat && !voice) return { recovered: 0, idle: 0, failed: 0 }
  const sql = getSql()
  const pending = (await sql`
    SELECT e.detail FROM events e WHERE e.kind = 'assistant.handoff-request'
      AND (e.is_test = false OR ${sessionId}::uuid IS NOT NULL)
      AND (${sessionId}::uuid IS NULL OR e.detail->>'sessionId' = ${sessionId}::text)
      AND ((COALESCE(e.detail->>'channel', 'chat') = 'chat' AND ${chat}::boolean)
        OR (e.detail->>'channel' = 'voice' AND ${voice}::boolean))
      AND (NOT EXISTS (SELECT 1 FROM events done WHERE done.kind = 'assistant.handoff-complete' AND done.external_id = e.external_id)
        OR NOT EXISTS (SELECT 1 FROM events sent WHERE sent.kind = 'email.out'
        AND sent.external_id = 'assistant-transcript:' || (e.detail->>'sessionId') || ':' || COALESCE(e.detail->>'deliveryReason', e.detail->>'reason'))
        OR (EXISTS (SELECT 1 FROM events intent JOIN events failed
            ON failed.kind = 'email.failed' AND failed.detail->>'sourceEventId' = intent.id::text
              AND failed.detail->>'ambiguous' = 'false'
            WHERE intent.kind = 'email.out' AND intent.detail->>'audience' = 'assistant-shop'
              AND intent.detail->>'sessionId' = e.detail->>'sessionId'
              AND intent.detail->>'reason' = COALESCE(e.detail->>'deliveryReason', e.detail->>'reason')
              AND NOT EXISTS (SELECT 1 FROM events newer WHERE newer.kind = 'email.out' AND newer.id > intent.id
                AND newer.detail->>'audience' = 'assistant-shop'
                AND newer.detail->>'sessionId' = intent.detail->>'sessionId'
                AND newer.detail->>'reason' = intent.detail->>'reason'))
          AND (SELECT count(*) FROM events intent WHERE intent.kind = 'email.out'
            AND intent.detail->>'audience' = 'assistant-shop' AND intent.detail->>'sessionId' = e.detail->>'sessionId'
            AND intent.detail->>'reason' = COALESCE(e.detail->>'deliveryReason', e.detail->>'reason')) < 3
          AND NOT EXISTS (SELECT 1 FROM events intent JOIN events accepted
            ON accepted.kind = 'email.accepted' AND accepted.detail->>'sourceEventId' = intent.id::text
            WHERE intent.kind = 'email.out' AND intent.detail->>'audience' = 'assistant-shop'
              AND intent.detail->>'sessionId' = e.detail->>'sessionId'
              AND intent.detail->>'reason' = COALESCE(e.detail->>'deliveryReason', e.detail->>'reason')))
        OR (e.detail->>'reason' = 'voice-no-answer' AND COALESCE(e.detail->>'callbackPhone', '') <> ''
          AND NOT EXISTS (SELECT 1 FROM messages m
            WHERE m.idempotency_key = 'assistant-no-answer:' || (e.detail->>'callSid')
              AND m.status <> 'persisted')))
    ORDER BY e.id ASC LIMIT ${limit}::int`) as { detail: HandoffInput }[]
  let recovered = 0
  let idle = 0
  let failed = 0
  for (const request of pending) {
    try {
      if (request.detail.reason === "voice-no-answer" && request.detail.callSid && request.detail.callbackPhone) {
        await finishAssistantVoiceHandoff({ callSid: request.detail.callSid, from: request.detail.from ?? request.detail.callbackPhone, isTest: request.detail.isTest })
      } else await deliverAssistantHandoff({ ...request.detail, deliveryReason: request.detail.deliveryReason ?? request.detail.reason, deferDelivery: false })
      recovered++
    } catch { failed++ }
  }
  // Idle contact capture uses the same lease as a live turn. An active customer
  // can never lose the session to an overlapping scheduled recovery pass.
  const candidates = (await sql`
    SELECT id, next_turn, is_test FROM assistant_sessions WHERE lead_id IS NULL
      AND (is_test = false OR id = ${sessionId}::uuid)
      AND (${sessionId}::uuid IS NULL OR id = ${sessionId}::uuid)
      AND updated_at < now() - interval '15 minutes' AND (lease_until IS NULL OR lease_until < now())
      AND ((substring(id::text, 15, 1) = '4' AND ${chat}::boolean))
      AND EXISTS (SELECT 1 FROM assistant_turns t WHERE t.session_id = assistant_sessions.id
        AND (t.inbound ~ '[[:digit:]][[:digit:] ().+-]{8,}' OR t.inbound LIKE '%@%'))
    ORDER BY updated_at ASC LIMIT ${limit}::int`) as { id: string; next_turn: number; is_test: boolean }[]
  for (const session of candidates) {
    const token = randomUUID()
    const claimed = (await sql`
      UPDATE assistant_sessions SET lease_token = ${token}::uuid, lease_until = now() + interval '5 minutes'
      WHERE id = ${session.id}::uuid AND lead_id IS NULL
        AND (is_test = false OR id = ${sessionId}::uuid)
        AND (${sessionId}::uuid IS NULL OR id = ${sessionId}::uuid)
        AND updated_at < now() - interval '15 minutes' AND (lease_until IS NULL OR lease_until < now())
      RETURNING id`) as { id: string }[]
    if (!claimed[0]) continue
    try {
      const turns = (await sql`SELECT inbound FROM assistant_turns WHERE session_id = ${session.id}::uuid ORDER BY turn_index ASC LIMIT 30`) as { inbound: string }[]
      const contact = extractAssistantContact(turns.map((turn) => ({ role: "user", content: turn.inbound })))
      if (!contact.callback_phone && !contact.email) continue
      await deliverAssistantHandoff({ sessionId: session.id, turnIndex: session.next_turn,
        message: "", reason: "idle", isTest: session.is_test })
      idle++
    } catch { failed++ } finally {
      await sql`UPDATE assistant_sessions SET lease_token = NULL, lease_until = NULL
        WHERE id = ${session.id}::uuid AND lease_token = ${token}::uuid`
    }
  }
  return { recovered, idle, failed }
}

export async function recordAssistantVoiceHandoff(input: {
  callSid: string; from: string; message: string; turnIndex: number
  reason: AssistantHandoffReason; isTest: boolean
}) {
  if (process.env.ASSISTANT_VOICE !== "1") return
  const { voiceDependencies } = await import("./voice-store.ts")
  const { voiceSessionId, voiceCallbackPhone } = await import("./voice.ts")
  const context = await voiceDependencies(input.callSid, input.from)
  await deliverAssistantHandoff({ ...input, sessionId: voiceSessionId(input.callSid),
    isTest: input.isTest || context.isTest,
    leadId: context.leadId, channel: "voice", callbackPhone: voiceCallbackPhone(context.from) })
}

export async function finishAssistantVoiceHandoff(input: { callSid: string; from: string; isTest: boolean }) {
  if (process.env.ASSISTANT_VOICE !== "1" || input.isTest) return
  const { voiceDependencies } = await import("./voice-store.ts")
  const { voiceSessionId, voiceCallbackPhone } = await import("./voice.ts")
  const context = await voiceDependencies(input.callSid, input.from)
  if (context.isTest) return
  const rows = (await getSql()`
    SELECT c.transcript, c.lead_id, c.person_id, (COALESCE(s.is_test, false)
      OR COALESCE(sl.is_test, false) OR COALESCE(sp.is_test, false)
      OR EXISTS (SELECT 1 FROM assistant_turns t WHERE t.session_id = s.id
        AND (t.is_test OR t.inbound ILIKE '%[INTERNAL TEST]%' OR COALESCE(t.result::text, '') ILIKE '%[INTERNAL TEST]%'))
    ) AS assistant_is_test
    FROM calls c LEFT JOIN assistant_sessions s ON s.id = ${voiceSessionId(input.callSid)}::uuid
      LEFT JOIN leads sl ON sl.id = s.lead_id LEFT JOIN people sp ON sp.id = sl.person_id
    WHERE c.twilio_sid = ${input.callSid}::text LIMIT 1`) as {
    transcript: string; lead_id: number | null; person_id: number | null; assistant_is_test: boolean
  }[]
  if (!rows[0] || rows[0].assistant_is_test || /\[INTERNAL TEST\]/i.test(rows[0].transcript)) return
  const phone = voiceCallbackPhone(context.from)
  const delivery = deliverAssistantHandoff({
    sessionId: voiceSessionId(input.callSid), turnIndex: 30, message: rows[0].transcript || "",
    reason: "voice-no-answer", leadId: rows[0].lead_id, isTest: false,
    channel: "voice", callSid: input.callSid, from: context.from, callbackPhone: phone,
  })
  if (!phone) { await delivery; return }
  const sms = import("@/lib/messages").then(({ sendSmsPersisted }) => sendSmsPersisted({
    to: phone, leadId: rows[0].lead_id, personId: rows[0].person_id,
    idempotencyKey: `assistant-no-answer:${input.callSid}`,
    body: `Music City Specialty Welding: reach the shop at ${getShopPhone().display} or ${ASSISTANT_SHOP_EMAIL}. Reply with your callback number and job details for shop review.`,
  }))
  // A failed email or intake cannot prevent the independent persisted SMS.
  const outcomes = await Promise.allSettled([delivery, sms])
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason
}
