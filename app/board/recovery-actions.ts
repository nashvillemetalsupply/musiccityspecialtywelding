"use server"

import { revalidatePath } from "next/cache"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { runRecoverySweep } from "@/lib/recovery-sweep"

export type RecoveryActionState = {
  status: "idle" | "ran" | "skipped" | "error"
  message: string
}

export async function runRecoveryNowAction(
  _state: RecoveryActionState,
  _formData: FormData,
): Promise<RecoveryActionState> {
  void _state
  void _formData
  const operator = await getAuthenticatedOperator()
  if (!operator) return { status: "error", message: "Sign in again before running recovery." }
  if (operator.role !== "owner") return { status: "error", message: "Only the owner can run recovery." }

  const result = await runRecoverySweep({ trigger: "owner-manual", force: true })
  if (!result.ok) {
    console.error("Manual owner recovery failed:", result.error)
    return { status: "error", message: "Recovery did not finish. Check system health and try again." }
  }
  if (result.skipped) return { status: "skipped", message: "Recovery is already running." }

  revalidatePath("/board")
  const due = Number(result.detail?.due ?? 0)
  return {
    status: "ran",
    message: `Recovery finished. ${due} follow-up${due === 1 ? "" : "s"} due; retry queues checked.`,
  }
}
