import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import type { EventRow } from "@/lib/events"
import { projectEventForRole } from "@/lib/visibility"
import { selectBriefAudioPath } from "@/lib/shop-brain-invariants.mjs"

export async function GET() {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  const sql = getSql()
  const rows = (await sql`SELECT * FROM events WHERE kind = 'brief.morning' ORDER BY occurred_at DESC LIMIT 1`) as EventRow[]
  const brief = rows[0] ? projectEventForRole(rows[0], operator.role) : null
  const audioPath = selectBriefAudioPath(operator.role, rows[0]?.detail)
  const audioUrl = rows[0] && typeof audioPath === "string" ? `/api/ops/brief/audio?event=${rows[0].id}` : null
  const detail = rows[0]?.detail
  const daySheet = operator.role === "owner" ? detail?.daySheet : detail?.crewDaySheet
  return Response.json({ brief, audioUrl, daySheet: Array.isArray(daySheet) ? daySheet : [] })
}
