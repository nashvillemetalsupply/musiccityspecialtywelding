"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { addRoofJob, isRoofJobBusiness, markRoofJobPaid } from "@/lib/roof-jobs"
import { closeRoofLeadsForPhone, markRoofLeadContacted } from "@/lib/roof-leads"

function businessFrom(formData: FormData) {
  const business = String(formData.get("business") ?? "")
  if (!isRoofJobBusiness(business)) throw new Error("Choose LD2R, Railing or BuilderBox.")
  return business
}

function back(business: string, saved: "added" | "paid" | "contacted") {
  revalidatePath("/board")
  redirect(`/board?business=${encodeURIComponent(business)}&saved=${saved}`)
}

// O1: one row per job for LD2R, Railing and BuilderBox. Grease Patrol has no
// action here; its tab links to the Grease Patrol ops board.
export async function addRoofJobAction(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")
  const business = businessFrom(formData)
  const isTest = formData.get("isTest") === "on" && operator.role === "owner"
  const job = await addRoofJob({
    operator,
    requestId: String(formData.get("requestId") ?? ""),
    isTest,
    fields: {
      business,
      customerName: formData.get("customerName"),
      phone: formData.get("phone"),
      jobDate: formData.get("jobDate"),
      amount: formData.get("amount"),
      note: formData.get("note"),
    },
  })
  // A booked job converts the site lead with the same phone (lead badges, 10-24).
  if (!isTest) await closeRoofLeadsForPhone({ business, phone: job.phone, operator })
  back(business, "added")
}

// Lead badges: "Contacted" takes one site lead out of its tab's count.
export async function markRoofLeadContactedAction(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")
  const business = String(formData.get("business") ?? "")
  await markRoofLeadContacted({ operator, business, id: Number(formData.get("leadId")) })
  back(business, "contacted")
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
