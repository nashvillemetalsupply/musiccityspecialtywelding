import { gateway } from "@ai-sdk/gateway"
import { experimental_generateSpeech, generateText } from "ai"
import { AI_MODELS, DEEPSEEK_MODEL, aiConfigured, deepseekConfigured, draftWithDeepSeek } from "@/lib/ai"
import { recordEvent } from "@/lib/events"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getOwnerVoiceProfile, ownerVoiceGuide } from "@/lib/voice-of-character"
import { voiceProfileIsUsable } from "@/lib/voice-of-character.mjs"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

// What the preview is allowed to be about. The scenario is fixed here rather
// than typed by the caller, so a preview button can never become a way to make
// the shop say an arbitrary sentence in the owner's voice.
const SCENARIOS = {
  voicemail: "a voicemail he is leaving for a customer whose gate quote is ready",
  text: "a text telling a customer their job is done and ready for pickup",
  email: "the first two sentences of an email answering a price question",
} as const

type Scenario = keyof typeof SCENARIOS

export async function POST(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (operator.role !== "owner") return Response.json({ error: "The voice preview is owner-only." }, { status: 403 })

  const json = await req.json().catch(() => ({})) as { scenario?: string }
  const scenario: Scenario = (Object.keys(SCENARIOS) as Scenario[]).includes(json.scenario as Scenario)
    ? (json.scenario as Scenario)
    : "voicemail"

  const [profile, guide] = await Promise.all([getOwnerVoiceProfile(), ownerVoiceGuide()])
  // A thin corpus is refused rather than padded out. Hearing an invented voice
  // and being told it is his is worse than hearing nothing.
  if (!profile || !voiceProfileIsUsable(profile) || !guide) {
    return Response.json({
      error: "There is not enough of him on record yet.",
      lineCount: profile?.lineCount ?? 0,
      sourceCount: profile?.sourceCount ?? 0,
    }, { status: 409 })
  }
  // Either drafter will do. DeepSeek is preferred when the shop's own key is
  // set: it is the one the shop already pays for, and the gateway's plan does
  // not run paid models.
  const drafter = deepseekConfigured() ? DEEPSEEK_MODEL : AI_MODELS.reasoning
  if (!deepseekConfigured() && !aiConfigured()) {
    return Response.json({ error: "The voice preview has no model to draft with." }, { status: 503 })
  }

  // Intent before the provider call, the same order every other AI path here
  // keeps: the receipt exists whether or not the gateway answers.
  const eventId = await recordEvent({
    kind: "voice.preview",
    actorType: "operator",
    actorId: operator.id,
    body: `Voice preview: ${scenario}`,
    detail: {
      scenario,
      lineCount: profile.lineCount,
      sourceCount: profile.sourceCount,
      model: drafter,
      speechModel: AI_MODELS.speech,
    },
  })

  const system = `${guide}\n\nYou are writing one short piece of copy in that voice. Under 45 words. No greeting the profile does not show him using, no marketing language, no invented prices, names, or dates -- say the thing plainly and stop.`
  const ask = `Write ${SCENARIOS[scenario]}. Use no customer name and no specific price; keep it to what he would actually say.`

  // The words are the point, so a failure here is the end of the request. An
  // unhandled throw would return a 500 the browser cannot read, and the board
  // printed "the preview could not be built" over a gateway that had said
  // exactly what was wrong. A refusal the owner can act on is the whole
  // difference between a bug and a bill.
  let text = ""
  try {
    text = deepseekConfigured()
      ? await draftWithDeepSeek({ system, prompt: ask })
      : (await generateText({ model: AI_MODELS.reasoning, system, prompt: ask })).text
    text = text.replace(/\s+/g, " ").trim().slice(0, 600)
    if (!text) return Response.json({ error: "The preview came back empty." }, { status: 502 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model refused the request."
    const restricted = /free tier|do not have access|no_providers_available|quota|credit|balance/i.test(message)
    console.error("Voice preview draft failed:", error)
    return Response.json({
      error: restricted
        ? `${drafter} will not run on the current plan or balance. ${message.slice(0, 160)}`
        : message.slice(0, 300),
      reason: restricted ? "model-plan" : "model",
    }, { status: restricted ? 402 : 502 })
  }

  // Speech is the optional half. DeepSeek has no text-to-speech at all and the
  // gateway's is behind the same plan wall, so a preview that cannot be spoken
  // still returns his words -- the board reads them in the browser's own voice
  // rather than throwing away a draft that came back fine.
  let audio = ""
  let audioType = ""
  try {
    if (!aiConfigured()) throw new Error("No speech provider is configured.")
    const speech = await experimental_generateSpeech({
      model: gateway.speechModel(AI_MODELS.speech),
      text,
      voice: process.env.AI_SPEECH_VOICE?.trim() || "onyx",
      outputFormat: "mp3",
      speed: 1.02,
    })
    audio = Buffer.from(speech.audio.uint8Array).toString("base64")
    audioType = speech.audio.mediaType || "audio/mpeg"
  } catch (error) {
    console.error("Voice preview speech unavailable; returning text only:", error)
  }

  return Response.json({
    eventId,
    scenario,
    text,
    drafter,
    lineCount: profile.lineCount,
    sourceCount: profile.sourceCount,
    audio,
    audioType,
    // The board says which voice the owner is about to hear, so a browser voice
    // is never mistaken for the shop having bought one.
    spokenBy: audio ? "provider" : "browser",
  }, { headers: { "Cache-Control": "no-store" } })
}
