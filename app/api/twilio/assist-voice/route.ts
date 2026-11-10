import { isConfiguredTwilioNumber, readTwilioForm, twilioVoiceConfigured, twiml } from "@/lib/twilio"
import { after } from "next/server"
import { ASSISTANT_MAX_MESSAGE, ASSISTANT_MAX_TURNS } from "@/lib/assistant/input.ts"
import { assistantHandoffReason } from "@/lib/assistant/contact.ts"
import { processVoiceTurn, voiceFallback, voiceGather, voiceHandoff, voiceSessionId, VOICE_DISCLOSURE } from "@/lib/assistant/voice.ts"

export const runtime = "nodejs"

function saveHandoff(params: URLSearchParams, turnIndex: number, reason: "human" | "unknown" | "model-error") {
  after(async () => {
    try {
      const { recordAssistantVoiceHandoff } = await import("@/lib/assistant/handoff.ts")
      await recordAssistantVoiceHandoff({ callSid: params.get("CallSid")!, from: params.get("From") ?? "",
        message: params.get("SpeechResult")?.trim() || (params.get("Digits") ? "Pressed zero to reach a person." : ""),
        turnIndex, reason, isTest: /\[INTERNAL TEST\]/i.test(`${params.get("CallerName") ?? ""} ${params.get("SpeechResult") ?? ""}`) })
    } catch { console.error("Assistant voice handoff could not be saved.") }
  })
}

export async function POST(req: Request) {
  if (!twilioVoiceConfigured()) return twiml("<Say>The shop line is not configured.</Say>", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)
  if (!isConfiguredTwilioNumber(params.get("To") ?? "")) return twiml("", 403)
  const callSid = params.get("CallSid") ?? ""
  const markedTest = /\[INTERNAL TEST\]/i.test(`${params.get("CallerName") ?? ""} ${params.get("SpeechResult") ?? ""}`)
  if (!/^CA[0-9a-f]{32}$/i.test(callSid)
    && !(markedTest && /^CA_INTERNAL_TEST_[0-9a-f]{32}$/i.test(callSid))) return twiml("", 400)
  const query = new URL(req.url).searchParams
  if (query.get("handoff") === "1") {
    if (["answered", "completed"].includes(params.get("DialCallStatus") ?? "")) {
      // A Gather timeout can reach the inline Dial without a speech action.
      // Preserve any earlier answers even when a person answers that Dial.
      if (process.env.ASSISTANT_VOICE === "1") saveHandoff(params, 30, "unknown")
      return twiml("")
    }
    if (process.env.ASSISTANT_VOICE === "1" && ["no-answer", "busy", "failed", "canceled"].includes(params.get("DialCallStatus") ?? "")) after(async () => {
      try {
        const { finishAssistantVoiceHandoff } = await import("@/lib/assistant/handoff.ts")
        await finishAssistantVoiceHandoff({ callSid: params.get("CallSid")!, from: params.get("From") ?? "",
          isTest: /\[INTERNAL TEST\]/i.test(params.get("CallerName") ?? "") })
      } catch { console.error("Assistant missed handoff needs recovery.") }
    })
    return voiceFallback()
  }
  // Even a direct signed webhook cannot invoke the assistant with the flag off.
  if (process.env.ASSISTANT_VOICE !== "1") return voiceFallback()
  const speech = params.get("SpeechResult")?.trim() ?? ""
  const turn = query.get("turn")
  const turnIndex = /^\d{1,2}$/.test(turn ?? "") ? Math.min(Number(turn), ASSISTANT_MAX_TURNS) : 0
  if (params.get("Digits") || assistantHandoffReason(speech) === "human") {
    saveHandoff(params, turnIndex, "human")
    return voiceHandoff()
  }
  if (turn === null && !speech) return voiceGather(VOICE_DISCLOSURE, 0)
  if (!speech || speech.length > ASSISTANT_MAX_MESSAGE || !/^\d{1,2}$/.test(turn ?? "") || Number(turn) >= ASSISTANT_MAX_TURNS) {
    saveHandoff(params, turnIndex, "unknown")
    return voiceHandoff()
  }
  try {
    // Disabled paths never initialize assistant storage; immediate Dial paths
    // persist their evidence after returning TwiML and never wait on the model.
    const { voiceDependencies } = await import("@/lib/assistant/voice-store.ts")
    const callSid = params.get("CallSid")!
    const context = await voiceDependencies(callSid, params.get("From") ?? "")
    const followUpLead = context.deps.followUpLead
    const result = await processVoiceTurn({
      callSid, turnIndex: Number(turn), speech, from: context.from,
      isTest: context.isTest || /\[INTERNAL TEST\]/i.test(params.get("CallerName") ?? ""),
    }, { ...context.deps, ...(followUpLead ? { followUpLead: async (input) => {
      // Photo invitations also use a provider. The immutable voice receipt is
      // already saved, so this projection can run after TwiML reaches Twilio.
      after(async () => {
        try { await followUpLead(input) } catch { console.error("Assistant voice photo followup needs recovery.") }
      })
    } } : {}) })
    if (result.lead_saved || result.handoff_reason) after(async () => {
      try {
        const { recoverAssistantHandoffs } = await import("@/lib/assistant/handoff.ts")
        await recoverAssistantHandoffs(5, voiceSessionId(callSid))
      } catch { console.error("Assistant voice delivery needs recovery.") }
    })
    if (result.handoff_reason && !(result.handoff_reason === "unknown" && result.continue_intake)) return voiceHandoff()
    if (!result.fields.callback_phone && result.fields.name && result.fields.need) {
      saveHandoff(params, turnIndex, "unknown")
      return voiceHandoff("I couldn't get a callback number. I'll try the shop now.")
    }
    if (Number(turn) + 1 < ASSISTANT_MAX_TURNS) return voiceGather(result.reply, Number(turn) + 1)
    saveHandoff(params, turnIndex, "unknown")
    return voiceHandoff()
  } catch {
    // Never expose provider errors or customer content in TwiML or logs.
    saveHandoff(params, turnIndex, "model-error")
    return voiceHandoff("I couldn't finish that. I'll try the shop now.")
  }
}
