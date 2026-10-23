"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { addRoofJob, isRoofJobBusiness, markRoofJobPaid } from "@/lib/roof-jobs"

function businessFrom(formData: FormData) {
  const business = String(formData.get("business") ?? "")
  if (!isRoofJobBusiness(business)) throw new Error("Choose LD2R, Railing or BuilderBox.")
  return business
}

function back(business: string, saved: "added" | "paid") {
  revalidatePath("/board")
  redirect(`/board?business=${encodeURIComponent(business)}&saved=${saved}`)
}

// O1: one row per job for LD2R, Railing and BuilderBox. Grease Patrol has no
// action here; its tab links to the Grease Patrol ops board.
export async function addRoofJobAction(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")
  const business = businessFrom(formData)
  await addRoofJob({
    operator,
    requestId: String(formData.get("requestId") ?? ""),
    isTest: formData.get("isTest") === "on",
    fields: {
      business,
      customerName: formData.get("customerName"),
      phone: formData.get("phone"),
      jobDate: formData.get("jobDate"),
      amount: formData.get("amount"),
      note: formData.get("note"),
    },
  })
  back(business, "added")
}

export async function markRoofJobPaidAction(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")
  const business = businessFrom(formData)
  await markRoofJobPaid({
    operator,
    business,
    id: Number(formData.get("jobId")),
    amount: String(formData.get("amount") ?? ""),
  })
  back(business, "paid")
}
