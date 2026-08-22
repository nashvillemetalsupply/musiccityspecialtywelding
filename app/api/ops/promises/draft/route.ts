import { generateText } from "ai"
import { AI_MODELS, DEEPSEEK_MODEL, aiConfigured, deepseekConfigured, draftWithDeepSeek } from "@/lib/ai"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { redactCrewText } from "@/lib/visibility"
import { ownerVoiceGuide } from "@/lib/voice-of-character"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

// The apology that goes out when the shop is late, written the way the owner
// writes. Three boundaries, and none of them are style choices:
//
// - The model is told the promise and nothing else. It never sees the price,
//   the invoice, or the thread. What it gets is the crew-safe wording that was
//   already redacted for exactly this reason, so there is no money in the room.
// - The model never writes the new date. `handlePromise` appends it server-side
//   from the dropdown the owner picked, which is the one fact a drafted
//   sentence could get wrong in a way the customer would act on.
// - Nothing is sent from here. This returns words into a box the owner has to
//   read and submit. A one-tap send of an AI sentence under his name is the
//   version of this feature that can actually cost him a customer.
export async function POST(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })

  const json = await req.json().catch(() => ({})) as { leadId?: unknown; commitmentId?: unknown }
  const leadId = Number(json.leadId)
  const commitmentId = Number(json.commitmentId)
  if (!Number.isInteger(leadId) || leadId <= 0 || !Number.isInteger(commitmentId) || commitmentId <= 0) {
    return Response.json({ error: "That promise is not valid." }, { status: 400 })
  }

  const sql = getSql()
  // The promise has to be the shop's own, still owed, and actually late --
  // the same three conditions the Handle it box itself is shown under. A
  // hand-posted id cannot make the shop apologise for something else.
  const rows = (await sql`
    SELECT c.summary, c.crew_summary, c.due_at, l.service, l.is_test
    FROM commitments c
    JOIN leads l ON l.id = c.lead_id
    WHERE c.id = ${commitmentId}::bigint
      AND c.lead_id = ${leadId}::bigint
      AND c.status = 'open'
      AND c.direction = 'we_promised'
      AND c.due_at IS NOT NULL
      AND c.due_at < now()
    LIMIT 1`) as Array<{
      summary: string
      crew_summary: string | null
      due_at: string
      service: string
      is_test: boolean
    }>
  const promise = rows[0]
  if (!promise) return Response.json({ error: "That promise is not late, or not ours." }, { status: 404 })

  // Already redacted for crew, which is the same standard a customer-facing
  // sentence needs. Falling back through the redactor rather than the raw
  // summary keeps money out even when extraction wrote no crew copy.
  const promiseText = (promise.crew_summary?.trim() || redactCrewText(promise.summary)).slice(0, 400)

  const guide = await ownerVoiceGuide()
  // Not enough of him on record. The box keeps its plain default rather than
  // being handed an invented voice and told it is his.
  if (!guide) {
    return Response.json({ error: "There is not enough of him on record to write in his voice yet.", reason: "voice-thin" }, { status: 409 })
  }
  if (!deepseekConfigured() && !aiConfigured()) {
    return Response.json({ error: "There is no model configured to draft with.", reason: "no-model" }, { status: 503 })
  }
  const drafter = deepseekConfigured() ? DEEPSEEK_MODEL : AI_MODELS.reasoning

  // Intent before the provider call, the order every AI path here keeps: the
  // receipt exists whether or not the model answers.
  const eventId = await recordEvent({
    kind: "commitment.draft-requested",
    actorType: "operator",
    actorId: operator.id,
    leadId,
    body: "Drafted a late-promise text in the owner's voice",
    crewBody: "Drafted a late-promise text",
    detail: { commitmentId, model: drafter, isTest: promise.is_test },
  })

  const system = `${guide}

You are writing one short text message to a customer, in that voice. The shop is late on something it promised. Rules, all of them absolute:
- Under 40 words. One or two sentences.
- Own it plainly and apologise once. No excuses, no explanation of why.
- Never write a date, a day, a time, or a price. The new date is added afterwards by the shop's own system.
- Never invent a fact, a name, or a detail that is not in the promise below.
- No marketing language, no filler, no sign-off the profile does not show him using.`
  const ask = `The promise the shop is late on: "${promiseText}". Write the text.`

  let text = ""
  try {
    text = deepseekConfigured()
      ? await draftWithDeepSeek({ system, prompt: ask })
      : (await generateText({ model: AI_MODELS.reasoning, system, prompt: ask })).text
    text = text.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "").slice(0, 400)
    if (!text) return Response.json({ error: "The draft came back empty.", reason: "model" }, { status: 502 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model refused the request."
    const restricted = /free tier|do not have access|no_providers_available|quota|credit|balance/i.test(message)
    console.error("Late-promise draft failed:", error)
    return Response.json({
      error: restricted
        ? `${drafter} will not run on the current plan or balance. ${message.slice(0, 160)}`
        : message.slice(0, 300),
      reason: restricted ? "model-plan" : "model",
    }, { status: restricted ? 402 : 502 })
  }

  return Response.json({ eventId, text, drafter }, { headers: { "Cache-Control": "no-store" } })
}
