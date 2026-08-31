"use server"

import { randomUUID } from "node:crypto"
import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { getSql } from "@/lib/db"
import { processEvent } from "@/lib/extract"
import { dismissInboundCallDraft, restoreInboundCallDraft, saveInboundCallAsJob, undoSavedJobIntake } from "@/lib/job-intake"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { createManualLeadRecord } from "../actions"

const CALL_NEED_FALLBACK = "Phone call saved. Details are in Calls & Messages."

function readPublicId(value: FormDataEntryValue | null) {
  const publicId = String(value ?? "").trim().slice(0, 80)
  if (!/^[a-zA-Z0-9-]{12,80}$/.test(publicId)) throw new Error("That call link is invalid.")
  return publicId
}

export async function saveCallDraftRecord(
  formData: FormData,
  options: { deferExtraction?: boolean } = {},
) {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Sign in to save this job.")
  const publicId = readPublicId(formData.get("draftId"))
  const name = String(formData.get("firstName") ?? "").trim().slice(0, 120)
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40)
  const need = String(formData.get("message") ?? "").trim().slice(0, 2000)
  if (!name) throw new Error("Add the caller or company name.")
  const result = await saveInboundCallAsJob({
    publicId,
    operatorId: operator.id,
    name,
    phone,
    need,
    service: String(formData.get("service") ?? "").trim().slice(0, 120),
    referral: String(formData.get("referral") ?? "").trim().slice(0, 160),
    deferExtraction: options.deferExtraction,
  })

  const sql = getSql()
  const pending = (await sql`
    SELECT id FROM events
    WHERE lead_id = ${result.leadId}::bigint AND processed_at IS NULL
      AND kind = ANY(ARRAY['form.quote','call.transcript']::text[])
    ORDER BY recorded_at ASC LIMIT 4`) as { id: number }[]
  if (pending.length && !options.deferExtraction) after(async () => {
    for (const event of pending) {
      await processEvent(Number(event.id)).catch((error) => console.error("Saved call extraction failed:", error))
    }
  })
  revalidatePath("/ops")
  // Keep the inline receipt and its Undo control mounted. This route is
  // force-dynamic, so an explicit reload/navigation still reads fresh truth.
  return { leadId: result.leadId, name, phone, need: need || CALL_NEED_FALLBACK, draftId: publicId }
}

export async function saveCallDraftAction(formData: FormData) {
  const result = await saveCallDraftRecord(formData)
  redirect(`/ops/leads/${result.leadId}`)
}

export type InlineJobSaveState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "saved"; leadId: number; name: string; phone: string; need: string; source: "call" | "manual"; intakeRef: string; receiptKey: string }

export async function saveInlineJobAction(
  _previous: InlineJobSaveState,
  formData: FormData,
): Promise<InlineJobSaveState> {
  try {
    if (String(formData.get("draftId") ?? "").trim()) {
      const result = await saveCallDraftRecord(formData, { deferExtraction: true })
      return {
        status: "saved",
        leadId: result.leadId,
        name: result.name,
        phone: result.phone,
        need: result.need,
        source: "call",
        intakeRef: result.draftId,
        receiptKey: randomUUID(),
      }
    }
    const intakeKey = String(formData.get("intakeKey") ?? "").trim()
    if (!/^[a-zA-Z0-9_-]{12,80}$/.test(intakeKey)) {
      throw new Error("Reload MCSW Jobs before saving this intake.")
    }
    const result = await createManualLeadRecord(formData, { deferExtraction: true })
    return {
      status: "saved",
      leadId: result.leadId,
      name: result.name,
      phone: result.phone,
      need: result.need,
      source: "manual",
      intakeRef: result.intakeKey,
      receiptKey: randomUUID(),
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The job could not be saved." }
  }
}

export async function undoInlineJobAction(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Sign in to undo this job.")
  const leadId = Number(formData.get("leadId"))
  if (!Number.isSafeInteger(leadId) || leadId <= 0) throw new Error("That job link is invalid.")
  const source = String(formData.get("source") ?? "")
  const intakeRef = String(formData.get("intakeRef") ?? "").trim().slice(0, 80)
  if (source !== "call" && source !== "manual") throw new Error("That intake source is invalid.")
  const result = await undoSavedJobIntake({
    leadId,
    operatorId: operator.id,
    operatorRole: operator.role,
    source,
    intakeRef,
  })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
  if (source === "call") revalidatePath(`/ops/intake/${intakeRef}`)
  if (!result.undone) throw new Error("This job has already moved forward and can no longer be undone here.")
  return { status: "undone" } as const
}

export async function dismissCallDraftAction(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Sign in to update this call.")
  if (operator.role !== "owner") throw new Error("Only the owner can mark a call as not a job.")
  const publicId = readPublicId(formData.get("draftId"))
  await dismissInboundCallDraft({ publicId, operatorId: operator.id })
  revalidatePath("/ops")
  revalidatePath(`/ops/intake/${publicId}`)
  redirect("/ops")
}

export async function changeCallDraftDispositionAction(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Sign in to update this call.")
  if (operator.role !== "owner") throw new Error("Only the owner can mark a call as not a job.")
  const publicId = readPublicId(formData.get("draftId"))
  const intent = String(formData.get("intent") ?? "")
  if (intent === "dismiss") {
    const result = await dismissInboundCallDraft({ publicId, operatorId: operator.id })
    revalidatePath("/ops")
    return { status: result.dismissed ? "dismissed" : "unchanged" } as const
  }
  if (intent === "restore") {
    const result = await restoreInboundCallDraft({ publicId, operatorId: operator.id })
    revalidatePath("/ops")
    return { status: result.restored ? "ready" : "unchanged" } as const
  }
  throw new Error("That call update is invalid.")
}
