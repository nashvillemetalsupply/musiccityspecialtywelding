import { getSql } from "@/lib/db"

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "quoted",
  "won",
  "lost",
  "spam",
] as const

export type LeadStatus = (typeof LEAD_STATUSES)[number]

export type LeadRow = {
  id: number
  public_id: string
  created_at: string
  updated_at: string
  first_name: string
  last_name: string
  phone: string
  email: string
  service: string
  message: string
  preferred_contact: string
  photo_count: number
  source: string
  gclid: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_term: string
  utm_content: string
  landing_page: string
  referrer: string
  ip: string
  user_agent: string
  is_test: boolean
  status: LeadStatus
  status_reason: string
  first_response_at: string | null
  first_response_channel: string
  next_follow_up_at: string | null
  estimate_value_cents: number | null
  quoted_at: string | null
  won_at: string | null
  lost_at: string | null
  revenue_cents: number | null
  completed_at: string | null
  review_requested_at: string | null
  review_received: boolean
  notes: string
  email_delivery_status: string
  email_delivery_error: string
  email_delivered_at: string | null
}

export type LeadEventRow = {
  id: number
  lead_id: number
  created_at: string
  actor: string
  type: string
  detail: Record<string, unknown> | null
}

export type NewLeadInput = {
  firstName: string
  lastName: string
  phone: string
  email: string
  service: string
  message: string
  preferredContact: string
  photoCount: number
  gclid: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm: string
  utmContent: string
  landingPage: string
  referrer: string
  ip: string
  userAgent: string
  isTest: boolean
}

export function deriveLeadSource(input: {
  gclid: string
  utmSource: string
  utmMedium: string
  referrer: string
}): string {
  if (input.gclid) return "google-ads"
  if (input.utmSource) {
    return input.utmMedium ? `${input.utmSource}/${input.utmMedium}` : input.utmSource
  }
  if (input.referrer) {
    try {
      const host = new URL(input.referrer).hostname
      if (host.includes("google.")) return "google-organic"
      if (host.includes("bing.")) return "bing-organic"
      if (host.includes("facebook.") || host.includes("fb.")) return "facebook"
      if (host.includes("musiccityspecialtywelding.com")) return "direct"
      return `referral:${host}`
    } catch {
      return "referral"
    }
  }
  return "direct"
}

function makePublicId(now: Date) {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "")
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `L-${stamp}-${rand}`
}

export async function createLead(input: NewLeadInput): Promise<{ id: number; publicId: string }> {
  const sql = getSql()
  const publicId = makePublicId(new Date())
  const source = deriveLeadSource(input)
  const rows = (await sql`
    INSERT INTO leads (
      public_id, first_name, last_name, phone, email, service, message,
      preferred_contact, photo_count, source, gclid, utm_source, utm_medium,
      utm_campaign, utm_term, utm_content, landing_page, referrer, ip,
      user_agent, is_test
    ) VALUES (
      ${publicId}, ${input.firstName}, ${input.lastName}, ${input.phone},
      ${input.email}, ${input.service}, ${input.message},
      ${input.preferredContact}, ${input.photoCount}, ${source}, ${input.gclid},
      ${input.utmSource}, ${input.utmMedium}, ${input.utmCampaign},
      ${input.utmTerm}, ${input.utmContent}, ${input.landingPage},
      ${input.referrer}, ${input.ip}, ${input.userAgent}, ${input.isTest}
    )
    RETURNING id`) as { id: number }[]
  const id = rows[0].id
  await recordLeadEvent(id, "created", "system", { source, isTest: input.isTest })
  return { id, publicId }
}

export async function recordLeadEvent(
  leadId: number,
  type: string,
  actor: string,
  detail: Record<string, unknown> | null = null
) {
  const sql = getSql()
  await sql`
    INSERT INTO lead_events (lead_id, actor, type, detail)
    VALUES (${leadId}, ${actor}, ${type}, ${detail ? JSON.stringify(detail) : null})`
}

export async function markLeadDelivery(
  leadId: number,
  status: "sent" | "failed",
  error?: string
) {
  const sql = getSql()
  if (status === "sent") {
    await sql`
      UPDATE leads SET email_delivery_status = 'sent', email_delivered_at = now(),
        email_delivery_error = '', updated_at = now()
      WHERE id = ${leadId}`
  } else {
    await sql`
      UPDATE leads SET email_delivery_status = 'failed',
        email_delivery_error = ${error ?? "unknown"}, updated_at = now()
      WHERE id = ${leadId}`
  }
  await recordLeadEvent(leadId, status === "sent" ? "email_sent" : "email_failed", "system", {
    error: error ?? null,
  })
}

// Durable cross-instance rate limiting backed by Postgres. Returns true when
// the caller is over the limit. Failures never block a lead.
export async function isRateLimitedDurable(
  key: string,
  windowMs: number,
  maxRequests: number
): Promise<boolean> {
  try {
    const sql = getSql()
    const windowStart = new Date(Date.now() - windowMs).toISOString()
    await sql`DELETE FROM rate_limits WHERE ts < now() - interval '1 day'`
    await sql`INSERT INTO rate_limits (key) VALUES (${key})`
    const rows = (await sql`
      SELECT count(*)::int AS count FROM rate_limits
      WHERE key = ${key} AND ts >= ${windowStart}`) as { count: number }[]
    return rows[0].count > maxRequests
  } catch {
    return false
  }
}
