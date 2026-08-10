import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import type { EventRow } from "@/lib/events"
import { projectEventForRole } from "@/lib/visibility"

export async function GET(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 30)
  if (!ids.length) return Response.json({ receipts: [] })
  const sql = getSql()
  const rows = (await sql`SELECT * FROM events WHERE id = ANY(${ids}::bigint[]) ORDER BY occurred_at ASC`) as EventRow[]
  const receipts = rows.map((event) => projectEventForRole(event, operator.role)).filter((event): event is EventRow => Boolean(event)).map(({ id, occurred_at, kind, lead_id, body }) => ({ id, occurred_at, kind, lead_id, body }))
  return Response.json({ receipts })
}
