import { createHash } from "node:crypto"
import { escapeXml, twilioCallbackUrl, twilioInboundDialTarget, twiml } from "../twilio.ts"
import { stripAssistantMoney } from "./money.ts"
import { processAssistantTurn, type AssistantDependencies } from "./service.ts"

export const VOICE_MODEL_BUDGET_MS = 8_000
export const VOICE_DISCLOSURE = "I'm an automated assistant for Music City Specialty Welding. Your answers are saved for job notes. Say person or press zero at any time. What needs welding or repair?"

// UUIDv8 keeps the CallSid identity stable across instances and retries, and
// outside the v4-only public chat namespace. No new schema or channel column.
export function voiceSessionId(callSid: string): string {
  const hex = createHash("sha256").update(`mcsw-assistant-voice:${callSid}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function voiceCallbackPhone(from: string): string {
  if (!/^[+\d ().-]+$/.test(from)) return ""
  const digits = from.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return ""
  const reserved = ["6157033296", "6158104910", ...[
    "TWILIO_PHONE_NUMBER", "OWNER_CELL_PHONE", "NEXT_PUBLIC_TWILIO_PHONE_NUMBER_GOOGLE",
    "NEXT_PUBLIC_TWILIO_PHONE_NUMBER_FACEBOOK", "TWILIO_PHONE_NUMBER_LD2R",
    "TWILIO_PHONE_NUMBER_GREASE", "TWILIO_PHONE_NUMBER_RAILING",
  ].map((key) => process.env[key] ?? "")]
  return reserved.some((value) => value.replace(/\D/g, "").slice(-10) === digits) ? "" : `+1${digits}`
}

export function voiceFallback() {
  return twiml(`<Redirect method="POST">${escapeXml(twilioCallbackUrl("/api/twilio/fallback"))}</Redirect>`)
}

function handoffXml(line: string) {
  // Unrecorded, like /fallback. Let the owner's existing carrier voicemail
  // answer; if Dial fails, use /fallback once, never reenter the assistant.
  return `<Say>${escapeXml(line)}</Say><Dial answerOnBridge="true" action="${escapeXml(twilioCallbackUrl("/api/twilio/assist-voice?handoff=1"))}" method="POST">${twilioInboundDialTarget(process.env.OWNER_CELL_PHONE!.trim())}</Dial>`
}

export function voiceHandoff(line = "I'll try the shop now.") {
  return twiml(handoffXml(line))
}

export function voiceGather(reply: string, nextTurn: number) {
  const clean = stripAssistantMoney(reply)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(?:https?:\/\/|tel:)[^\s)]+/gi, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
  // A phone never reads a price or the storage redaction placeholder aloud.
  const safe = /\[owner-only money\]/i.test(clean) || !clean.trim() || clean.length > 320
    ? "The shop can help with that. Say person or press zero, or tell me what needs welding."
    : clean
  const action = escapeXml(twilioCallbackUrl(`/api/twilio/assist-voice?turn=${nextTurn}`))
  return twiml(`<Gather input="speech dtmf" numDigits="1" timeout="5" speechTimeout="auto" action="${action}" method="POST"><Say>${escapeXml(safe)}</Say></Gather>${handoffXml("I'll try the shop now.")}`)
}

export async function processVoiceTurn(input: {
  callSid: string; turnIndex: number; speech: string; from: string; isTest: boolean
}, deps: AssistantDependencies) {
  const callbackPhone = voiceCallbackPhone(input.from)
  return processAssistantTurn({
    session_id: voiceSessionId(input.callSid), turn_index: input.turnIndex,
    message: input.speech, is_test: input.isTest || /\[INTERNAL TEST\]/i.test(input.speech),
  }, input.callSid, {
    ...deps,
    validPhone: (value) => callbackPhone && value === callbackPhone ? callbackPhone : "",
    model: async (messages, options) => {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        // Race inside the model boundary: even an uncooperative late provider
        // cannot continue into saveModel/fileLead after we've handed off.
        const result = await Promise.race([
          deps.model(messages, { ...options, signal: controller.signal, voice: { callbackPhone } }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort()
              reject(new Error("Voice model budget exceeded."))
            }, VOICE_MODEL_BUDGET_MS)
          }),
        ])
        return { ...result, fields: { ...result.fields, callback_phone: callbackPhone || null } }
      } finally {
        clearTimeout(timer)
      }
    },
  })
}
