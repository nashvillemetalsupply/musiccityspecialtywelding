"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { runRecoverySweep } from "@/lib/recovery-sweep"
import { wakeGmailIngest } from "@/lib/gmail-wake"
import { requestOriginFromHeaders } from "@/lib/gmail-wake-policy.mjs"

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
  const gmailWakeOrigin = requestOriginFromHeaders(await headers())

  const [result, gmailResult] = await Promise.all([
    runRecoverySweep({ trigger: "owner-manual", force: true }),
    wakeGmailIngest(gmailWakeOrigin),
  ])
  if (!gmailResult.ok) {
    console.error("Manual Gmail wake failed:", gmailResult.reason)
    const message = gmailResult.reason === "request-failed"
      ? "Gmail sync was not confirmed. It may still be running; check system health before retrying."
      : gmailResult.reason === "ingest-failed"
        ? "Gmail sync reported a failure. Shop recovery may still have finished; check system health and try again."
        : gmailResult.reason === "outside-production"
          ? "Gmail sync did not run because this is not the production site."
          : "Gmail sync is not configured. Shop recovery may still have finished; check system health."
    return { status: "error", message }
  }
  if (!result.ok) {
    console.error("Manual owner recovery failed:", result.error)
    return { status: "error", message: "Recovery did not finish. Check system health and try again." }
  }
  if (result.skipped) return {
    status: "skipped",
    message: gmailResult.skipped ? "Recovery and Gmail sync are already running." : "Recovery is already running; Gmail sync finished.",
  }

  revalidatePath("/board")
  const due = Number(result.detail?.due ?? 0)
  return {
    status: "ran",
    message: `Recovery finished. ${due} follow-up${due === 1 ? "" : "s"} due; retry queues checked; Gmail ${gmailResult.skipped ? "was already syncing" : "synced"}.`,
  }
}
