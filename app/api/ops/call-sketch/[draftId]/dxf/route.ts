import { getConfirmedCallSketchForDraft } from "@/lib/call-sketch-store"
import { createGateDxf } from "@/lib/call-sketch-dxf.mjs"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return new Response("Sign in required.", { status: 401 })
  if (operator.role !== "owner") return new Response("Owner access required.", { status: 403 })
  const { draftId } = await params
  const spec = await getConfirmedCallSketchForDraft(draftId)
  if (!spec) return new Response("Confirm the sketch facts before exporting DXF.", { status: 409 })
  try {
    const dxf = createGateDxf({
      kind: spec.kind.value ?? "gate",
      width: Number(spec.width.value),
      height: Number(spec.height.value),
      stockSize: Number(spec.stockSize.value),
      railCount: Number(spec.railCount.value ?? 0),
      hingeSide: spec.hingeSide.value ?? "left",
      latchSide: spec.latchSide.value ?? "right",
      title: "MCSW CONFIRMED CALL SKETCH",
    })
    return new Response(dxf, {
      headers: {
        "Content-Type": "application/dxf; charset=utf-8",
        "Content-Disposition": `attachment; filename="mcsw-call-sketch-${draftId.slice(0, 8)}.dxf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "DXF export failed.", { status: 400 })
  }
}
