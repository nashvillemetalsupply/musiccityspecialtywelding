import { Resend } from "resend"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notifyAll } from "@/lib/notify"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) return Response.json({ error: "Webhook is not configured." }, { status: 503 })

  const payload = await req.text()
  let webhook: ReturnType<Resend["webhooks"]["verify"]>
  try {
    webhook = new Resend(process.env.RESEND_API_KEY).webhooks.verify({
      payload,
      headers: {
        id: req.headers.get("svix-id") || "",
        timestamp: req.headers.get("svix-timestamp") || "",
        signature: req.headers.get("svix-signature") || "",
      },
      webhookSecret: secret,
    })
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 403 })
  }

  if (!("email_id" in webhook.data)) return Response.json({ ok: true })
  if (!["email.delivered", "email.delivery_delayed", "email.bounced", "email.failed", "email.suppressed"].includes(webhook.type)) return Response.json({ ok: true })

  const sql = getSql()
  const failed = ["email.bounced", "email.failed", "email.suppressed"].includes(webhook.type)
  const delayed = webhook.type === "email.delivery_delayed"
  const reason = webhook.type === "email.bounced"
    ? webhook.data.bounce.message
    : webhook.type === "email.failed"
      ? webhook.data.failed.reason
      : webhook.type === "email.suppressed"
        ? webhook.data.suppressed.message
        : delayed ? "Email delivery is delayed." : "Email delivered."
  const notification = (await sql`
    SELECT id, sms_fallback, sms_only, provider_message_sid, provider_email_status, delivery_status
    FROM notifications
    WHERE provider_email_id = ${webhook.data.email_id}::text
    LIMIT 1`) as {
      id: number
      sms_fallback: boolean
      sms_only: boolean
      provider_message_sid: string | null
      provider_email_status: string | null
      delivery_status: string
    }[]
  if (notification[0]) {
    const retrySms = failed && notification[0].sms_fallback && !notification[0].sms_only
      && !notification[0].provider_message_sid
      && notification[0].provider_email_status !== webhook.type
      && !["dead", "delivered"].includes(notification[0].delivery_status)
    if (retrySms) {
      await sql`
        UPDATE notifications SET
          sent_at = NULL,
          interrupt_reserved_at = NULL,
          delivery_attempts = LEAST(delivery_attempts, 4),
          delivery_next_attempt_at = now(),
          provider_email_status = ${webhook.type}::text,
          delivery_status = 'retry',
          delivery_error = ${reason}::text
        WHERE id = ${notification[0].id}::bigint
          AND provider_email_id = ${webhook.data.email_id}::text
          AND provider_message_sid IS NULL
          AND provider_email_status IS DISTINCT FROM ${webhook.type}::text
          AND delivery_status NOT IN ('dead','delivered')`
      return Response.json({ ok: true })
    }
    // A duplicate email-failure callback must never reopen a replacement SMS
    // that is already queued, accepted, delivered, or definitively failed.
    if (failed && notification[0].sms_fallback && !notification[0].sms_only) {
      return Response.json({ ok: true })
    }
    await sql`
      UPDATE notifications SET
        sent_at = COALESCE(sent_at, now()),
        interrupt_reserved_at = NULL,
        delivery_next_attempt_at = NULL,
        provider_email_status = CASE
          WHEN delivery_status = 'dead' THEN provider_email_status
          WHEN ${failed}::boolean THEN ${webhook.type}::text
          WHEN delivery_status = 'delivered' THEN provider_email_status
          ELSE ${webhook.type}::text
        END,
        delivery_status = CASE
          WHEN delivery_status = 'dead' THEN 'dead'
          WHEN ${failed}::boolean THEN 'dead'
          WHEN delivery_status = 'delivered' THEN 'delivered'
          WHEN ${!failed && !delayed}::boolean THEN 'delivered'
          ELSE 'accepted'
        END,
        delivery_error = CASE
          WHEN delivery_status = 'dead' THEN delivery_error
          WHEN ${failed}::boolean THEN ${reason}::text
          WHEN delivery_status = 'delivered' THEN delivery_error
          WHEN ${delayed}::boolean THEN ${reason}::text
          ELSE ''
        END,
        stock = CASE
          WHEN delivery_status = 'dead' THEN stock
          WHEN ${failed}::boolean THEN 'red'
          ELSE stock
        END,
        title = CASE
          WHEN delivery_status = 'dead' THEN title
          WHEN ${failed}::boolean AND title NOT LIKE 'Alert delivery failed - %'
            THEN left('Alert delivery failed - ' || title, 120)
          ELSE title
        END
      WHERE id = ${notification[0].id}::bigint
        AND provider_email_id = ${webhook.data.email_id}::text`
    return Response.json({ ok: true })
  }
  const accepted = (await sql`
    SELECT accepted_event.lead_id, accepted_event.person_id, accepted_event.detail,
      COALESCE(source_event.detail->>'audience', '') AS audience
    FROM events accepted_event
    LEFT JOIN events source_event
      ON source_event.id::text = accepted_event.detail->>'sourceEventId'
    WHERE accepted_event.kind = 'email.accepted'
      AND accepted_event.external_id = ${webhook.data.email_id}::text
    ORDER BY accepted_event.id DESC LIMIT 1`) as {
    lead_id: number | null
    person_id: number | null
    detail: { sourceEventId?: number }
    audience: string
  }[]
  const sourceEventId = Number(accepted[0]?.detail?.sourceEventId)
  if (!accepted[0] || !Number.isInteger(sourceEventId) || sourceEventId <= 0) {
    // Provider callbacks can beat the request that persists email.accepted.
    // A success response would discard the only signed delivery receipt.
    return Response.json(
      { ok: false, retry: true, error: "Email acceptance is still being recorded." },
      { status: 503, headers: { "Retry-After": "15" } },
    )
  }

  const eventKind = failed ? "email.failed" : delayed ? "email.delayed" : "email.delivered"
  let eventId = await recordEvent({
    kind: eventKind,
    actorType: "system",
    leadId: accepted[0].lead_id,
    personId: accepted[0].person_id,
    externalId: `resend:${webhook.type}:${webhook.data.email_id}`,
    body: reason,
    crewBody: failed ? "Customer email did not deliver." : delayed ? "Customer email is delayed." : "Customer email delivered.",
    detail: { sourceEventId, providerEmailId: webhook.data.email_id, providerType: webhook.type },
  })
  if (!eventId) {
    const existing = (await sql`SELECT id FROM events WHERE kind = ${eventKind}::text AND external_id = ${`resend:${webhook.type}:${webhook.data.email_id}`}::text LIMIT 1`) as { id: number }[]
    eventId = Number(existing[0]?.id) || null
  }
  if (!eventId) return Response.json({ error: "Delivery receipt could not be resumed." }, { status: 500 })
  if (accepted[0].lead_id && accepted[0].audience === "shop") {
    // This legacy lead column is explicitly labelled "Owner email" in the
    // work order. Customer replies and confirmations keep their own immutable
    // receipts, but must not overwrite the owner-alert summary. Failure wins;
    // delayed never regresses delivered/failed, and delivered never erases a
    // known failure.
    await sql`
      UPDATE leads SET
        email_delivery_status = CASE
          WHEN email_delivery_status = 'failed' OR ${failed}::boolean THEN 'failed'
          WHEN email_delivery_status = ANY(ARRAY['sent','delivered']::text[]) THEN email_delivery_status
          WHEN ${!failed && !delayed}::boolean THEN 'delivered'
          WHEN ${delayed}::boolean THEN 'delayed'
          ELSE email_delivery_status
        END,
        email_delivery_error = CASE
          WHEN email_delivery_status = 'failed' THEN email_delivery_error
          WHEN ${failed}::boolean THEN ${reason}::text
          WHEN ${!failed && !delayed}::boolean THEN ''
          ELSE email_delivery_error
        END,
        email_delivered_at = CASE
          WHEN ${!failed && !delayed}::boolean THEN COALESCE(email_delivered_at, now())
          ELSE email_delivered_at
        END,
        updated_at = now()
      WHERE id = ${accepted[0].lead_id}::bigint`
  }
  if (accepted[0].lead_id && failed) {
    const lead = (await sql`SELECT is_test FROM leads WHERE id = ${accepted[0].lead_id}::bigint LIMIT 1`) as { is_test: boolean }[]
    if (!lead[0]?.is_test) await notifyAll({ priority: "digest", stock: "red", title: "Email did not deliver", body: reason, crewBody: "Customer email did not deliver.", url: `/ops/leads/${accepted[0].lead_id}#spike`, sourceEventId: eventId, dedupeKey: `resend-failure:${webhook.data.email_id}` })
  }
  return Response.json({ ok: true })
}
