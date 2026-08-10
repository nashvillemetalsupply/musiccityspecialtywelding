import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notify, notifyAll } from "@/lib/notify"
import { readTwilioForm, twilioSmsWebhookConfigured, twiml } from "@/lib/twilio"

export async function POST(req: Request) {
  if (!twilioSmsWebhookConfigured()) return twiml("", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)
  const sid = params.get("MessageSid")?.trim() ?? ""
  const status = params.get("MessageStatus")?.trim().slice(0, 40) ?? ""
  if (sid && status) {
    const sql = getSql()
    const intentValue = new URL(req.url).searchParams.get("intent")?.trim() ?? ""
    const parsedIntent = /^\d+$/.test(intentValue) ? Number(intentValue) : 0
    const intentId = Number.isSafeInteger(parsedIntent) && parsedIntent > 0 ? parsedIntent : null
    // A provider callback may beat the Messages API response or arrive after
    // our response was lost. The signed intent id safely reconciles that
    // pending row while the provider SID remains the primary lookup key.
    const rows = (await sql`
      UPDATE messages SET
        twilio_sid = CASE WHEN twilio_sid LIKE 'pending:%' THEN ${sid}::text ELSE twilio_sid END,
        status = CASE
          -- sending on a pending row is local intent state, not provider
          -- progress. A signed callback can beat the REST response, so its
          -- first recognized status must establish provider truth.
          WHEN twilio_sid LIKE 'pending:%' AND ${status}::text IN (
            'accepted', 'scheduled', 'queued', 'sending', 'sent',
            'delivered', 'read', 'failed', 'undelivered', 'canceled'
          ) THEN ${status}::text
          WHEN status IN ('read', 'failed', 'undelivered', 'canceled') THEN status
          WHEN ${status}::text IN ('failed', 'undelivered', 'canceled') THEN ${status}::text
          WHEN (
            CASE ${status}::text
              WHEN 'accepted' THEN 0 WHEN 'scheduled' THEN 0 WHEN 'queued' THEN 1
              WHEN 'sending' THEN 2 WHEN 'sent' THEN 3 WHEN 'delivered' THEN 4 WHEN 'read' THEN 5
              ELSE -1
            END
          ) >= (
            CASE status
              WHEN 'accepted' THEN 0 WHEN 'scheduled' THEN 0 WHEN 'queued' THEN 1
              WHEN 'sending' THEN 2 WHEN 'sent' THEN 3 WHEN 'delivered' THEN 4 WHEN 'read' THEN 5
              ELSE -1
            END
          ) THEN ${status}::text
          ELSE status
        END
      WHERE direction = 'out' AND (
        twilio_sid = ${sid}::text OR
        (id = ${intentId}::bigint AND twilio_sid LIKE 'pending:%')
      )
      RETURNING id, lead_id, person_id, operator_id, reschedule_id, idempotency_key, status`) as {
      id: number
      lead_id: number | null
      person_id: number | null
      operator_id: number | null
      reschedule_id: number | null
      idempotency_key: string
      status: string
    }[]
    const message = rows[0]
    if (message) await sql`
      UPDATE notifications SET read_at = COALESCE(read_at, now())
      WHERE read_at IS NULL AND source_event_id IN (
        SELECT id FROM events
        WHERE kind = 'sms.delivery-unknown'
          AND detail->>'messageId' = ${String(message.id)}::text
      )`
    const effectiveStatus = message?.status ?? status
    if (message && ["failed", "undelivered"].includes(effectiveStatus)) {
      const tests = message.lead_id ? (await sql`
        SELECT is_test FROM leads WHERE id = ${message.lead_id}::bigint LIMIT 1`) as { is_test: boolean }[] : []
      let eventId = await recordEvent({
        kind: "sms.failed",
        actorType: "system",
        leadId: message.lead_id,
        personId: message.person_id,
        externalId: `${sid}:${effectiveStatus}`,
        body: "Customer text was not delivered",
        crewBody: "Customer text was not delivered",
        detail: { sid, status: effectiveStatus, callbackStatus: status },
      })
      if (!eventId) {
        const existing = (await sql`SELECT id FROM events WHERE kind = 'sms.failed' AND external_id = ${`${sid}:${effectiveStatus}`}::text LIMIT 1`) as { id: number }[]
        eventId = Number(existing[0]?.id) || null
      }
      if (message.reschedule_id && eventId) {
        await sql`
          WITH failed AS (
            UPDATE commitment_reschedules SET status = 'failed', resolved_at = now()
            WHERE id = ${message.reschedule_id}::bigint AND status = 'accepted'
            RETURNING *
          ), history AS (
            INSERT INTO commitment_history (commitment_id, lead_id, previous_due_at, new_due_at, reason, source_event_id, changed_by)
            SELECT commitment_id, lead_id, proposed_due_at, previous_due_at,
              'Customer text failed — prior public date restored', ${eventId}::bigint, created_by
            FROM failed
          )
          UPDATE commitments c SET due_at = f.previous_due_at, status_source_event_id = ${eventId}::bigint
          FROM failed f WHERE c.id = f.commitment_id AND c.due_at = f.proposed_due_at`
      }
      const glassMatch = message.idempotency_key.match(/^glass:([a-f0-9]{64}):send:(\d+)$/i)
      if (glassMatch) await sql`
        UPDATE glass_links SET sent_at = NULL, send_status = 'failed', send_claimed_at = NULL
        WHERE token_hash = ${glassMatch[1]}::text AND send_attempts = ${Number(glassMatch[2])}::int`
      if (!tests[0]?.is_test && eventId) {
        const alert = {
          priority: "interrupt",
          stock: "red",
          title: "Text did not deliver",
          body: "Call the customer or try another channel.",
          crewBody: "Call the customer or try another channel.",
          url: message.lead_id ? `/ops/leads/${message.lead_id}#spike` : "/ops",
          sourceEventId: eventId,
        } as const
        if (message.operator_id) await notify({ ...alert, operatorId: message.operator_id })
        else await notifyAll(alert)
      }
    }
  }
  return twiml("")
}
