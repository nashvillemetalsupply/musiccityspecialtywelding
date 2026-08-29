"use server"

import { revalidatePath } from "next/cache"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { sendSmsPersisted } from "@/lib/messages"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getLead } from "@/lib/ops-data"
import { createHash } from "node:crypto"
import { isReservedShopPhone } from "@/lib/people"
import { isDefinitiveTwilioError } from "@/lib/twilio"

async function context(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Sign in required.")
  const commitmentId = Number(formData.get("commitmentId"))
  const leadId = Number(formData.get("leadId"))
  if (!Number.isInteger(commitmentId) || !Number.isInteger(leadId)) throw new Error("Promise not found.")
  return { operator, commitmentId, leadId }
}

export async function confirmPromise(formData: FormData) {
  const { operator, commitmentId, leadId } = await context(formData)
  const sql = getSql()
  const updated = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id, person_id FROM commitments
      WHERE id = ${commitmentId}::bigint AND lead_id = ${leadId}::bigint AND status = 'open'
      FOR UPDATE
    ), receipt AS (
      INSERT INTO events (kind, actor_type, actor_id, lead_id, person_id, body, crew_body, detail)
      SELECT 'commitment.confirmed', 'operator', ${String(operator.id)}::text, ${leadId}::bigint,
        t.person_id, 'Crew inked a promise tag', 'Crew inked a promise tag',
        ${JSON.stringify({ commitmentId })}::jsonb FROM target t
      RETURNING id
    )
    UPDATE commitments c SET confidence = 1::real, confirmed_by = ${operator.id}::bigint,
      status_source_event_id = r.id
    FROM target t CROSS JOIN receipt r WHERE c.id = t.id
    RETURNING c.id`) as { id: number }[]
  if (!updated[0]) throw new Error("That promise is no longer hanging on this work order.")
  revalidatePath(`/ops/leads/${leadId}`); revalidatePath("/ops")
}

export async function publishPromiseToGlass(formData: FormData) {
  const { operator, commitmentId, leadId } = await context(formData)
  if (operator.role !== "owner") throw new Error("Owner access required.")
  const sql = getSql()
  const promise = (await sql`
    SELECT summary, direction, due_at, status FROM commitments
    WHERE id = ${commitmentId}::bigint AND lead_id = ${leadId}::bigint LIMIT 1`) as { summary: string; direction: string; due_at: string | null; status: string }[]
  const item = promise[0]
  const deliveryLanguage = /\b(?:ready|finish|finished|complete|completed|done|deliver|delivery|install|installed|pick[ -]?up|on the job|scheduled|start work)\b/i.test(item?.summary ?? "")
  const excludedLanguage = /\b(?:quote|price|invoice|call|text|email|send|paperwork|deposit|payment)\b/i.test(item?.summary ?? "")
  if (!item || item.direction !== "we_promised" || item.status !== "open" || !item.due_at || !deliveryLanguage || excludedLanguage) {
    throw new Error("Only a dated delivery or job-ready promise can headline the Customer Page.")
  }
  const published = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id, person_id FROM commitments
      WHERE id = ${commitmentId}::bigint AND lead_id = ${leadId}::bigint
        AND status = 'open' AND direction = 'we_promised' AND due_at IS NOT NULL
      FOR UPDATE
    ), receipt AS (
      INSERT INTO events (kind, actor_type, actor_id, lead_id, person_id, body, crew_body, detail)
      SELECT 'commitment.glass-primary', 'operator', ${String(operator.id)}::text, ${leadId}::bigint,
        t.person_id, 'Owner selected the public delivery promise', 'Owner selected the public delivery promise',
        ${JSON.stringify({ commitmentId })}::jsonb FROM target t
      RETURNING id
    ), cleared AS (
      UPDATE commitments SET glass_primary = false, visible_on_glass = false
      WHERE lead_id = ${leadId}::bigint AND glass_primary = true
        AND id <> ${commitmentId}::bigint AND EXISTS (SELECT 1 FROM receipt)
    )
    UPDATE commitments c SET glass_primary = true, visible_on_glass = true,
      confidence = 1::real, confirmed_by = ${operator.id}::bigint, status_source_event_id = r.id
    FROM target t CROSS JOIN receipt r WHERE c.id = t.id
    RETURNING c.id`) as { id: number }[]
  if (!published[0]) throw new Error("That promise is no longer available to publish.")
  revalidatePath(`/ops/leads/${leadId}`); revalidatePath(`/j`)
}

