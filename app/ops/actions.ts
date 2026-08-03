"use server"

import { revalidatePath } from "next/cache"
import { getSql } from "@/lib/db"
import { LEAD_STATUSES, recordLeadEvent, type LeadStatus } from "@/lib/leads"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

async function requireOperator(): Promise<string> {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Not signed in.")
  return operator
}

function parseLeadId(value: FormDataEntryValue | null): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid lead id.")
  return id
}

function parseDollarsToCents(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").replace(/[$,\s]/g, "")
  if (!raw) return null
  const dollars = Number(raw)
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 10_000_000) {
    throw new Error("Invalid dollar amount.")
  }
  return Math.round(dollars * 100)
}

export async function updateLeadStatus(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const status = String(formData.get("status") ?? "") as LeadStatus
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500)

  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Invalid status.")
  }
  if ((status === "lost" || status === "spam") && !reason) {
    throw new Error("A reason is required to mark a lead lost or spam.")
  }

  const sql = getSql()
  await sql`
    UPDATE leads SET
      status = ${status},
      status_reason = ${reason},
      first_response_at = CASE
        WHEN ${status}::text IN ('contacted', 'qualified', 'quoted', 'won')
          AND first_response_at IS NULL THEN now()
        ELSE first_response_at END,
      first_response_channel = CASE
        WHEN ${status}::text IN ('contacted', 'qualified', 'quoted', 'won')
          AND first_response_at IS NULL AND first_response_channel = ''
          THEN 'ops-dashboard'
        ELSE first_response_channel END,
      quoted_at = CASE WHEN ${status}::text = 'quoted' AND quoted_at IS NULL THEN now() ELSE quoted_at END,
      won_at = CASE WHEN ${status}::text = 'won' AND won_at IS NULL THEN now() ELSE won_at END,
      lost_at = CASE WHEN ${status}::text = 'lost' AND lost_at IS NULL THEN now() ELSE lost_at END,
      updated_at = now()
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "status_changed", operator, { status, reason: reason || null })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function markFirstResponse(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const channel = String(formData.get("channel") ?? "phone").trim().slice(0, 40) || "phone"

  const sql = getSql()
  await sql`
    UPDATE leads SET
      first_response_at = COALESCE(first_response_at, now()),
      first_response_channel = CASE
        WHEN first_response_channel = '' THEN ${channel}
        ELSE first_response_channel END,
      status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
      updated_at = now()
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "first_response", operator, { channel })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function saveEstimate(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const cents = parseDollarsToCents(formData.get("estimate"))

  const sql = getSql()
  await sql`
    UPDATE leads SET
      estimate_value_cents = ${cents}::bigint,
      quoted_at = CASE WHEN ${cents}::bigint IS NOT NULL AND quoted_at IS NULL THEN now() ELSE quoted_at END,
      status = CASE WHEN ${cents}::bigint IS NOT NULL AND status IN ('new', 'contacted', 'qualified')
        THEN 'quoted' ELSE status END,
      updated_at = now()
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "estimate_saved", operator, { cents })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function saveOutcome(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const revenueCents = parseDollarsToCents(formData.get("revenue"))
  const completed = String(formData.get("completed") ?? "") === "on"

  const sql = getSql()
  await sql`
    UPDATE leads SET
      revenue_cents = ${revenueCents}::bigint,
      status = CASE WHEN ${revenueCents}::bigint IS NOT NULL THEN 'won' ELSE status END,
      won_at = CASE WHEN ${revenueCents}::bigint IS NOT NULL AND won_at IS NULL THEN now() ELSE won_at END,
      completed_at = CASE WHEN ${completed}::boolean AND completed_at IS NULL THEN now() ELSE completed_at END,
      updated_at = now()
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "outcome_saved", operator, { revenueCents, completed })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function saveNotes(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 8000)

  const sql = getSql()
  await sql`UPDATE leads SET notes = ${notes}, updated_at = now() WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "notes_saved", operator, null)
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function markReviewRequested(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const received = String(formData.get("received") ?? "") === "on"

  const sql = getSql()
  await sql`
    UPDATE leads SET
      review_requested_at = COALESCE(review_requested_at, now()),
      review_received = ${received}::boolean,
      updated_at = now()
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "review_tracked", operator, { received })
  revalidatePath(`/ops/leads/${leadId}`)
}

// Deletes are limited to internal test records so real customer history stays immutable.
export async function deleteTestLead(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))

  const sql = getSql()
  const rows = (await sql`
    DELETE FROM leads WHERE id = ${leadId} AND is_test = true RETURNING id`) as { id: number }[]
  if (!rows.length) throw new Error("Only internal test leads can be deleted.")
  console.log(`Test lead ${leadId} deleted by ${operator}`)
  revalidatePath("/ops")
}
