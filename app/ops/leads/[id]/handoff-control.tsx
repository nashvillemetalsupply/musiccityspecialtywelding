"use client"

import { useActionState, useEffect, useState } from "react"
import { handoffDisplayState } from "@/lib/shop-brain-invariants.mjs"
import { SafeSubmitButton } from "../../safe-action-controls"
import {
  markJobHandedOff,
  undoJobHandedOff,
  type HandoffActionState,
} from "./handoff-actions"

const initialState: HandoffActionState = {
  status: "idle",
  message: "",
  handoffEventId: null,
  undoUntil: null,
}

export function HandoffControl({
  leadId,
  completed,
  handedOff,
  initialHandoffEventId,
  initialUndoUntil,
}: {
  leadId: number
  completed: boolean
  handedOff: boolean
  initialHandoffEventId: number | null
  initialUndoUntil: string | null
}) {
  const [handoffState, handoffAction, handoffPending] = useActionState(markJobHandedOff, initialState)
  const [undoState, undoAction, undoPending] = useActionState(undoJobHandedOff, initialState)
  const [expiredHandoffEventId, setExpiredHandoffEventId] = useState<number | null>(null)
  const isHandedOff = handoffDisplayState({
    persistedHandedOff: handedOff,
    handoffStatus: handoffState.status,
    handoffActionEventId: handoffState.actionEventId,
    undoStatus: undoState.status,
    undoActionEventId: undoState.actionEventId,
  })
  const handoffEventId = handoffState.handoffEventId ?? initialHandoffEventId
  const undoUntil = handoffState.undoUntil ?? initialUndoUntil

  useEffect(() => {
    if (!undoUntil) return
    const timer = window.setTimeout(
      () => setExpiredHandoffEventId(handoffEventId),
      Math.max(0, new Date(undoUntil).getTime() - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [handoffEventId, undoUntil])

  if (!completed) return null
  const canUndo = Boolean(isHandedOff && handoffEventId && undoUntil && expiredHandoffEventId !== handoffEventId)
  const message = isHandedOff && handoffState.status === "handed-off"
    ? handoffState.message
    : !isHandedOff && undoState.status === "active"
      ? undoState.message
      : ""
  const error = undoState.status === "error" ? undoState.message : handoffState.status === "error" ? handoffState.message : ""

  return <section className={`ops-handoff-control${isHandedOff ? " is-handed-off" : ""}`} id="job-close" aria-labelledby="job-handoff-title">
    <div className="ops-handoff-copy">
      <span>Pickup or delivery</span>
      <h2 id="job-handoff-title">{isHandedOff ? "Job closed" : "Close job"}</h2>
      <p>{isHandedOff
        ? "This job is out of Active Jobs. Its work order and customer history stay available."
        : "Use after pickup or delivery. Closing removes this Ready job from Active Jobs; its work order and customer history stay."}</p>
    </div>

    {!isHandedOff && <form action={handoffAction}>
      <input type="hidden" name="leadId" value={leadId} />
      <SafeSubmitButton disabled={handoffPending} pendingLabel="Closing job…">
        Close job
      </SafeSubmitButton>
    </form>}

    {isHandedOff && <div className="ops-handoff-receipt" aria-live="polite">
      <strong>Job closed</strong>
      <span>Removed from Active Jobs. Work order and customer history kept.</span>
    </div>}

    {canUndo && <form action={undoAction}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="handoffEventId" value={handoffEventId ?? ""} />
      <SafeSubmitButton className="ops-handoff-undo" disabled={undoPending} pendingLabel="Reopening job…">
        Reopen job (10 sec)
      </SafeSubmitButton>
    </form>}

    {message && !error && <p className="ops-handoff-state" aria-live="polite">{message}</p>}
    {error && <p className="ops-alert" role="alert">{error}</p>}
  </section>
}
