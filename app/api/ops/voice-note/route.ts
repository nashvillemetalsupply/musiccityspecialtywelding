import { get } from "@vercel/blob"
import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return new Response("Sign in required.", { status: 401 })
  if (operator.role !== "owner") return new Response("Owner-only raw voice receipt.", { status: 403 })
  const eventId = Number(new URL(req.url).searchParams.get("event"))
  if (!Number.isInteger(eventId) || eventId <= 0) return new Response("Tape not found.", { status: 404 })
  const sql = getSql()
  const rows = (await sql`
    SELECT detail->>'voicePath' AS pathname, detail->>'voiceContentType' AS content_type
    FROM events WHERE id = ${eventId}::bigint
      AND kind = ANY(ARRAY['job.completed','note.voice']::text[])
      AND COALESCE(detail->>'voicePath', '') <> ''
    LIMIT 1`) as { pathname: string | null; content_type: string | null }[]
  if (!rows[0]?.pathname) return new Response("Tape not found.", { status: 404 })
  const result = await get(rows[0].pathname, { access: "private" })
  if (!result?.stream || result.statusCode !== 200) return new Response("Tape not found.", { status: 404 })
  return new Response(result.stream, { headers: { "Content-Type": rows[0].content_type || "audio/webm", "Cache-Control": "private, max-age=86400" } })
}
