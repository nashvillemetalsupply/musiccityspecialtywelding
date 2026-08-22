"use server"

import { revalidatePath } from "next/cache"
import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export type HandoffActionState = {
  status: "idle" | "handed-off" | "active" | "error"
  message: string
  handoffEventId: number | null
  undoUntil: string | null
  actionEventId?: number | null
}

function leadIdFrom(formData: FormData) {
  const leadId = Number(formData.get("leadId"))
  return Number.isInteger(leadId) && leadId > 0 ? leadId : null
}

function undoDeadline(occurredAt: string) {
  return new Date(new Date(occurredAt).getTime() + 10_000).toISOString()
}

function refreshHandoff(leadId: number) {
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function markJobHandedOff(
  _state: HandoffActionState,
  formData: FormData,
): Promise<HandoffActionState> {
  const operator = await getAuthenticatedOperator()
  if (!operator) return { status: "error", message: "Sign in again before recording the handoff.", handoffEventId: null, undoUntil: null }
  const leadId = leadIdFrom(formData)
  if (!leadId) return { status: "error", message: "Job not found.", handoffEventId: null, undoUntil: null }

  const detail = {
    operatorName: operator.name,
    handoff: "pickup-or-delivery",
    removedFromActiveJobs: true,
  }
  const sql = getSql()
  try {
    const rows = (await sql`
      WITH target AS MATERIALIZED (
        SELECT id, person_id
        FROM leads
        WHERE id = ${leadId}::bigint
          AND completed_at IS NOT NULL
          AND handed_off_at IS NULL
        FOR UPDATE
      ), immutable_receipt AS (
        INSERT INTO events (
          occurred_at, kind, actor_type, actor_id, lead_id, person_id,
          external_id, body, crew_body, detail
        )
        SELECT now(), 'job.handed-off'::text, 'operator'::text,
          ${String(operator.id)}::text, t.id, t.person_id,
          ''::text,
          'Pickup or delivery handoff recorded. Job removed from Active Jobs.'::text,
          'Pickup or delivery handoff recorded. Job removed from Active Jobs.'::text,
          ${JSON.stringify(detail)}::jsonb || jsonb_build_object('legacyType', 'handoff_completed'::text)
        FROM target t
        RETURNING id, occurred_at
      ), lead_update AS (
        UPDATE leads l SET
          handed_off_at = receipt.occurred_at,
          updated_at = now()
        FROM target t CROSS JOIN immutable_receipt receipt
        WHERE l.id = t.id
        RETURNING l.handed_off_at
      )
      SELECT receipt.id AS event_id, receipt.occurred_at
      FROM immutable_receipt receipt CROSS JOIN lead_update updated`) as Array<{
        event_id: number
        occurred_at: string
      }>

    if (rows[0]) {
      refreshHandoff(leadId)
      return {
        status: "handed-off",
        message: "Pickup or delivery handoff recorded. Removed from Active Jobs; the job stays in customer history.",
        handoffEventId: Number(rows[0].event_id),
        undoUntil: undoDeadline(rows[0].occurred_at),
        actionEventId: Number(rows[0].event_id),
      }
    }

    // Response-loss or double-tap recovery: do not append a second receipt.
    // Return the exact current handoff, with Undo only to its original operator.
    const current = (await sql`
      SELECT l.completed_at, l.handed_off_at,
        receipt.id AS event_id, receipt.occurred_at, receipt.actor_id
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT id, occurred_at, actor_id
        FROM events
        WHERE lead_id = l.id
          AND kind = 'job.handed-off'
          AND occurred_at = l.handed_off_at
        ORDER BY id DESC LIMIT 1
      ) receipt ON true
      WHERE l.id = ${leadId}::bigint
      LIMIT 1`) as Array<{
        completed_at: string | null
        handed_off_at: string | null
        event_id: number | null
        occurred_at: string | null
        actor_id: string | null
      }>
    const lead = current[0]
    if (!lead) return { status: "error", message: "Job not found.", handoffEventId: null, undoUntil: null }
    if (!lead.completed_at) return { status: "error", message: "Finish the job before recording pickup or delivery.", handoffEventId: null, undoUntil: null }
    if (!lead.handed_off_at) return { status: "error", message: "The handoff did not save. Try again.", handoffEventId: null, undoUntil: null }

    const deadline = lead.occurred_at ? undoDeadline(lead.occurred_at) : null
    const canUndo = Boolean(
      lead.event_id
      && deadline
      && lead.actor_id === String(operator.id)
      && new Date(deadline).getTime() > Date.now(),
    )
    refreshHandoff(leadId)
    return {
      status: "handed-off",
      message: "This handoff was already recorded. The job is out of Active Jobs and remains in customer history.",
      handoffEventId: lead.event_id ? Number(lead.event_id) : null,
      undoUntil: canUndo ? deadline : null,
      actionEventId: lead.event_id ? Number(lead.event_id) : null,
    }
  } catch (error) {
    console.error("Job handoff failed:", error)
    return { status: "error", message: "The handoff was not recorded. Try again.", handoffEventId: null, undoUntil: null }
  }
}

export async function undoJobHandedOff(
  _state: HandoffActionState,
  formData: FormData,
): Promise<HandoffActionState> {
  const operator = await getAuthenticatedOperator()
  if (!operator) return { status: "error", message: "Sign in again before undoing the handoff.", handoffEventId: null, undoUntil: null }
  const leadId = leadIdFrom(formData)
  const handoffEventId = Number(formData.get("handoffEventId"))
  if (!leadId || !Number.isInteger(handoffEventId) || handoffEventId <= 0) {
    return { status: "error", message: "That handoff receipt is not valid.", handoffEventId: null, undoUntil: null }
  }

  const detail = { handoffEventId, operatorName: operator.name, restoredToActiveJobs: true }
  const sql = getSql()
  try {
    const rows = (await sql`
      WITH target AS MATERIALIZED (
        SELECT l.id, l.person_id, receipt.id AS handoff_event_id
        FROM leads l
        JOIN events receipt ON receipt.id = ${handoffEventId}::bigint
          AND receipt.lead_id = l.id
          AND receipt.kind = 'job.handed-off'
        WHERE l.id = ${leadId}::bigint
          AND l.completed_at IS NOT NULL
          AND l.handed_off_at = receipt.occurred_at
          AND receipt.actor_type = 'operator'
          AND receipt.actor_id = ${String(operator.id)}::text
          AND receipt.occurred_at >= now() - interval '10 seconds'
        FOR UPDATE OF l
      ), immutable_receipt AS (
        INSERT INTO events (
          occurred_at, kind, actor_type, actor_id, lead_id, person_id,
          external_id, body, crew_body, detail
        )
        SELECT now(), 'job.handoff-undone'::text, 'operator'::text,
          ${String(operator.id)}::text, t.id, t.person_id,
          ''::text,
          'Customer handoff undone. Job returned to Active Jobs.'::text,
          'Customer handoff undone. Job returned to Active Jobs.'::text,
          ${JSON.stringify(detail)}::jsonb || jsonb_build_object('legacyType', 'handoff_undone'::text)
        FROM target t
        RETURNING id
      ), lead_update AS (
        UPDATE leads l SET handed_off_at = NULL, updated_at = now()
        FROM target t CROSS JOIN immutable_receipt receipt
        WHERE l.id = t.id
        RETURNING l.id
      )
      SELECT receipt.id AS event_id
      FROM immutable_receipt receipt CROSS JOIN lead_update updated`) as Array<{ event_id: number }>

    if (rows[0]) {
      refreshHandoff(leadId)
      return {
        status: "active",
        message: "Handoff undone. The finished job is back in Active Jobs as Ready.",
        handoffEventId: null,
        undoUntil: null,
        actionEventId: Number(rows[0].event_id),
      }
    }

    const current = (await sql`
      SELECT l.completed_at, l.handed_off_at,
        (
          SELECT e.id FROM events e
          WHERE e.lead_id = l.id
            AND e.kind = 'job.handoff-undone'
            AND e.detail->>'handoffEventId' = ${String(handoffEventId)}::text
          ORDER BY e.id DESC LIMIT 1
        ) AS undo_event_id
      FROM leads l
      WHERE l.id = ${leadId}::bigint LIMIT 1`) as Array<{
        completed_at: string | null
        handed_off_at: string | null
        undo_event_id: number | null
      }>
    if (!current[0]) return { status: "error", message: "Job not found.", handoffEventId: null, undoUntil: null }
    if (current[0].completed_at && !current[0].handed_off_at) {
      refreshHandoff(leadId)
      return {
        status: "active",
        message: "This finished job is already back in Active Jobs as Ready.",
        handoffEventId: null,
        undoUntil: null,
        actionEventId: current[0].undo_event_id ? Number(current[0].undo_event_id) : null,
      }
    }
    return {
      status: "error",
      message: "Undo is only available to the operator who recorded this handoff, for 10 seconds.",
      handoffEventId,
      undoUntil: null,
    }
  } catch (error) {
    console.error("Job handoff undo failed:", error)
    return { status: "error", message: "The handoff was not undone. Check the job and try again.", handoffEventId, undoUntil: null }
  }
}
