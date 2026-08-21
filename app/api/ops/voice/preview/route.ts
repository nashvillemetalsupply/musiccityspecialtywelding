import { gateway } from "@ai-sdk/gateway"
import { experimental_generateSpeech, generateText } from "ai"
import { AI_MODELS, aiConfigured } from "@/lib/ai"
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
  if (!aiConfigured()) return Response.json({ error: "The voice preview is waiting for AI Gateway access." }, { status: 503 })

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
      model: AI_MODELS.reasoning,
      speechModel: AI_MODELS.speech,
    },
  })

  const draft = await generateText({
    model: AI_MODELS.reasoning,
    system: `${guide}\n\nYou are writing one short piece of copy in that voice. Under 45 words. No greeting the profile does not show him using, no marketing language, no invented prices, names, or dates -- say the thing plainly and stop.`,
    prompt: `Write ${SCENARIOS[scenario]}. Use no customer name and no specific price; keep it to what he would actually say.`,
  })
  const text = draft.text.replace(/\s+/g, " ").trim().slice(0, 600)
  if (!text) return Response.json({ error: "The preview came back empty." }, { status: 502 })

  // The audio is the shop's stock speech voice reading his words. It is his
  // language, not his throat -- a clone of the man's actual sound needs his
  // recordings and his say-so, and is not what this button does.
  const speech = await experimental_generateSpeech({
    model: gateway.speechModel(AI_MODELS.speech),
    text,
    voice: process.env.AI_SPEECH_VOICE?.trim() || "onyx",
    outputFormat: "mp3",
    speed: 1.02,
  })

  return Response.json({
    eventId,
    scenario,
    text,
    lineCount: profile.lineCount,
    sourceCount: profile.sourceCount,
    audio: Buffer.from(speech.audio.uint8Array).toString("base64"),
    audioType: speech.audio.mediaType || "audio/mpeg",
  }, { headers: { "Cache-Control": "no-store" } })
}
