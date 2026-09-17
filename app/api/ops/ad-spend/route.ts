import { timingSafeEqual } from "node:crypto"
import { revalidatePath } from "next/cache"
import { getSql } from "@/lib/db"
import { parseAdSpendPayload } from "@/lib/ad-spend.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Where the monthly ad spend on /board comes from, so the owner never types it.
//
// This is the RECEIVING half only, and that is deliberate. One Roof (the Mirror
// repo) already pulls both ad accounts for every business it buys media for; a
// second puller in here would fork it and give the same two accounts two
// sources of truth. So Mirror stays the only thing holding ad-platform
// credentials and posts the welding numbers here, and ad_spend becomes a
// display cache whose rows are marked source='api'.
//
// The manual form on /board is untouched: it is the fallback for a month when
// the pipe is down, and a typed row stays 'manual' so the two never blur.

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

// Constant time, and length-checked first: timingSafeEqual throws on a length
// mismatch, which would leak the token length as a 500 instead of a 401.
function tokenMatches(presented: string, expected: string) {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  // Fails closed. An unset token means not provisioned, never "anyone may
  // write" -- an open upsert into a money table is worse than a board that
  // still shows a dash.
  const expected = process.env.AD_SPEND_INGEST_TOKEN?.trim()
  if (!expected) return json({ error: "Ad spend ingestion is not configured." }, 503)

  const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!presented || !tokenMatches(presented, expected)) return json({ error: "Unauthorized." }, 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: "Body must be JSON." }, 400)
  }

  const parsed = parseAdSpendPayload(body)
  // `ok` and `updates` are set together, but the checker reads the union one
  // field at a time, so both are asserted here rather than non-null-asserted.
  if (!parsed.ok || !parsed.updates) return json({ error: parsed.error ?? "Bad request." }, 400)

  const sql = getSql()
  for (const update of parsed.updates) {
    await sql`
      INSERT INTO ad_spend (month_start, channel, amount_cents, source, updated_at)
      VALUES (
        COALESCE(${parsed.monthStart}::date, date_trunc('month', now() AT TIME ZONE 'America/Chicago')::date),
        ${update.channel}::text, ${update.cents}::bigint, 'api'::text, now())
      ON CONFLICT (month_start, channel) DO UPDATE SET
        amount_cents = EXCLUDED.amount_cents,
        source = EXCLUDED.source,
        updated_at = now()`
  }

  revalidatePath("/board")
  return json({ ok: true, month: parsed.monthStart ?? "current", written: parsed.updates }, 200)
}
