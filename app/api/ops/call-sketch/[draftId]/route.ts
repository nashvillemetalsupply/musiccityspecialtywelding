import { confirmCallSketchForDraft, getCallSketchForDraft } from "@/lib/call-sketch-store"
import { recordEvent } from "@/lib/events"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { twilioLiveTranscriptionConfigured } from "@/lib/twilio"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function ownerResponse(operator: Awaited<ReturnType<typeof getAuthenticatedOperator>>) {
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (operator.role !== "owner") return Response.json({ error: "The live call sketch is owner-only." }, { status: 403 })
  return null
}

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(req.url).origin
  } catch {
    return false
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const operator = await getAuthenticatedOperator()
  const denied = ownerResponse(operator)
  if (denied) return denied
  const { draftId } = await params
  const sketch = await getCallSketchForDraft(draftId)
  if (!sketch) return Response.json({ error: "That call sketch is no longer available." }, { status: 404 })
  return Response.json({ ...sketch, liveTranscriptionEnabled: twilioLiveTranscriptionConfigured() }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const operator = await getAuthenticatedOperator()
  const denied = ownerResponse(operator)
  if (denied) return denied
  if (!sameOrigin(req)) return Response.json({ error: "Request origin did not match." }, { status: 403 })
  const body = await req.json().catch(() => null) as {
    expectedRevision?: unknown
    spec?: {
      kind?: unknown
      width?: unknown
      height?: unknown
      stockSize?: unknown
      railCount?: unknown
      hingeSide?: unknown
      latchSide?: unknown
      swing?: unknown
      material?: unknown
    }
  } | null
  const { draftId } = await params
  const spec = body?.spec
  if (!spec) return Response.json({ error: "Sketch facts are required." }, { status: 400 })
  const expectedRevision = Number(body?.expectedRevision ?? 0)
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return Response.json({ error: "Reload the sketch before confirming it." }, { status: 400 })
  }
  if (!["gate", "frame"].includes(String(spec.kind))) {
    return Response.json({ error: "Choose gate or rectangular frame before confirming." }, { status: 400 })
  }
  if (spec.kind === "gate" && !["left", "right"].includes(String(spec.hingeSide))) {
    return Response.json({ error: "Choose the gate's hinge side before confirming." }, { status: 400 })
  }
  if (spec.kind === "gate" && !["left", "right"].includes(String(spec.latchSide))) {
    return Response.json({ error: "Choose the gate's latch side before confirming." }, { status: 400 })
  }
  try {
    const result = await confirmCallSketchForDraft({
      publicId: draftId,
      operatorId: Number(operator!.id),
      expectedRevision,
      spec: {
        kind: spec.kind === "frame" ? "frame" : "gate",
        width: Number(spec.width),
        height: Number(spec.height),
        stockSize: Number(spec.stockSize),
        railCount: Number(spec.railCount ?? 0),
        hingeSide: spec.hingeSide === "right" ? "right" : "left",
        latchSide: spec.latchSide === "left" ? "left" : "right",
        swing: typeof spec.swing === "string" ? spec.swing : "",
        material: typeof spec.material === "string" ? spec.material : "",
      },
    })
    await recordEvent({
      kind: "call.sketch-confirmed",
      actorType: "operator",
      actorId: operator!.id,
      externalId: `call-sketch:${draftId}:${result.revision}`,
      body: `Call sketch confirmed at ${result.spec.width.value} × ${result.spec.height.value} inches`,
      crewBody: "Call sketch dimensions confirmed by the owner",
      detail: { draftId, revision: result.revision, spec: result.spec },
    })
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sketch could not be confirmed."
    const conflict = /another device/i.test(message)
    return Response.json({ error: message }, { status: conflict ? 409 : 400 })
  }
}
