import { getSql } from "@/lib/db"
import { readTwilioForm, twilioSmsWebhookConfigured, twiml } from "@/lib/twilio"

const KNOWN_STATUSES = new Set([
  "accepted",
  "scheduled",
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "undelivered",
  "canceled",
])

export async function POST(req: Request) {
  if (!twilioSmsWebhookConfigured()) return twiml("", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)

  const value = new URL(req.url).searchParams.get("notification")?.trim() ?? ""
  const parsed = /^\d+$/.test(value) ? Number(value) : 0
  const notificationId = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  const sid = params.get("MessageSid")?.trim() ?? ""
  const status = params.get("MessageStatus")?.trim().toLowerCase() ?? ""
  if (!notificationId || !sid || !KNOWN_STATUSES.has(status)) return twiml("")

  const sql = getSql()
  await sql`
    UPDATE notifications SET
      provider_message_sid = ${sid}::text,
      provider_status = CASE
        WHEN delivery_status IN ('delivered','dead') THEN provider_status
        ELSE ${status}::text
      END,
      sent_at = CASE
        WHEN ${status}::text IN ('accepted','scheduled','queued','sending','sent','delivered','read')
          THEN COALESCE(sent_at, now())
        ELSE sent_at
      END,
      delivery_status = CASE
        WHEN delivery_status IN ('delivered','dead') THEN delivery_status
        WHEN ${status}::text IN ('failed','undelivered','canceled') THEN 'dead'
        WHEN ${status}::text IN ('delivered','read') THEN 'delivered'
        WHEN ${status}::text IN ('accepted','scheduled','queued','sending','sent') THEN 'accepted'
        ELSE delivery_status
      END,
      delivery_error = CASE
        WHEN delivery_status IN ('delivered','dead') THEN delivery_error
        WHEN ${status}::text IN ('failed','undelivered','canceled')
          THEN 'Twilio reported that the operator alert was not delivered.'
        ELSE ''
      END,
      stock = CASE
        WHEN delivery_status IN ('delivered','dead') THEN stock
        WHEN ${status}::text IN ('failed','undelivered','canceled') THEN 'red'
        ELSE stock
      END,
      title = CASE
        WHEN delivery_status IN ('delivered','dead') THEN title
        WHEN ${status}::text IN ('failed','undelivered','canceled') AND title NOT LIKE 'Alert delivery failed - %'
          THEN left('Alert delivery failed - ' || title, 120)
        ELSE title
      END
    WHERE id = ${notificationId}::bigint
      AND (provider_message_sid IS NULL OR provider_message_sid = ${sid}::text)`
  return twiml("")
}
