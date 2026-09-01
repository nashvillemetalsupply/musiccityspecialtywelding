import { listReadableEventsById } from "@/lib/event-access"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export async function GET(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 30)
  if (!ids.length) return Response.json({ receipts: [] })
  const rows = await listReadableEventsById(ids, operator.role)
  const receipts = rows.map(({ id, occurred_at, kind, lead_id, body }) => ({ id, occurred_at, kind, lead_id, body }))
  return Response.json({ receipts })
}