export async function rejectPromise(formData: FormData) {
  const { operator, commitmentId, leadId } = await context(formData)
  const sql = getSql()
  const updated = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id, person_id FROM commitments WHERE id = ${commitmentId}::bigint
        AND lead_id = ${leadId}::bigint AND status = 'open' FOR UPDATE
    ), receipt AS (
      INSERT INTO events (kind, actor_type, actor_id, lead_id, person_id, body, crew_body, detail)
      SELECT 'commitment.rejected', 'operator', ${String(operator.id)}::text, ${leadId}::bigint,
        t.person_id, 'Crew binned a false promise tag', 'Crew binned a false promise tag',
        ${JSON.stringify({ commitmentId })}::jsonb FROM target t RETURNING id
    )
    UPDATE commitments c SET status = 'canceled', status_changed_at = now(),
      confirmed_by = ${operator.id}::bigint, status_source_event_id = r.id
    FROM target t CROSS JOIN receipt r WHERE c.id = t.id RETURNING c.id`) as { id: number }[]
  if (!updated[0]) throw new Error("That promise is no longer hanging on this work order.")
  revalidatePath(`/ops/leads/${leadId}`); revalidatePath("/ops")
}

export async function keepPromise(formData: FormData) {
  const { operator, commitmentId, leadId } = await context(formData)
  const sql = getSql()
  const updated = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id, person_id FROM commitments WHERE id = ${commitmentId}::bigint
        AND lead_id = ${leadId}::bigint AND status = 'open' FOR UPDATE
    ), receipt AS (
      INSERT INTO events (kind, actor_type, actor_id, lead_id, person_id, body, crew_body, detail)
      SELECT 'commitment.kept', 'operator', ${String(operator.id)}::text, ${leadId}::bigint,
        t.person_id, 'Promise kept', 'Promise kept', ${JSON.stringify({ commitmentId })}::jsonb
      FROM target t RETURNING id
    )
    UPDATE commitments c SET status = 'kept', status_changed_at = now(),
      confirmed_by = COALESCE(c.confirmed_by, ${operator.id}::bigint), status_source_event_id = r.id
    FROM target t CROSS JOIN receipt r WHERE c.id = t.id RETURNING c.id`) as { id: number }[]
  if (!updated[0]) throw new Error("That promise is no longer hanging on this work order.")
  revalidatePath(`/ops/leads/${leadId}`); revalidatePath("/ops")
}

