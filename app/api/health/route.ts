import { ADS_CONVERSION_SEND_TO } from "@/lib/measurement"
import { dbConfigured, getSql } from "@/lib/db"
import { getOwnerEmail } from "@/lib/ops-auth"

export const dynamic = "force-dynamic"

async function hasWorkingResendCredential(apiKey: string) {
  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

type DatabaseHealth = {
  configured: boolean
  connected: boolean
  leadCount: number | null
  failedDeliveries: number | null
  lastDigestAt: string | null
  lastDigestOk: boolean | null
  lastReminderAt: string | null
  lastReminderOk: boolean | null
}

async function checkDatabase(): Promise<DatabaseHealth> {
  const result: DatabaseHealth = {
    configured: dbConfigured(),
    connected: false,
    leadCount: null,
    failedDeliveries: null,
    lastDigestAt: null,
    lastDigestOk: null,
    lastReminderAt: null,
    lastReminderOk: null,
  }
  if (!result.configured) return result
  try {
    const sql = getSql()
    const [counts] = (await sql`
      SELECT
        (SELECT count(*)::int FROM leads WHERE is_test = false) AS lead_count,
        (SELECT count(*)::int FROM leads
          WHERE email_delivery_status = 'failed' AND is_test = false) AS failed_deliveries`) as {
      lead_count: number
      failed_deliveries: number
    }[]
    result.connected = true
    result.leadCount = counts.lead_count
    result.failedDeliveries = counts.failed_deliveries
    const digest = (await sql`
      SELECT ran_at, ok FROM automation_runs
      WHERE job = 'daily-digest' ORDER BY ran_at DESC LIMIT 1`) as {
      ran_at: string
      ok: boolean
    }[]
    if (digest.length) {
      result.lastDigestAt = new Date(digest[0].ran_at).toISOString()
      result.lastDigestOk = digest[0].ok
    }
    const reminder = (await sql`
      SELECT ran_at, ok FROM automation_runs
      WHERE job = 'follow-up-reminders' ORDER BY ran_at DESC LIMIT 1`) as {
      ran_at: string
      ok: boolean
    }[]
    if (reminder.length) {
      result.lastReminderAt = new Date(reminder[0].ran_at).toISOString()
      result.lastReminderOk = reminder[0].ok
    }
  } catch {
    result.connected = false
  }
  return result
}

export async function GET() {
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ""
  const quoteEmailConfigured = Boolean(
    resendApiKey &&
      process.env.QUOTE_FROM_EMAIL?.trim() &&
      process.env.QUOTE_TO_EMAIL?.trim()
  )
  const [quoteEmailCredentialValid, database] = await Promise.all([
    quoteEmailConfigured ? hasWorkingResendCredential(resendApiKey) : Promise.resolve(false),
    checkDatabase(),
  ])
  const adsConversionConfigured = Boolean(ADS_CONVERSION_SEND_TO)
  const analyticsMeasurementConfigured = Boolean(
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()
  )
  const opsAuthConfigured = Boolean(getOwnerEmail()) && database.connected
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim())

  // Leads are accepted when either durable channel works; both healthy is the target.
  const leadsAccepted =
    (quoteEmailConfigured && quoteEmailCredentialValid) || database.connected

  const launchGatePassed =
    quoteEmailConfigured &&
    quoteEmailCredentialValid &&
    adsConversionConfigured &&
    database.configured &&
    database.connected &&
    (database.failedDeliveries ?? 0) === 0

  return Response.json(
    {
      ok: launchGatePassed,
      service: "music-city-specialty-welding-website",
      leadsAccepted,
      email: {
        configured: quoteEmailConfigured,
        credentialValid: quoteEmailCredentialValid,
      },
      database: {
        configured: database.configured,
        connected: database.connected,
      },
      delivery: {
        failedCount: database.failedDeliveries,
      },
      operations: {
        authConfigured: opsAuthConfigured,
        schedulerSecretConfigured: cronSecretConfigured,
      },
      automation: {
        lastDigestAt: database.lastDigestAt,
        lastDigestOk: database.lastDigestOk,
        lastReminderAt: database.lastReminderAt,
        lastReminderOk: database.lastReminderOk,
        // Surfaces a silently-disabled GitHub schedule once reminders have run at least once.
        reminderStale:
          database.lastReminderAt !== null &&
          Date.now() - new Date(database.lastReminderAt).getTime() > 3 * 60 * 60 * 1000,
      },
      googleAds: {
        conversionConfigured: adsConversionConfigured,
      },
      googleAnalytics: {
        measurementConfigured: analyticsMeasurementConfigured,
      },
      reviews: {
        googleReviewUrlConfigured: false,
      },
      launchGate: {
        passed: launchGatePassed,
        detail: launchGatePassed
          ? "Quote delivery, lead persistence, and Ads conversion configuration passed."
          : "Quote delivery, lead persistence, or Ads conversion configuration failed.",
      },
    },
    {
      status: launchGatePassed ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
