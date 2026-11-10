import { readAssistantInput, AssistantRequestError, type AssistantInput } from "@/lib/assistant/input.ts"
import { assistantContactReply } from "@/lib/assistant/contact.ts"
import { processAssistantTurn } from "@/lib/assistant/service.ts"
import { PostgresAssistantStore } from "@/lib/assistant/store.ts"
import { handleAssistantTurn } from "@/lib/assistant/turn.ts"
import { stripAssistantMoney } from "@/lib/assistant/money.ts"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { fileAssistantLead } from "@/lib/job-intake"
import { normalizePhone, isReservedShopPhone } from "@/lib/people"
import { consumeStrictRateLimit, rateLimitFingerprint } from "@/lib/rate-limit"
import { getShopPhone } from "@/lib/shop-contact"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" }
  if (process.env.NEXT_PUBLIC_ASSISTANT_CHAT !== "1") {
    return Response.json({ ok: false, error: "Chat is not available. Please call the shop." }, { status: 404, headers })
  }
  let input: AssistantInput | undefined
  try {
    input = await readAssistantInput(request)
    const ip = (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown").slice(0, 200)
    const phone = getShopPhone()
    const response = await processAssistantTurn(input, ip, {
      store: new PostgresAssistantStore(), phone,
      rateLimit: consumeStrictRateLimit, fingerprint: rateLimitFingerprint,
      model: handleAssistantTurn,
      validPhone: (value) => {
        const normalized = normalizePhone(value)
        return normalized && !isReservedShopPhone(normalized) && !["6157033296", "6158104910"].includes(normalized.replace(/\D/g, "").slice(-10)) ? normalized : ""
      },
      fileLead: fileAssistantLead,
      handoff: async (input) => {
        const { deliverAssistantHandoff } = await import("@/lib/assistant/handoff.ts")
        return deliverAssistantHandoff(input)
      },
      followUpLead: async (input) => {
        const { followUpAssistantLead } = await import("@/lib/assistant/followup.ts")
        await followUpAssistantLead(input)
      },
      receipt: async ({ sessionId, turnIndex, leadId, fields, isTest }) => {
        const externalId = `${sessionId}:${turnIndex}`
        const body = stripAssistantMoney([
          isTest ? "[INTERNAL TEST]" : "", fields.need, fields.material_size, fields.location,
          fields.timing ? `Requested timing: ${fields.timing}` : "",
          fields.callback_window ? `Callback requested: ${fields.callback_window}` : "",
        ].filter(Boolean).join(" · ")).slice(0, 1200)
        const eventId = await recordEvent({
          kind: "assistant.chat", actorType: "customer", leadId, externalId,
          body, crewBody: body, detail: { sessionId, turnIndex, fields, isTest },
        })
        if (eventId) return eventId
        const rows = (await getSql()`SELECT id FROM events WHERE kind = 'assistant.chat' AND external_id = ${externalId}::text LIMIT 1`) as { id: number }[]
        if (!rows[0]) throw new Error("Chat receipt could not be confirmed.")
        return Number(rows[0].id)
      },
      notify: async ({ sessionId, turnIndex, leadId, fields }) => {
        // Qualified leads need the same durable transcript email and shop alert
        // as an explicit human handoff. The shared outbox owns all delivery.
        const { deliverAssistantHandoff } = await import("@/lib/assistant/handoff.ts")
        await deliverAssistantHandoff({ sessionId, turnIndex, leadId, fields,
          message: "", reason: "lead", isTest: false })
      },
    })
    return Response.json(response, { headers })
  } catch (error) {
    // Include the rejected inbound even when throttling or an active lease
    // prevented a normal turn. The handoff outbox is independent of that lease.
    if (input && (!(error instanceof AssistantRequestError) || [409, 429].includes(error.status))) {
      try {
        const { deliverAssistantHandoff } = await import("@/lib/assistant/handoff.ts")
        await deliverAssistantHandoff({ sessionId: input.session_id, turnIndex: input.turn_index,
          message: input.message, isTest: input.is_test,
          deferDelivery: error instanceof AssistantRequestError && error.status === 429,
          reason: error instanceof AssistantRequestError && error.status === 429 ? "rate-limit" : "unavailable" })
      } catch { console.error("Assistant chat handoff could not be saved.") }
    }
    if (error instanceof AssistantRequestError) {
      return Response.json({ ok: false, error: assistantContactReply(getShopPhone()) }, {
        status: error.status,
        headers: { ...headers, ...([409, 429].includes(error.status) ? { "Retry-After": error.status === 429 ? "600" : "5" } : {}) },
      })
    }
    // Provider bodies and customer text never reach public errors or logs.
    console.error("Assistant chat could not finish saving.")
    return Response.json({ ok: false, error: assistantContactReply(getShopPhone()) }, { status: 503, headers: { ...headers, "Retry-After": "15" } })
  }
}
