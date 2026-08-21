import { getAuthenticatedOperator } from "@/lib/ops-auth"
import {
  addManualVoiceSample, backfillOwnerVoiceSamples, getOwnerVoiceProfile,
  ownerVoiceGuide, ownerVoiceSampleCounts, rebuildOwnerVoiceProfile,
} from "@/lib/voice-of-character"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The corpus is the owner's own language and nothing else, so reading it and
// growing it are both owner-only. Crew never sees it and never adds to it.
async function owner() {
  const operator = await getAuthenticatedOperator()
  if (!operator) return { error: Response.json({ error: "Sign in required." }, { status: 401 }) }
  if (operator.role !== "owner") return { error: Response.json({ error: "The voice of character is owner-only." }, { status: 403 }) }
  return { operator }
}

export async function GET() {
  const gate = await owner()
  if (gate.error) return gate.error
  const [profile, counts, guide] = await Promise.all([
    getOwnerVoiceProfile(),
    ownerVoiceSampleCounts(),
    ownerVoiceGuide(),
  ])
  return Response.json({ profile, counts, guide }, { headers: { "Cache-Control": "no-store" } })
}

// `rebuild` sweeps every call and note the shop already holds and rebuilds the
// profile over the whole corpus -- it is safe to run any number of times.
// `add` is how the corpus gets long quickly: he pastes something he wrote and
// it lands sentence by sentence.
export async function POST(req: Request) {
  const gate = await owner()
  if (gate.error) return gate.error
  const json = await req.json().catch(() => ({})) as { action?: string; text?: string; label?: string }
  const action = String(json.action ?? "rebuild")

  if (action === "add") {
    const added = await addManualVoiceSample({ text: String(json.text ?? ""), label: String(json.label ?? "") })
    if (!added.added) return Response.json({ error: "Nothing in that paste to keep." }, { status: 400 })
    const profile = await rebuildOwnerVoiceProfile()
    return Response.json({ added: added.added, sourceRef: added.sourceRef, profile })
  }

  if (action === "rebuild") {
    const swept = await backfillOwnerVoiceSamples()
    const profile = await rebuildOwnerVoiceProfile()
    return Response.json({ swept, profile })
  }

  return Response.json({ error: "Unknown voice action." }, { status: 400 })
}
