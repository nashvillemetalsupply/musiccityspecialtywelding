import { randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notify } from "@/lib/notify"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { isReservedShopPhone, normalizePhone } from "@/lib/people"
import { isDefinitiveTwilioError, startVoiceCall, twilioCallbackUrl, twilioVoiceConfigured } from "@/lib/twilio"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (!twilioVoiceConfigured()) return Response.json({ error: "Tracked calling is waiting on the new Twilio number." }, { status: 503 })
  if (!normalizePhone(operator.cell_phone)) return Response.json({ error: "Add your cell number on the Shop card first." }, { status: 409 })
  const body = await req.json().catch(() => null) as { leadId?: number; targetPhone?: string; intentKey?: string } | null
  const leadId = Number(body?.leadId)
  const intentKey = String(body?.intentKey ?? "").trim()
  if (!Number.isInteger(leadId) || leadId <= 0) return Response.json({ error: "Work order not found." }, { status: 400 })
  if (!/^[0-9a-f-]{36}$/i.test(intentKey)) return Response.json({ error: "Reload the work order before starting this call." }, { status: 400 })
  const sql = getSql()
  const leads = (await sql`
    SELECT l.id, l.first_name, l.phone, l.person_id, l.is_test,
      COALESCE(p.account_key, '') AS account_key
    FROM leads l LEFT JOIN people p ON p.id = l.person_id
    WHERE l.id = ${leadId}::bigint LIMIT 1`) as { id: number; first_name: string; phone: string; person_id: number | null; is_test: boolean; account_key: string }[]
  const lead = leads[0]
  if (!lead) return Response.json({ error: "Work order not found." }, { status: 404 })
  if (lead.is_test) return Response.json({ error: "Tracked calls never leave an INTERNAL TEST work order." }, { status: 409 })
  const requestedPhone = normalizePhone(body?.targetPhone ?? "")
  const leadPhone = normalizePhone(lead.phone)
  const targetPhone = requestedPhone || leadPhone
  if (!targetPhone || isReservedShopPhone(targetPhone)) return Response.json({ error: "This work order needs a customer phone number." }, { status: 409 })
  let targetPersonId = lead.person_id
  if (targetPhone !== leadPhone) {
    const contacts = (await sql`
      SELECT p.id FROM people p
      WHERE p.merged_into IS NULL AND p.is_test = ${lead.is_test}::boolean
        AND ${targetPhone}::text = ANY(p.phones)
        AND (
          p.id = ${lead.person_id}::bigint OR
          (${lead.account_key}::text <> '' AND p.account_key = ${lead.account_key}::text)
        )
      LIMIT 1`) as { id: number }[]
    if (!contacts[0]) return Response.json({ error: "That phone is not attached to this customer account." }, { status: 409 })
    targetPersonId = Number(contacts[0].id)
  }
  const pendingSid = `pending:${randomUUID()}`
  const rows = (await sql`
    INSERT INTO calls (twilio_sid, direction, from_phone, to_phone, status, lead_id, person_id, operator_id, detail, idempotency_key)
    VALUES (${pendingSid}::text, 'out', ${process.env.TWILIO_PHONE_NUMBER!}::text, ${targetPhone}::text,
      'persisted', ${leadId}::bigint, ${targetPersonId}::bigint, ${operator.id}::bigint,
      ${JSON.stringify({ operatorCell: operator.cell_phone })}::jsonb, ${`tracked-call:${operator.id}:${intentKey}`}::text)
    ON CONFLICT (idempotency_key) WHERE idempotency_key <> '' DO NOTHING
    RETURNING id`) as { id: number }[]
  const prior = rows[0] ? [] : (await sql`
    SELECT id, status FROM calls WHERE idempotency_key = ${`tracked-call:${operator.id}:${intentKey}`}::text LIMIT 1`) as { id: number; status: string }[]
  const callId = Number(rows[0]?.id ?? prior[0]?.id)
  if (!callId) return Response.json({ error: "The tracked call intent could not be filed." }, { status: 500 })
  if (prior[0]) {
    if (["failed", "unknown"].includes(prior[0].status)) return Response.json({ error: "This call attempt needs a human check before another ring." }, { status: 409 })
    return Response.json({ ok: true, callId, message: "That tracked call is already ringing or filed." })
  }
  const claimed = (await sql`UPDATE calls SET status = 'starting', starting_started_at = now() WHERE id = ${callId}::bigint AND status = 'persisted' RETURNING id`) as { id: number }[]
  if (!claimed[0]) return Response.json({ ok: true, callId, message: "That tracked call is already being handled." })
  const eventId = await recordEvent({ kind: "call.out.intent", actorType: "operator", actorId: operator.id, leadId, personId: targetPersonId, externalId: pendingSid, body: `Calling ${lead.first_name || "customer"} through the shop line`, crewBody: `Calling ${lead.first_name || "customer"} through the shop line`, detail: { callId, targetPersonId } })
  try {
    const call = await startVoiceCall({
      to: operator.cell_phone,
      url: twilioCallbackUrl(`/api/twilio/outbound-connect?intent=${callId}`),
      statusCallback: twilioCallbackUrl(`/api/twilio/outbound-status?intent=${callId}`),
    })
    await sql`UPDATE calls SET twilio_sid = ${call.sid}::text, status = ${call.status}::text WHERE id = ${callId}::bigint AND twilio_sid = ${pendingSid}::text`
    return Response.json({ ok: true, callId, message: `Calling ${operator.name || "your phone"} now.` })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tracked call failed."
    const definitive = isDefinitiveTwilioError(error)
    const currentReceipt = async () => ((await sql`
      SELECT twilio_sid FROM calls WHERE id = ${callId}::bigint LIMIT 1`) as { twilio_sid: string }[])[0]
    const transitioned = (await sql`
      UPDATE calls SET status = ${definitive ? "failed" : "unknown"}::text,
        detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ error: message, ambiguous: !definitive })}::jsonb
      WHERE id = ${callId}::bigint AND twilio_sid = ${pendingSid}::text AND status = 'starting'
      RETURNING id`) as { id: number }[]
    if (!transitioned[0]) {
      const receipt = await currentReceipt()
      if (receipt && !receipt.twilio_sid.startsWith("pending:")) {
        return Response.json({ ok: true, callId, message: "Twilio accepted the tracked call." })
      }
    }
    const failedEventId = await recordEvent({ kind: definitive ? "call.out.failed" : "call.out.unknown", actorType: "system", leadId, personId: targetPersonId, externalId: `${pendingSid}:${definitive ? "failed" : "unknown"}`, body: message, crewBody: definitive ? "Tracked call could not start" : "Tracked call may have started. Verify before ringing again.", detail: { sourceEventId: eventId, callId, targetPersonId, ambiguous: !definitive } })
    if (!definitive) {
      const receipt = await currentReceipt()
      if (receipt && !receipt.twilio_sid.startsWith("pending:")) {
        return Response.json({ ok: true, callId, message: "Twilio accepted the tracked call." })
      }
    }
    await notify({ operatorId: operator.id, priority: "interrupt", stock: "red", title: definitive ? "Tracked call did not start" : "Check this call before ringing again", body: definitive ? "Use the phone fallback on the work order." : "Twilio may have started it. Check the call receipt before trying again.", crewBody: definitive ? "Use the phone fallback on the work order." : "The call may have started. Verify before trying again.", url: `/ops/leads/${leadId}`, sourceEventId: failedEventId })
    if (!definitive) {
      const receipt = await currentReceipt()
      if (receipt && !receipt.twilio_sid.startsWith("pending:")) {
        if (failedEventId) await sql`
          UPDATE notifications SET read_at = COALESCE(read_at, now())
          WHERE source_event_id = ${failedEventId}::bigint AND read_at IS NULL`
        return Response.json({ ok: true, callId, message: "Twilio accepted the tracked call." })
      }
    }
    return Response.json({ error: message }, { status: 502 })
  }
}
