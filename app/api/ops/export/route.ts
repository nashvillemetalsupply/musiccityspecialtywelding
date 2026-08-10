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

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
  if (!operator || operator.role !== "owner") {
    return new Response("Owner access required.", { status: operator ? 403 : 401 })
  }

  const sql = getSql()
  const format = new URL(req.url).searchParams.get("format") ?? "full"

  // Google Ads offline-conversion import: won leads that came from an ad click.
  if (format === "google-oci") {
    const won = (await sql`
      SELECT gclid, won_at, revenue_cents FROM leads
      WHERE status = 'won' AND gclid <> '' AND won_at IS NOT NULL AND is_test = false
      ORDER BY won_at ASC LIMIT 5000`) as {
      gclid: string
      won_at: string
      revenue_cents: number | null
    }[]
    const lines = [
      "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency",
      ...won.map((row) => {
        const time = new Date(row.won_at)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19)
        const value = row.revenue_cents === null ? "" : (row.revenue_cents / 100).toFixed(2)
        return `${csvCell(row.gclid)},Won Job (Offline),${time}+00:00,${value},USD`
      }),
    ]
    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mcsw-google-offline-conversions-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  }

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
