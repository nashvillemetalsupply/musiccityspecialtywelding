import { Resend } from "resend"
import { dbConfigured, getSql } from "@/lib/db"
import type { LeadRow } from "@/lib/leads"
import { isAuthorizedCron } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Hourly reminder sweep: emails follow-ups that have come due since they were
// last notified, so an "in 4 hours" pick actually fires the same day. Each due
// follow-up is notified once (follow_up_notified_at watermark) until it is
// rescheduled or resolved.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  if (!dbConfigured()) {
    return Response.json({ ok: false, error: "Database not configured." }, { status: 503 })
  }

  const sql = getSql()
  let ok = false
  const detail: Record<string, unknown> = {}

  try {
    const due = (await sql`
      SELECT * FROM leads
      WHERE next_follow_up_at IS NOT NULL
        AND next_follow_up_at <= now()
        AND (follow_up_notified_at IS NULL OR follow_up_notified_at < next_follow_up_at)
        AND status NOT IN ('won', 'lost', 'spam')
        AND is_test = false
      ORDER BY next_follow_up_at ASC LIMIT 50`) as LeadRow[]

    detail.due = due.length
    const apiKey = process.env.RESEND_API_KEY
    const to = process.env.QUOTE_TO_EMAIL
    const from = process.env.QUOTE_FROM_EMAIL

    if (due.length > 0 && apiKey && to && from) {
      const lines = due.map(
        (lead) =>
          `- ${lead.first_name} ${lead.last_name}`.trim() +
          ` · ${lead.phone} · ${lead.service}` +
          ` · https://musiccityspecialtywelding.com/ops/leads/${lead.id}`
      )
      const resend = new Resend(apiKey)
      const { error } = await resend.emails.send({
        from,
        to,
        subject: `Follow-up due now: ${due.length} lead${due.length === 1 ? "" : "s"}`,
        text: [
          `These follow-ups are due:`,
          ``,
          ...lines,
          ``,
          `Open the board: https://musiccityspecialtywelding.com/ops`,
        ].join("\n"),
      })
      if (error) throw new Error(error.message || "Reminder email failed.")
      const ids = due.map((lead) => Number(lead.id))
      await sql`
        UPDATE leads SET follow_up_notified_at = now() WHERE id = ANY(${ids})`
      detail.emailSent = true
    } else {
      detail.emailSent = false
    }

    ok = true
    return Response.json({ ok: true, ...detail }, { status: 200 })
  } catch (err) {
    detail.error = err instanceof Error ? err.message : String(err)
    console.error("Reminder error:", err)
    return Response.json({ ok: false, ...detail }, { status: 500 })
  } finally {
    try {
      await sql`
        INSERT INTO automation_runs (job, ok, detail)
        VALUES ('follow-up-reminders', ${ok}, ${JSON.stringify(detail)})`
    } catch (logError) {
      console.error("Automation log error:", logError)
    }
  }
}
