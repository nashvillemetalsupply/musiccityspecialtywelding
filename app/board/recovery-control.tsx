"use client"

import { useActionState } from "react"
import { SafeSubmitButton } from "@/app/ops/safe-action-controls"
import { runRecoveryNowAction, type RecoveryActionState } from "./recovery-actions"

const INITIAL_RECOVERY: RecoveryActionState = { status: "idle", message: "" }

export function RecoveryControl() {
  const [state, action] = useActionState(runRecoveryNowAction, INITIAL_RECOVERY)
  return <div className="ops-recovery-control">
    <form action={action}>
      <SafeSubmitButton pendingLabel="Running recovery…">Run recovery now</SafeSubmitButton>
    </form>
    {state.message && <small role={state.status === "error" ? "alert" : "status"}>{state.message}</small>}
  </div>
}
