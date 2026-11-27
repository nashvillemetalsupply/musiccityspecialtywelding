import { Resend } from "resend"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { markLeadDelivery } from "@/lib/leads"
import { notifyAll, notifyOwnerCellSms } from "@/lib/notify"

export const runtime = "nodejs"

type EmailCallbackMatch = {
  kind: string
  lead_id: number | null
  person_id: number | null
  detail: { sourceEventId?: number; attemptEventId?: number | null }
  audience: string
  is_test: boolean
}

async function findTaggedQuote(tags: Record<string, string> | undefined): Promise<EmailCallbackMatch | undefined> {
  if (typeof tags?.quote_intent !== "string") return
  const match = tags.quote_intent.match(/^quote-(owner|customer)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  if (!match) return
  const recipient = match[1].toLowerCase()
  const intakeKey = match[2]
  const audience = recipient === "owner" ? "shop" : "customer"
  if (tags?.audience !== audience) return

  const sql = getSql()
  const [quote] = (await sql`
    SELECT attempt.kind, intent.lead_id, intent.person_id,
      jsonb_build_object('sourceEventId', intent.id, 'attemptEventId',
        CASE WHEN attempt.unresolved_count = 1 OR attempt.candidate_count = 1 THEN attempt.id END) AS detail,
      intent.detail->>'audience' AS audience,
      (intent.is_test OR attempt.is_test
        OR lower(COALESCE(intent.detail->>'isTest', 'false')) = 'true'
        OR COALESCE(l.is_test, false) OR COALESCE(p.is_test, false)) AS is_test
    FROM events intent
    JOIN LATERAL (
      SELECT attempt.id, attempt.kind, attempt.is_test, count(*) OVER () AS candidate_count,
        count(*) FILTER (WHERE rejection.id IS NULL) OVER () AS unresolved_count,
        rejection.id IS NULL AS unresolved
      FROM events attempt
      LEFT JOIN events rejection ON rejection.kind = 'email.failed' AND rejection.lead_id = intent.lead_id
        AND rejection.external_id = 'request-failed:' || attempt.id::text
        AND rejection.detail->>'attemptEventId' = attempt.id::text
      WHERE attempt.kind = 'email.attempt' AND attempt.lead_id = intent.lead_id
        AND attempt.detail->>'sourceEventId' = intent.id::text
      ORDER BY unresolved DESC, attempt.id DESC
      LIMIT 1
    ) attempt ON true
    LEFT JOIN leads l ON l.id = intent.lead_id
    LEFT JOIN people p ON p.id = intent.person_id
    WHERE intent.kind = 'email.out' AND intent.external_id = ${`quote-${recipient}:${intakeKey}`}::text
      AND intent.detail->>'audience' = ${audience}::text AND intent.detail->>'frozenPayload' IS NOT NULL
    LIMIT 1`) as EmailCallbackMatch[]
  return quote
}

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
  if (!["email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.failed", "email.suppressed"].includes(webhook.type)) return Response.json({ ok: true })

  const sql = getSql()
  const isProduction = process.env.VERCEL_ENV === "production"
  const failed = ["email.bounced", "email.complained", "email.failed", "email.suppressed"].includes(webhook.type)
  const delayed = webhook.type === "email.delivery_delayed"
  const reason = webhook.type === "email.bounced"
    ? webhook.data.bounce.message
    : webhook.type === "email.failed"
      ? webhook.data.failed.reason
      : webhook.type === "email.suppressed"
        ? webhook.data.suppressed.message
        : webhook.type === "email.complained"
          ? "The recipient marked the email as spam."
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
    if (!isProduction || webhook.type === "email.complained") return Response.json({ ok: true })
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
  const [providerMatch] = (await sql`
    SELECT accepted_event.kind, accepted_event.lead_id, accepted_event.person_id, accepted_event.detail,
      COALESCE(source_event.detail->>'audience', '') AS audience,
      (accepted_event.is_test OR COALESCE(source_event.is_test, false)
        OR lower(COALESCE(source_event.detail->>'isTest', 'false')) = 'true'
        OR COALESCE(l.is_test, false) OR COALESCE(p.is_test, false) OR COALESCE(s.is_test, false)
        OR EXISTS (SELECT 1 FROM assistant_turns t WHERE t.session_id = s.id
          AND (t.is_test OR t.inbound ILIKE '%[INTERNAL TEST]%'))
      ) AS is_test
    FROM events accepted_event
    LEFT JOIN events source_event
      ON source_event.id::text = accepted_event.detail->>'sourceEventId'
    LEFT JOIN leads l ON l.id = accepted_event.lead_id
    LEFT JOIN people p ON p.id = accepted_event.person_id
    LEFT JOIN assistant_sessions s ON s.id::text = source_event.detail->>'sessionId'
    WHERE (accepted_event.kind = 'email.accepted' AND accepted_event.external_id = ${webhook.data.email_id}::text)
      OR (accepted_event.kind = 'email.unknown' AND accepted_event.detail->>'providerEmailId' = ${webhook.data.email_id}::text)
      OR (accepted_event.kind IN ('email.delivered','email.failed','email.delayed')
        AND accepted_event.detail->>'providerEmailId' = ${webhook.data.email_id}::text)
    ORDER BY (accepted_event.kind = 'email.accepted') DESC,
      (accepted_event.kind = 'email.delivered') DESC, accepted_event.id DESC
    LIMIT 1`) as EmailCallbackMatch[]
  const associated = providerMatch ?? await findTaggedQuote("tags" in webhook.data ? webhook.data.tags : undefined)
  if (webhook.type === "email.complained" && associated && !["shop", "customer"].includes(associated.audience)) {
    return Response.json({ ok: true })
  }
  const sourceEventId = Number(associated?.detail?.sourceEventId)
  if (!associated || !Number.isInteger(sourceEventId) || sourceEventId <= 0) {
    // Provider callbacks can beat the request that persists email.accepted.
    // A success response would discard the only signed delivery receipt.
    return Response.json(
      { ok: false, retry: true, error: "Email acceptance is still being recorded." },
      { status: 503, headers: { "Retry-After": "15" } },
    )
  }

  const receiptDetail = {
    sourceEventId,
    attemptEventId: associated.detail.attemptEventId ?? undefined,
    providerEmailId: webhook.data.email_id,
    audience: associated.audience,
    isTest: associated.is_test === true,
  }
  if (["email.unknown", "email.attempt"].includes(associated.kind) && (failed || delayed)) {
    // A delivery problem still confirms the provider took the send request.
    await recordEvent({
      kind: "email.accepted",
      actorType: "system",
      leadId: associated.lead_id,
      personId: associated.person_id,
      externalId: webhook.data.email_id,
      body: "Email accepted by the delivery provider.",
      crewBody: "Email accepted by the delivery provider.",
      detail: receiptDetail,
    })
  }
  const eventKind = failed ? "email.failed" : delayed ? "email.delayed" : "email.delivered"
  let eventId = await recordEvent({
    kind: eventKind,
    actorType: "system",
    leadId: associated.lead_id,
    personId: associated.person_id,
    externalId: `resend:${webhook.type}:${webhook.data.email_id}`,
    body: reason,
    crewBody: failed ? "Customer email did not deliver." : delayed ? "Customer email is delayed." : "Customer email delivered.",
    detail: { ...receiptDetail, providerType: webhook.type },
  })
  if (!eventId) {
    const existing = (await sql`SELECT id FROM events WHERE kind = ${eventKind}::text AND external_id = ${`resend:${webhook.type}:${webhook.data.email_id}`}::text LIMIT 1`) as { id: number }[]
    eventId = Number(existing[0]?.id) || null
  }
  if (!eventId) return Response.json({ error: "Delivery receipt could not be resumed." }, { status: 500 })
  if (associated.lead_id && associated.audience === "shop") {
    const status = failed ? "bounced" : delayed ? "delayed" : "delivered"
    await markLeadDelivery(associated.lead_id, status, reason)
  }
  // The production recovery sweep can file a missed lead alert from this receipt.
  if (!isProduction) return Response.json({ ok: true })
  if (associated.audience === "assistant-shop" && (failed || delayed) && associated.is_test === false) {
    // A human request may have no callback or lead yet. Its saved transcript
    // must still reach the owner's existing phone alert path on inbox failure.
    const alert = await notifyOwnerCellSms({ title: failed ? "Assistant transcript email did not deliver" : "Assistant transcript email is delayed",
      body: "Open the saved assistant conversation and contact the customer.",
      url: associated.lead_id ? `/ops/leads/${associated.lead_id}` : `/board/updates?receipt=${sourceEventId}#receipt`,
      sourceEventId: eventId, dedupeKey: `assistant-email-status:${webhook.type}:${webhook.data.email_id}`,
      capExempt: true, quietHoursExempt: true })
    if (alert.reason === "not-for-role") return Response.json({ ok: false, retry: true,
      error: "Assistant shop phone recipient is not configured." }, { status: 503, headers: { "Retry-After": "60" } })
  }
  if (associated.lead_id && failed && associated.is_test === false) {
    const lead = (await sql`SELECT is_test FROM leads WHERE id = ${associated.lead_id}::bigint LIMIT 1`) as { is_test: boolean }[]
    if (!lead[0]?.is_test) await notifyAll({ priority: "digest", stock: "red", title: "Email did not deliver", body: reason, crewBody: "Customer email did not deliver.", url: `/ops/leads/${associated.lead_id}#spike`, sourceEventId: eventId, dedupeKey: `resend-failure:${webhook.data.email_id}` })
  }
  return Response.json({ ok: true })
}
