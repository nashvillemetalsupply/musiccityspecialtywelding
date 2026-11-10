import type { AssistantFields, AssistantMessage, AssistantTurn } from "./turn.ts"
import type { AssistantInput } from "./input.ts"
import { AssistantRequestError } from "./input.ts"
import { stripAssistantMoney } from "./money.ts"
import { assistantContactReply, assistantHandoffReason, assistantSpanish, extractAssistantContact, type AssistantHandoffReason } from "./contact.ts"
import { nextAssistantQuestion } from "./intake.ts"

export type AssistantResponse = { ok: true; reply: string; fields: AssistantFields; lead_saved: boolean; handoff_reason?: AssistantHandoffReason; continue_intake?: boolean }
export type AssistantSession = { id: string; next_turn: number; is_test: boolean; lead_id: number | null }
export type AssistantStoredTurn = {
  inbound: string
  result: AssistantTurn | null
  response: AssistantResponse | null
  lead_captured: boolean
}
export type AssistantClaim = { session: AssistantSession; turn: AssistantStoredTurn; token: string }

export interface AssistantStore {
  begin(input: AssistantInput): Promise<AssistantClaim | AssistantResponse>
  history(sessionId: string, turnIndex: number): Promise<AssistantMessage[]>
  saveModel(claim: AssistantClaim, index: number, result: AssistantTurn): Promise<void>
  verifyLease(claim: AssistantClaim): Promise<void>
  saveLead(claim: AssistantClaim, index: number, leadId: number): Promise<void>
  finish(claim: AssistantClaim, index: number, response: AssistantResponse): Promise<void>
  release(claim: AssistantClaim): Promise<void>
}

export type AssistantDependencies = {
  store: AssistantStore
  rateLimit: (key: string, windowMs: number, maxAttempts: number) => Promise<boolean>
  fingerprint: (value: string) => string
  model: (messages: AssistantMessage[], options: {
    isTest: boolean; phone: { display: string; href: string }
    signal?: AbortSignal; voice?: { callbackPhone: string }
  }) => Promise<AssistantTurn>
  validPhone: (value: string) => string
  fileLead: (input: { sessionId: string; fields: AssistantFields; isTest: boolean; partial?: boolean; transcript?: string }) => Promise<{ leadId: number; isTest: boolean }>
  receipt: (input: { sessionId: string; turnIndex: number; leadId: number; fields: AssistantFields; isTest: boolean }) => Promise<number>
  notify: (input: { sessionId: string; turnIndex: number; leadId: number; eventId: number; fields: AssistantFields }) => Promise<void>
  followUpLead?: (input: { leadId: number; eventId: number; fields: AssistantFields; isTest: boolean }) => Promise<void>
  handoff?: (input: {
    sessionId: string; turnIndex: number; message: string; reply: string; fields: AssistantFields
    reason: AssistantHandoffReason; leadId: number | null; isTest: boolean
  }) => Promise<{ leadId: number | null }>
  phone: { display: string; href: string }
}

function scrubTurn(turn: AssistantTurn): AssistantTurn {
  const clean = (value: string | null, limit: number) => value ? stripAssistantMoney(value).slice(0, limit) || null : null
  return {
    reply: stripAssistantMoney(turn.reply).slice(0, 1200),
    ...(turn.handoff_reason ? { handoff_reason: turn.handoff_reason } : {}),
    ...(turn.handoff_reason === "unknown" && turn.continue_intake ? { continue_intake: true } : {}),
    fields: {
      name: clean(turn.fields.name, 120), callback_phone: clean(turn.fields.callback_phone, 40),
      need: clean(turn.fields.need, 400) ?? "", material_size: clean(turn.fields.material_size, 200),
      location: clean(turn.fields.location, 200), timing: clean(turn.fields.timing, 160),
      callback_window: clean(turn.fields.callback_window ?? null, 160), is_job: turn.fields.is_job,
      ...(turn.fields.email ? { email: clean(turn.fields.email, 254) } : {}),
    },
  }
}

