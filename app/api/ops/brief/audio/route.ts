import { get } from "@vercel/blob"
import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return new Response("Sign in required.", { status: 401 })
  const eventId = Number(new URL(req.url).searchParams.get("event"))
  if (!Number.isInteger(eventId) || eventId <= 0) return new Response("Tape not found.", { status: 404 })
  const sql = getSql()
  const rows = (await sql`
    SELECT CASE WHEN ${operator.role}::text = 'owner'
      THEN detail->>'audioPath' ELSE detail->>'crewAudioPath' END AS pathname
    FROM events
    WHERE id = ${eventId}::bigint AND kind = 'brief.morning'
    LIMIT 1`) as { pathname: string | null }[]
  const pathname = rows[0]?.pathname
  if (!pathname) return new Response("Tape not found.", { status: 404 })
  const result = await get(pathname, { access: "private" })
  if (!result?.stream || result.statusCode !== 200) return new Response("Tape not found.", { status: 404 })
  return new Response(result.stream, { headers: { "Content-Type": result.blob.contentType || "audio/mpeg", "Cache-Control": "private, max-age=86400" } })
}