export async function handlePromise(formData: FormData) {
  const { operator, commitmentId, leadId } = await context(formData)
  const draftBody = String(formData.get("body") ?? "").trim().slice(0, 800)
  const dueAt = String(formData.get("dueAt") ?? "").trim()
  const quickDue = String(formData.get("quickDue") ?? "tomorrow-am")
  const reason = String(formData.get("reason") ?? "Date changed with the shop.").trim().slice(0, 300)
  const centralParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  const base = new Date(Date.UTC(Number(centralParts.year), Number(centralParts.month) - 1, Number(centralParts.day), 12))
  const days = quickDue === "two-days-am" ? 2 : quickDue === "next-monday-am" ? ((8 - base.getUTCDay()) % 7 || 7) : 1
  const localTarget = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days, 8))
  const offsetLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" }).formatToParts(localTarget).find((part) => part.type === "timeZoneName")?.value ?? "GMT-6"
  const offsetHours = Number(offsetLabel.match(/GMT([+-]\d+)/)?.[1] ?? -6)
  const quickDueAt = new Date(localTarget.getTime() - offsetHours * 60 * 60 * 1000).toISOString()
  const resolvedDueAt = dueAt && !Number.isNaN(new Date(dueAt).getTime()) ? new Date(dueAt).toISOString() : quickDueAt
  if (!draftBody) throw new Error("An honest text is required.")
  const lead = await getLead(leadId, operator.role, { includeTests: true })
  if (lead?.is_test) throw new Error("Internal test jobs never send customer promise updates.")
  if (!lead?.phone || lead.phone_is_placeholder || isReservedShopPhone(lead.phone)) throw new Error("This job needs a real customer phone number.")
  const sql = getSql()
  const rows = (await sql`
    SELECT due_at FROM commitments
    WHERE id = ${commitmentId}::bigint AND lead_id = ${leadId}::bigint
    LIMIT 1`) as { due_at: string | null }[]
  if (!rows[0]) throw new Error("Promise not found.")
  const newDueAt = resolvedDueAt
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(newDueAt))
  const body = `${draftBody.replace(/\s+/g, " ").trim()} New promised date: ${dateLabel} CT.`.slice(0, 1000)
  const intentKey = createHash("sha256").update(JSON.stringify({ leadId, commitmentId, newDueAt, body })).digest("hex")
  let eventId = await recordEvent({ kind: "commitment.reschedule-proposed", actorType: "operator", actorId: operator.id, leadId, personId: lead.person_id, externalId: `reschedule:${intentKey}`, body, crewBody: body, detail: { commitmentId, previousDueAt: rows[0].due_at, dueAt: newDueAt, reason } })
  if (!eventId) {
    const prior = (await sql`SELECT id FROM events WHERE kind = 'commitment.reschedule-proposed' AND external_id = ${`reschedule:${intentKey}`}::text LIMIT 1`) as { id: number }[]
    eventId = Number(prior[0]?.id) || null
  }
  if (!eventId) throw new Error("The new promise could not be recorded.")
  const intents = (await sql`
    INSERT INTO commitment_reschedules (
      commitment_id, lead_id, previous_due_at, proposed_due_at, reason, body,
      source_event_id, created_by, idempotency_key
    ) VALUES (
      ${commitmentId}::bigint, ${leadId}::bigint, ${rows[0].due_at}::timestamptz,
      ${newDueAt}::timestamptz, ${reason}::text, ${body}::text,
      ${eventId}::bigint, ${operator.id}::bigint, ${intentKey}::text
    ) ON CONFLICT (idempotency_key) WHERE idempotency_key <> '' DO NOTHING
    RETURNING id`) as { id: number }[]
  const priorIntent = intents[0] ? [] : (await sql`SELECT id, status FROM commitment_reschedules WHERE idempotency_key = ${intentKey}::text LIMIT 1`) as { id: number; status: string }[]
  const intentId = Number(intents[0]?.id ?? priorIntent[0]?.id)
  if (!intentId) throw new Error("The reschedule intent could not be filed.")
  if (priorIntent[0]?.status === "accepted") return
  if (priorIntent[0]?.status === "unknown") throw new Error("That text may have sent. Check Calls & Messages before changing this promise.")
  if (!lead.is_test) {
    const attempt = (await sql`
      UPDATE commitment_reschedules SET status = 'sending', attempts = attempts + 1, sending_started_at = now()
      WHERE id = ${intentId}::bigint AND status IN ('pending','failed')
      RETURNING attempts`) as { attempts: number }[]
    if (!attempt[0]) throw new Error("That promise update is already being handled. Check Calls & Messages before retrying.")
    try {
      const sent = await sendSmsPersisted({ to: lead.phone, body, leadId, personId: lead.person_id, operatorId: operator.id, rescheduleId: intentId, idempotencyKey: `reschedule:${intentKey}:attempt:${attempt[0].attempts}` })
      await sql`UPDATE commitment_reschedules SET message_id = ${sent.id}::bigint, status = 'pending', sending_started_at = NULL WHERE id = ${intentId}::bigint AND status = 'sending'`
    } catch (error) {
      await sql`UPDATE commitment_reschedules SET status = ${isDefinitiveTwilioError(error) ? "failed" : "unknown"}::text, resolved_at = now(), sending_started_at = NULL WHERE id = ${intentId}::bigint`
      throw error
    }
  }
  await sql`
    WITH accepted AS (
      UPDATE commitment_reschedules SET status = 'accepted', resolved_at = now()
      WHERE id = ${intentId}::bigint AND status = 'pending'
      RETURNING *
    ), history AS (
      INSERT INTO commitment_history (commitment_id, lead_id, previous_due_at, new_due_at, reason, source_event_id, changed_by)
      SELECT commitment_id, lead_id, previous_due_at, proposed_due_at, reason, source_event_id, created_by FROM accepted
    )
    UPDATE commitments c SET due_at = a.proposed_due_at, status_source_event_id = a.source_event_id,
      confirmed_by = a.created_by, confidence = 1::real
    FROM accepted a WHERE c.id = a.commitment_id AND c.lead_id = a.lead_id`
  revalidatePath(`/ops/leads/${leadId}`); revalidatePath("/ops")
}
