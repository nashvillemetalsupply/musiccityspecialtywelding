import { cookies } from "next/headers"
import { dbConfigured, getSql } from "@/lib/db"
import { OPS_SESSION_COOKIE, validateSessionToken } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Owner-only feature-tap counts, first party. Vercel Web Analytics on the
// Hobby plan carries no custom events (its enable dialog says so), and a
// $20/month plan for ten counters is the wrong trade for a one-man shop. One
// row per day per tap name, incremented in place. No content, no job id, no
// customer: the name is the whole payload, plus the stage tab's own name.
//
// Crew are refused here even if a tap reaches the route, which keeps the
// repo's no-surveillance rule at the server, not only in the client gate.
const TAP = /^[a-z][a-z0-9-]{1,40}(?::[a-z][a-z0-9-]{1,20})?$/

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
  if (!operator) return Response.json({ ok: false }, { status: 401 })
  if (operator.role !== "owner") return Response.json({ ok: false }, { status: 403 })
  if (!dbConfigured()) return Response.json({ ok: false }, { status: 503 })
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!TAP.test(name)) return Response.json({ ok: false }, { status: 400 })
  const sql = getSql()
  await sql`
    INSERT INTO usage_taps (day, name, taps)
    VALUES ((now() AT TIME ZONE 'America/Chicago')::date, ${name}::text, 1)
    ON CONFLICT (day, name) DO UPDATE SET taps = usage_taps.taps + 1`
  return Response.json({ ok: true })
}
