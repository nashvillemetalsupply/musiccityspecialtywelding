import { buildSheetsEnabled } from "@/lib/build-sheets-access"
import { issueBuildPaperwork } from "@/lib/build-sheets"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(req.url).origin
  } catch {
    return false
  }
}

export async function GET() {
  return new Response("Issue current Paperwork from Builds.", {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "private, no-store" },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return new Response("Sign in required.", { status: 401 })
  if (operator.role !== "owner") return new Response("Owner-only Paperwork access is required.", { status: 403 })
  if (!buildSheetsEnabled()) return new Response("Not found.", { status: 404 })
  if (!sameOrigin(req)) return new Response("Request origin did not match.", { status: 403 })
  const { id } = await params
  const paperworkId = Number(id)
  if (!Number.isInteger(paperworkId) || paperworkId <= 0) return new Response("Paperwork not found.", { status: 404 })
  const formData = await req.formData()
  try {
    const issued = await issueBuildPaperwork({
      paperworkId,
      operatorId: Number(operator.id),
      issueKey: String(formData.get("issueKey") ?? ""),
    })
    const filename = `job-${issued.leadId}-build-sheet-${issued.sourceBuildSheetNumber}-${issued.kind}.${issued.extension}`
    return new Response(issued.content, {
      headers: {
        "Content-Type": issued.contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Build-Sheet": String(issued.sourceBuildSheetNumber),
        "X-Content-Hash": issued.contentHash,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paperwork could not be issued."
    return Response.json({ error: message }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
  }
}
