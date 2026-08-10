"use server"

import { revalidatePath } from "next/cache"
import { addClaim, supersedeClaimWithExisting } from "@/lib/claims"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { shopClaimLabel } from "@/lib/shop-language"
import { claimVisibleToRole, redactCrewText } from "@/lib/visibility"

async function read(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator || operator.role !== "owner") throw new Error("Owner access required.")
  const leadId = Number(formData.get("leadId")); const claimId = Number(formData.get("claimId"))
  if (!Number.isInteger(leadId) || !Number.isInteger(claimId)) throw new Error("Quote slip not found.")
  return { operator, leadId, claimId }
}

export async function acceptQuoteCapture(formData: FormData) {
  const { operator, leadId, claimId } = await read(formData)
  const sql = getSql()
  const claims = (await sql`SELECT value FROM claims WHERE id = ${claimId}::bigint AND subject_type = 'lead' AND subject_id = ${leadId}::bigint AND predicate = 'quoted_price_cents' AND superseded_by IS NULL LIMIT 1`) as { value: unknown }[]
  const raw = claims[0]?.value as number | { cents?: number } | undefined
  const cents = typeof raw === "number" ? raw : Number(raw?.cents)
  if (!Number.isInteger(cents) || cents < 0) throw new Error("The captured quote is invalid.")
  const eventId = await recordEvent({ kind: "quote.confirmed", actorType: "operator", actorId: operator.id, leadId, body: `Quote confirmed at $${(cents / 100).toLocaleString("en-US")}`, detail: { claimId, cents } })
  await sql`UPDATE leads SET estimate_value_cents = ${cents}::bigint, quoted_at = COALESCE(quoted_at, now()), status = CASE WHEN status IN ('new','contacted','qualified') THEN 'quoted' ELSE status END, updated_at = now() WHERE id = ${leadId}::bigint`
  if (eventId) { const replacement = await addClaim({ subjectType: "lead", subjectId: leadId, predicate: "quoted_price_cents", value: cents, confidence: 1, sourceEventId: eventId, extractedBy: "operator-confirmed" }); await supersedeClaimWithExisting(claimId, replacement) }
  revalidatePath(`/ops/leads/${leadId}`); revalidatePath("/ops")
}

export async function rejectQuoteCapture(formData: FormData) {
  const { operator, leadId, claimId } = await read(formData)
  const sql = getSql()
  const current = (await sql`
    SELECT id FROM claims
    WHERE id = ${claimId}::bigint AND subject_type = 'lead' AND subject_id = ${leadId}::bigint
      AND predicate = 'quoted_price_cents' AND superseded_by IS NULL
    LIMIT 1`) as { id: number }[]
  if (!current[0]) throw new Error("That quote receipt is no longer active on this work order.")
  const eventId = await recordEvent({ kind: "quote.capture-rejected", actorType: "operator", actorId: operator.id, leadId, body: "Captured quote was not a real quote", detail: { claimId } })
  if (eventId) { const replacement = await addClaim({ subjectType: "lead", subjectId: leadId, predicate: "quote_capture_rejected", value: { claimId }, confidence: 1, sourceEventId: eventId, extractedBy: "operator-confirmed" }); await supersedeClaimWithExisting(claimId, replacement) }
  revalidatePath(`/ops/leads/${leadId}`); revalidatePath("/ops")
}

export async function correctClaim(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Sign in required.")
  const leadId = Number(formData.get("leadId")); const claimId = Number(formData.get("claimId"))
  const value = String(formData.get("value") ?? "").trim().slice(0, 500)
  if (!Number.isInteger(leadId) || !Number.isInteger(claimId) || !value) throw new Error("Corrected fact is required.")
  const sql = getSql()
  const current = (await sql`SELECT predicate FROM claims WHERE id = ${claimId}::bigint AND subject_type = 'lead' AND subject_id = ${leadId}::bigint AND superseded_by IS NULL LIMIT 1`) as { predicate: string }[]
  if (!current[0] || !claimVisibleToRole(current[0].predicate, operator.role)) throw new Error("That fact is not available in your role.")
  const correctionBody = `${shopClaimLabel(current[0].predicate)}: ${value}`
  const eventId = await recordEvent({ kind: "claim.corrected", actorType: "operator", actorId: operator.id, leadId, body: correctionBody, crewBody: redactCrewText(correctionBody), detail: { claimId, predicate: current[0].predicate } })
  if (!eventId) throw new Error("The correction could not be filed.")
  const replacement = await addClaim({ subjectType: "lead", subjectId: leadId, predicate: current[0].predicate, value, confidence: 1, sourceEventId: eventId, extractedBy: `operator:${operator.id}`, itemKey: `correction:${claimId}` })
  await supersedeClaimWithExisting(claimId, replacement)
  revalidatePath(`/ops/leads/${leadId}`); revalidatePath("/ops")
}
