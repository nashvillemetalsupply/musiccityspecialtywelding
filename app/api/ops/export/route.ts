import { cookies } from "next/headers"
import { getSql } from "@/lib/db"
import type { LeadRow } from "@/lib/leads"
import { OPS_SESSION_COOKIE, validateSessionToken } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const COLUMNS: (keyof LeadRow)[] = [
  "public_id", "created_at", "first_name", "last_name", "phone", "email",
  "service", "message", "preferred_contact", "photo_count", "source", "gclid",
  "utm_source", "utm_medium", "utm_campaign", "landing_page", "referrer",
  "status", "status_reason", "first_response_at", "first_response_channel",
  "estimate_value_cents", "quoted_at", "won_at", "lost_at", "revenue_cents",
  "completed_at", "review_requested_at", "review_received",
  "email_delivery_status", "notes", "is_test",
]

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  let s = String(value)
  // Guard spreadsheet formula injection.
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET() {
  const cookieStore = await cookies()
  const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
  if (!operator) {
    return new Response("Not signed in.", { status: 401 })
  }

  const sql = getSql()
  const rows = (await sql`SELECT * FROM leads ORDER BY created_at DESC LIMIT 5000`) as LeadRow[]

  const lines = [
    COLUMNS.join(","),
    ...rows.map((row) => COLUMNS.map((column) => csvCell(row[column])).join(",")),
  ]

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mcsw-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
