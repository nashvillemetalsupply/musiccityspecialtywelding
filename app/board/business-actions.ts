"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { recordBusinessEntry } from "@/lib/business-entries"
import { S81_BUSINESS_KEYS, type OperatorCommandVerb } from "@/lib/sms-operator-commands"

export async function recordBusinessEntryAction(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")

  const business = String(formData.get("business") ?? "")
  if (!S81_BUSINESS_KEYS.includes(business)) throw new Error("Choose a business from the S81 list.")
  const verb = String(formData.get("verb") ?? "")
  if (verb !== "booked" && verb !== "paid") throw new Error("Choose booked or paid.")
  const requestId = String(formData.get("requestId") ?? "")
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error("Refresh the business page and try again.")
  const value = String(formData.get("value") ?? "")
  await recordBusinessEntry({
    operator,
    business,
    verb: verb as Extract<OperatorCommandVerb, "booked" | "paid">,
    value,
    externalId: `crm-${requestId}`,
  })
  revalidatePath("/board")
  redirect(`/board?business=${encodeURIComponent(business)}&saved=1`)
}