export async function processAssistantTurn(input: AssistantInput, ip: string, deps: AssistantDependencies): Promise<AssistantResponse> {
  // Both keys are durable and fail closed, including requests without a trusted IP.
  if (await deps.rateLimit(`assist:ip:${deps.fingerprint(ip || "unknown")}`, 10 * 60_000, 60)
    || await deps.rateLimit(`assist:session:${input.session_id}`, 10 * 60_000, 40)) {
    throw new AssistantRequestError(`Too many messages. Please wait or call ${deps.phone.display}.`, 429)
  }
  const sanitized = { ...input, message: stripAssistantMoney(input.message) }
  if (sanitized.message.length > 2000) throw new AssistantRequestError("That message is too long. Please shorten it.", 413)
  const begun = await deps.store.begin(sanitized)
  if ("ok" in begun) return begun
  const claim = begun
  try {
    let result = claim.turn.result
    if (!result) {
      // begin has durably inserted the inbound turn before this first provider call.
      const messages = await deps.store.history(input.session_id, input.turn_index)
      const customerText = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n")
      await deps.store.verifyLease(claim)
      try {
        result = scrubTurn(await deps.model(messages, { isTest: claim.session.is_test, phone: deps.phone }))
      } catch {
        // The inbound is already durable. An unavailable model must leave both
        // a useful customer reply and enough customer evidence for a callback.
        const contact = extractAssistantContact(messages)
        result = {
          reply: assistantContactReply(deps.phone, sanitized.message), handoff_reason: "model-error",
          fields: {
            name: null, callback_phone: contact.callback_phone, need: sanitized.message.slice(0, 400),
            material_size: null, location: null, timing: null, callback_window: null, is_job: "unsure",
            ...(contact.email ? { email: contact.email } : {}),
          },
        }
      }
      const detectedReason = assistantHandoffReason(sanitized.message, result.reply, result.handoff_reason)
      const reason = result.fields.is_job === "no" && detectedReason !== "human" && !result.handoff_reason ? null : detectedReason
      if (reason) result = { ...result,
        reply: reason === "unknown" && result.continue_intake ? result.reply : assistantContactReply(deps.phone, customerText, result.fields.callback_phone ? nextAssistantQuestion(result.fields, messages) : undefined),
        handoff_reason: reason,
      }
      if (!messages.some((message) => message.role === "assistant")
        && !/^I(?:'m| am) an automated assistant\b|^Soy un asistente automatizado\b/i.test(result.reply)) {
        result = { ...result, reply: `${assistantSpanish(customerText) ? "Soy un asistente automatizado de Music City Specialty Welding." : "I'm an automated assistant for Music City Specialty Welding."} ${result.reply}` }
      }
      await deps.store.saveModel(claim, input.turn_index, result)
      claim.turn.result = result
    }
    await deps.store.verifyLease(claim)
    const fields = result.fields
    const callback = deps.validPhone(fields.callback_phone ?? "")
    if (!claim.session.lead_id && fields.is_job === "yes" && fields.name && callback && fields.need.trim()) {
      const filed = await deps.fileLead({ sessionId: input.session_id, fields: { ...fields, callback_phone: callback }, isTest: claim.session.is_test })
      if (filed.isTest !== claim.session.is_test) throw new AssistantRequestError("Start a new chat for this request.", 409)
      await deps.store.saveLead(claim, input.turn_index, filed.leadId)
      claim.session.lead_id = filed.leadId
      claim.turn.lead_captured = true
    }
    if (claim.session.lead_id) {
      const eventId = await deps.receipt({ sessionId: input.session_id, turnIndex: input.turn_index, leadId: claim.session.lead_id, fields, isTest: claim.session.is_test })
      // The receipt is durable before the notification gate; its dedupe key is per session.
      if (claim.turn.lead_captured && !claim.session.is_test && (!result.handoff_reason || !deps.handoff)) {
        await deps.notify({ sessionId: input.session_id, turnIndex: input.turn_index, leadId: claim.session.lead_id, eventId, fields })
      }
      await deps.store.verifyLease(claim)
      await deps.followUpLead?.({ leadId: claim.session.lead_id, eventId, fields, isTest: claim.session.is_test })
    }
    if (result.handoff_reason) {
      await deps.store.verifyLease(claim)
      const handed = await deps.handoff?.({
        sessionId: input.session_id, turnIndex: input.turn_index, message: sanitized.message,
        reply: result.reply, fields, reason: result.handoff_reason,
        leadId: claim.session.lead_id, isTest: claim.session.is_test,
      })
      if (handed?.leadId && !claim.session.lead_id) {
        await deps.store.saveLead(claim, input.turn_index, handed.leadId)
        claim.session.lead_id = handed.leadId
      }
    }
    const response: AssistantResponse = {
      ok: true, reply: result.reply, fields, lead_saved: Boolean(claim.session.lead_id),
      ...(result.handoff_reason ? { handoff_reason: result.handoff_reason } : {}),
      ...(result.handoff_reason === "unknown" && result.continue_intake ? { continue_intake: true } : {}),
    }
    await deps.store.finish(claim, input.turn_index, response)
    return response
  } finally {
    await deps.store.release(claim)
  }
}
