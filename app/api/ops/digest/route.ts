import { Resend } from "resend"
import { dbConfigured, getSql } from "@/lib/db"
import type { LeadRow } from "@/lib/leads"
import { isAuthorizedCron } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Daily follow-up digest, triggered by Vercel Cron. Also serves as the
// automation heartbeat that /api/health and external monitoring check.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  if (!dbConfigured()) {
    return Response.json({ ok: false, error: "Database not configured." }, { status: 503 })
  }

  const sql = getSql()
  let ok = false
  let detail: Record<string, unknown> = {}

  try {
    const unanswered = (await sql`
      SELECT * FROM leads
      WHERE first_response_at IS NULL
        AND status NOT IN ('won', 'lost', 'spam')
        AND is_test = false
      ORDER BY created_at ASC LIMIT 50`) as LeadRow[]
    const failed = (await sql`
      SELECT * FROM leads
      WHERE email_delivery_status = 'failed' AND is_test = false
      ORDER BY created_at DESC LIMIT 20`) as LeadRow[]
    const openQuotes = (await sql`
      SELECT * FROM leads
      WHERE status = 'quoted' AND is_test = false
        AND quoted_at < now() - interval '3 days'
      ORDER BY quoted_at ASC LIMIT 50`) as LeadRow[]
    const followUpsDue = (await sql`
      SELECT * FROM leads
      WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= now()
        AND status NOT IN ('won', 'lost', 'spam') AND is_test = false
      ORDER BY next_follow_up_at ASC LIMIT 50`) as LeadRow[]

    detail = {
      unanswered: unanswered.length,
      failedDeliveries: failed.length,
      staleQuotes: openQuotes.length,
      followUpsDue: followUpsDue.length,
    }

    const needsEmail =
      unanswered.length > 0 || failed.length > 0 || openQuotes.length > 0 || followUpsDue.length > 0
    const apiKey = process.env.RESEND_API_KEY
    const to = process.env.QUOTE_TO_EMAIL
    const from = process.env.QUOTE_FROM_EMAIL

    if (needsEmail && apiKey && to && from) {
      const describe = (lead: LeadRow) =>
        `- ${lead.first_name} ${lead.last_name}`.trim() +
        ` · ${lead.phone} · ${lead.service} · in ${new Date(lead.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT` +
        ` · https://musiccityspecialtywelding.com/ops/leads/${lead.id}`

      const sections: string[] = []
      if (followUpsDue.length) {
        sections.push(`FOLLOW-UPS DUE (${followUpsDue.length}):`, ...followUpsDue.map(describe), "")
      }
      if (unanswered.length) {
        sections.push(`LEADS STILL WAITING ON A FIRST CALL (${unanswered.length}):`, ...unanswered.map(describe), "")
      }
      if (openQuotes.length) {
        sections.push(`QUOTES OUT MORE THAN 3 DAYS (${openQuotes.length}):`, ...openQuotes.map(describe), "")
      }
      if (failed.length) {
        sections.push(
          `QUOTE EMAILS THAT FAILED TO DELIVER (${failed.length}) — these leads are ONLY in the dashboard:`,
          ...failed.map(describe),
          ""
        )
      }
      const [ociReady] = (await sql`
        SELECT count(*)::int AS count FROM leads
        WHERE status = 'won' AND gclid <> '' AND won_at > now() - interval '7 days'
          AND is_test = false`) as { count: number }[]
      if (ociReady.count > 0) {
        sections.push(
          `${ociReady.count} won ad-driven job(s) this week are ready to upload to Google Ads:`,
          `https://musiccityspecialtywelding.com/api/ops/export?format=google-oci`,
          ""
        )
      }
      sections.push("Work the list: https://musiccityspecialtywelding.com/ops")

      const resend = new Resend(apiKey)
      const { error } = await resend.emails.send({
        from,
        to,
        subject: `Daily lead follow-up: ${unanswered.length} waiting, ${followUpsDue.length} due, ${openQuotes.length} stale quotes`,
        text: sections.join("\n"),
      })
      if (error) throw new Error(error.message || "Digest email failed.")
      detail.emailSent = true
    } else {
      detail.emailSent = false
    }

    ok = true
    return Response.json({ ok: true, ...detail }, { status: 200 })
  } catch (err) {
    detail.error = err instanceof Error ? err.message : String(err)
    console.error("Digest error:", err)
    return Response.json({ ok: false, ...detail }, { status: 500 })
  } finally {
    try {
      await sql`
        INSERT INTO automation_runs (job, ok, detail)
        VALUES ('daily-digest', ${ok}, ${JSON.stringify(detail)})`
      await sql`DELETE FROM automation_runs WHERE ran_at < now() - interval '90 days'`
    } catch (logError) {
      console.error("Automation log error:", logError)
    }
  }
}
