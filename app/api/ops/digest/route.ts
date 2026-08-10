import { dbConfigured, getSql } from "@/lib/db"
import type { LeadRow } from "@/lib/leads"
import { isAuthorizedCron } from "@/lib/ops-auth"
import { notifyAll } from "@/lib/notify"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Legacy automation heartbeat. The Radio is the morning brief; this route files
// an owner-only Wire summary instead of bypassing the notification authority.
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
        AND completed_at IS NULL AND status NOT IN ('lost', 'spam') AND is_test = false
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
    const unpaidInvoices = (await sql`
      SELECT * FROM leads
      WHERE invoiced_at IS NOT NULL AND paid_at IS NULL AND is_test = false
      ORDER BY invoice_due_at ASC NULLS LAST LIMIT 50`) as LeadRow[]
    const followUpsDue = (await sql`
      SELECT * FROM leads
      WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= now()
        AND completed_at IS NULL AND status NOT IN ('lost', 'spam') AND is_test = false
      ORDER BY next_follow_up_at ASC LIMIT 50`) as LeadRow[]
    const [ociReady] = (await sql`
      SELECT count(*)::int AS count FROM leads
      WHERE status = 'won' AND gclid <> '' AND won_at > now() - interval '7 days'
        AND is_test = false`) as { count: number }[]

    detail = {
      unanswered: unanswered.length,
      failedDeliveries: failed.length,
      staleQuotes: openQuotes.length,
      followUpsDue: followUpsDue.length,
      unpaidInvoices: unpaidInvoices.length,
      adWinsReady: Number(ociReady?.count ?? 0),
    }

    const needsAttention = Object.values(detail).some((value) => typeof value === "number" && value > 0)
    if (needsAttention) {
      const centralDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date())
      const filed = await notifyAll({
        priority: "digest",
        stock: failed.length ? "red" : "manila",
        title: "Today’s shop list is ready",
        body: `${followUpsDue.length} due · ${unanswered.length} waiting · ${openQuotes.length} stale quotes · ${unpaidInvoices.length} unpaid`,
        url: "/ops",
        ownerOnly: true,
        dedupeKey: `daily-digest:${centralDay}`,
      })
      detail.notificationsFiled = filed.length
      detail.delivery = "wire"
    } else {
      detail.delivery = "none"
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
        VALUES ('daily-digest', ${ok}::boolean, ${JSON.stringify(detail)}::jsonb)`
      await sql`DELETE FROM automation_runs WHERE ran_at < now() - interval '90 days'`
    } catch (logError) {
      console.error("Automation log error:", logError)
    }
  }
}
