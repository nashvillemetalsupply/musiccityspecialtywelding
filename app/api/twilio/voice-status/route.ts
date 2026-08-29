import { after } from "next/server"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { sendSmsPersisted } from "@/lib/messages"
import { notifyAll } from "@/lib/notify"
import { normalizePhone } from "@/lib/people"
import { prepareInboundCallIntake, type CallIntakeDraft } from "@/lib/job-intake"
import { readTwilioForm, twilioSmsConfigured, twilioVoiceConfigured, twiml } from "@/lib/twilio"
import { runRecoverySweep } from "@/lib/recovery-sweep"

export const runtime = "nodejs"

export async function POST(req: Request) {
  if (!twilioVoiceConfigured()) return twiml("", 503)
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return twiml("", 403)
  const sid = params.get("CallSid") ?? ""
  const status = params.get("DialCallStatus") || params.get("CallStatus") || "unknown"
  const duration = Number(params.get("DialCallDuration") || params.get("CallDuration") || 0)
  const sql = getSql()
  const rows = (await sql`
    UPDATE calls SET status = ${status}::text, duration_sec = ${duration}::int, updated_at = now()
    WHERE twilio_sid = ${sid}::text AND direction = 'in'
    RETURNING lead_id, person_id, from_phone,
      (
        COALESCE((SELECT is_test FROM leads WHERE id = calls.lead_id), false)
        OR COALESCE((SELECT is_test FROM people WHERE id = calls.person_id), false)
        OR lower(COALESCE(calls.detail->>'isTest', 'false')) = 'true'
        OR COALESCE(calls.detail->>'callerName', '') LIKE '%[INTERNAL TEST]%'
      ) AS is_test`) as {
    lead_id: number | null
    person_id: number | null
    from_phone: string
    is_test: boolean
  }[]
  const call = rows[0]
  let draft: CallIntakeDraft | null = null
  if (call && !call.lead_id) {
    const prepared = await prepareInboundCallIntake({
      callSid: sid,
      phone: call.from_phone,
      isTest: call.is_test,
    })
    if (prepared.kind === "existing") {
      call.lead_id = prepared.leadId
      call.person_id = prepared.person.id
      call.is_test = call.is_test || prepared.person.is_test
    } else {
      draft = prepared.draft
      call.person_id = prepared.person?.id ?? call.person_id
      call.is_test = call.is_test || Boolean(prepared.person?.is_test || prepared.draft.is_test)
    }
  }
  // The signed provider receipt and its test partition are resolved before
  // this callback is registered. Later alert or auto-reply failure cannot
  // prevent a real inbound call from waking the bounded recovery pass.
  if (call && !call.is_test) after(async () => {
    const result = await runRecoverySweep({ trigger: "twilio-call" })
    if (!result.ok) console.error("Inbound call recovery failed:", result.error)
  })
  if (call && ["answered", "completed"].includes(status) && duration > 0 && call.lead_id) {
    const operators = (await sql`
      SELECT id FROM operators
      WHERE active = true AND (
        cell_phone = ${process.env.OWNER_CELL_PHONE?.trim() ?? ""}::text OR role = 'owner'
      )
      ORDER BY (cell_phone = ${process.env.OWNER_CELL_PHONE?.trim() ?? ""}::text) DESC, id ASC
      LIMIT 1`) as { id: number }[]
    await recordEvent({
      kind: "call.answered",
      actorType: "operator",
      actorId: operators[0]?.id ?? "",
      leadId: call.lead_id,
      personId: call.person_id,
      externalId: `${sid}:answered`,
      body: "The shop answered the customer call",
      crewBody: "The shop answered the customer call",
      detail: { durationSec: duration },
    })
    await sql`
      UPDATE leads SET
        first_response_at = COALESCE(first_response_at, now()),
        first_response_channel = CASE WHEN first_response_at IS NULL THEN 'phone' ELSE first_response_channel END,
        status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
        updated_at = now()
      WHERE id = ${call.lead_id}::bigint`
  }
  if (call && draft && ["answered", "completed"].includes(status) && duration > 0) {
    let eventId = await recordEvent({
      kind: "call.answered",
      actorType: "operator",
      leadId: null,
      personId: call.person_id,
      externalId: `${sid}:answered`,
      body: "The shop answered the customer call",
      crewBody: "The shop answered the customer call",
      detail: { durationSec: duration, callSid: sid, awaitingSave: true, isTest: call.is_test },
    })
    if (!eventId) {
      const prior = (await sql`
        SELECT id FROM events WHERE kind = 'call.answered' AND external_id = ${`${sid}:answered`}::text LIMIT 1`) as { id: number }[]
      eventId = Number(prior[0]?.id) || null
    }
    if (eventId && !call.is_test) await notifyAll({
      priority: "interrupt",
      stock: "white",
      title: "Save this call",
      body: "The name and number are ready. Add what they need, then tap Save Job.",
      crewBody: "The name and number are ready. Add what they need, then tap Save Job.",
      url: `/ops/intake/${draft.public_id}`,
      sourceEventId: eventId,
      capExempt: true,
      quietHoursExempt: true,
    })
  }
  if (call && ["no-answer", "busy", "failed", "canceled"].includes(status)) {
    let eventId = await recordEvent({
      kind: "call.missed",
      actorType: "customer",
      actorId: call.person_id ?? "",
      leadId: call.lead_id,
      personId: call.person_id,
      externalId: `${sid}:missed`,
      body: "Customer call was missed",
      detail: { status, isTest: call.is_test },
    })
    if (!eventId) {
      const prior = (await sql`SELECT id FROM events WHERE kind = 'call.missed' AND external_id = ${`${sid}:missed`}::text LIMIT 1`) as { id: number }[]
      eventId = Number(prior[0]?.id) || null
    }
    // Every side effect below is independently idempotent, so a provider retry
    // resumes work after a crash between the immutable receipt and notification.
    if (!eventId || call.is_test) return twiml("")
    await notifyAll({
      priority: "interrupt",
      stock: "red",
      title: "Missed shop call",
      body: draft ? "Call back, then Save Job or mark Not a job." : "Call them back. Their job is ready.",
      url: call.lead_id ? `/ops/leads/${call.lead_id}` : draft ? `/ops/intake/${draft.public_id}` : "/ops",
      sourceEventId: eventId,
    })
    if (twilioSmsConfigured() && normalizePhone(call.from_phone)) await sendSmsPersisted({
      to: call.from_phone,
      body: "Sorry we missed you. Text what you need and send a photo if you can. — Music City Specialty Welding",
      leadId: call.lead_id,
      personId: call.person_id,
      idempotencyKey: `missed-call:${sid}:auto-reply`,
    }).catch(() => undefined)
  }
  return twiml("")
}
