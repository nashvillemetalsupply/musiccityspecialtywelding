import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export const runtime = "nodejs"
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return new Response("Sign in required.", { status: 401 })
  if (operator.role !== "owner") return new Response("Call audio is available to the owner only.", { status: 403 })
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found.", { status: 404 })
  const sql = getSql()
  const rows = (await sql`SELECT recording_url FROM calls WHERE id = ${id}::bigint LIMIT 1`) as { recording_url: string }[]
  const url = rows[0]?.recording_url
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim(); const token = process.env.TWILIO_AUTH_TOKEN?.trim()
  if (!url || !sid || !token) return new Response("Recording unavailable.", { status: 404 })
  const response = await fetch(`${url}.mp3`, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` }, cache: "no-store" })
  if (!response.ok || !response.body) return new Response("Recording unavailable.", { status: 404 })
  return new Response(response.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=300" } })
}
