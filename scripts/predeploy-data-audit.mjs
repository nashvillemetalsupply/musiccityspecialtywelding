// Read-only production-data gates for MCSW Jobs activation.
// Prints counts and internal job IDs only; it never prints connection details or customer PII.
import { existsSync, readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL_UNPOOLED?.trim()) return process.env.DATABASE_URL_UNPOOLED.trim()
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim()
  if (existsSync(".env.local")) {
    const envFile = readFileSync(".env.local", "utf8")
    const direct = envFile.match(/^DATABASE_URL_UNPOOLED="?([^"\r\n]+)/m)
    if (direct) return direct[1]
    const pooled = envFile.match(/^DATABASE_URL="?([^"\r\n]+)/m)
    if (pooled) return pooled[1]
  }
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is not configured.")
}

const sql = neon(resolveDatabaseUrl())

const [readySummary, readyRows, legacyGlass, uploadReservations] = await Promise.all([
  sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE completed_at < now() - interval '7 days')::int AS older_than_7_days,
      count(*) FILTER (WHERE completed_at < now() - interval '30 days')::int AS older_than_30_days,
      count(*) FILTER (WHERE paid_at IS NOT NULL)::int AS marked_paid
    FROM leads
    WHERE is_test = false
      AND status NOT IN ('lost', 'spam')
      AND completed_at IS NOT NULL
      AND handed_off_at IS NULL`,
  sql`
    SELECT id, status, service, completed_at, paid_at
    FROM leads
    WHERE is_test = false
      AND status NOT IN ('lost', 'spam')
      AND completed_at IS NOT NULL
      AND handed_off_at IS NULL
    ORDER BY completed_at ASC, id ASC
    LIMIT 200`,
  sql`
    SELECT count(*)::int AS total,
      array_agg(lead_id ORDER BY lead_id) FILTER (WHERE lead_id IS NOT NULL) AS lead_ids
    FROM glass_links
    WHERE revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND token_nonce = ''`,
  sql`
    SELECT
      count(*) FILTER (WHERE status = 'pending' AND expired_at IS NULL)::int AS pending,
      count(*) FILTER (
        WHERE status = 'pending' AND expired_at IS NULL
          AND created_at <= now() - interval '6 hours'
      )::int AS stale_pending,
      count(*) FILTER (WHERE expired_at IS NOT NULL)::int AS expired
    FROM glass_uploads`,
])

const summary = readySummary[0] ?? { total: 0, older_than_7_days: 0, older_than_30_days: 0, marked_paid: 0 }
const glass = legacyGlass[0] ?? { total: 0, lead_ids: [] }
const uploads = uploadReservations[0] ?? { pending: 0, stale_pending: 0, expired: 0 }

console.log("MCSW Jobs predeploy data audit (read-only)")
console.log(JSON.stringify({
  completedWithoutHandoff: {
    total: Number(summary.total),
    olderThan7Days: Number(summary.older_than_7_days),
    olderThan30Days: Number(summary.older_than_30_days),
    markedPaid: Number(summary.marked_paid),
    jobs: readyRows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      service: row.service,
      completedAt: row.completed_at,
      paid: Boolean(row.paid_at),
    })),
  },
  activeLegacyCustomerPages: {
    total: Number(glass.total),
    leadIds: (glass.lead_ids ?? []).map(Number),
  },
  customerUploadReservations: {
    pending: Number(uploads.pending),
    stalePending: Number(uploads.stale_pending),
    expired: Number(uploads.expired),
  },
}, null, 2))
