import { createHash, timingSafeEqual } from "node:crypto"
import { getSql } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const chicagoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
})

type FeedRow = {
  public_id: string
  created_at: string | Date
  first_name: string
  last_name: string
  email: string
  source: string
  is_test: boolean
}

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } })

function sha256(value: string) {
  return createHash("sha256").update(value).digest()
}

function hashIdentity(value: string) {
  return value ? `sha256:${sha256(value).toString("hex")}` : null
}

function dayKey(instant: Date) {
  const parts = Object.fromEntries(chicagoDate.formatToParts(instant).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const expected = process.env.LEADS_FEED_SECRET
  if (!expected?.trim()) return json({ error: "Lead feed is not configured." }, 503)

  const presented = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]
  // Fixed-size digests let timingSafeEqual handle tokens of every byte length.
  if (!presented || !timingSafeEqual(sha256(presented), sha256(expected))) {
    return json({ error: "Unauthorized." }, 401)
  }

  const parameter = new URL(request.url).searchParams.get("days")
  const requested = parameter?.trim() ? Number(parameter) : 14
  const count = Number.isFinite(requested) ? Math.min(90, Math.max(1, Math.trunc(requested))) : 14
  const now = new Date()
  const today = dayKey(now)
  const firstDay = shiftDay(today, 1 - count)
  const nextDay = shiftDay(today, 1)
  const days = Array.from({ length: count }, (_, index) => ({
    day: shiftDay(firstDay, index), total: 0, test: 0,
  }))
  const buckets = new Map(days.map((day) => [day.day, day]))

  try {
    const sql = getSql()
    // Calendar dates become Chicago midnights in Postgres, including DST days.
    const rows = await sql`
      SELECT public_id, created_at, first_name, last_name, email, source, is_test
      FROM leads
      WHERE created_at >= (${firstDay}::date::timestamp AT TIME ZONE 'America/Chicago')
        AND created_at < (${nextDay}::date::timestamp AT TIME ZONE 'America/Chicago')
      ORDER BY created_at ASC, public_id ASC` as FeedRow[]
    const leads = rows.map((row) => {
      const bucket = buckets.get(dayKey(new Date(row.created_at)))
      if (bucket) {
        bucket.total++
        if (row.is_test) bucket.test++
      }
      const name = `${row.first_name} ${row.last_name}`.trim().toLowerCase()
        .replace(/\s+/gu, " ").replace(/\p{P}/gu, "").trim().replace(/\s+/gu, " ")
      return {
        lead_id: row.public_id,
        created_at: new Date(row.created_at).toISOString(),
        source: row.source,
        is_test: row.is_test,
        email_hash: hashIdentity(String(row.email ?? "").trim().toLowerCase()),
        name_hash: hashIdentity(name),
      }
    })
    return json({ generated_at: now.toISOString(), leads, days }, 200)
  } catch {
    // Neither database errors nor their parameters may expose customer data.
    return json({ error: "Lead feed is unavailable." }, 503)
  }
}
