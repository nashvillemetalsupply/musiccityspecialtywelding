"use client"

import { useRef, useState } from "react"
import { SafeActionButton } from "./safe-action-controls"

export function TrackedCallButton({ leadId, phone, label = "Call", compact = false }: { leadId: number; phone: string; label?: string; compact?: boolean }) {
  const [status, setStatus] = useState("")
  const intentRef = useRef(crypto.randomUUID())
  async function call() {
    setStatus("")
    try {
      const response = await fetch("/api/ops/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, targetPhone: phone, intentKey: intentRef.current }) })
      const data = await response.json().catch(() => null) as { message?: string; error?: string } | null
      setStatus(response.ok ? data?.message || "Calling your phone now." : data?.error || "Tracked call could not start.")
      if (response.ok) { navigator.vibrate?.([30, 20, 30]); intentRef.current = crypto.randomUUID() }
    } catch {
      setStatus("Could not confirm whether the call request reached the shop. Tap once to safely check; the same request will not ring twice.")
    }
  }
  return <span className={`ops-tracked-call${compact ? " is-compact" : ""}`}><SafeActionButton onAction={call} busyLabel="Ringing…">{label}</SafeActionButton>{!compact && <details><summary>Phone app</summary><a href={`tel:${phone.replace(/[^\d+]/g, "")}`} title="Use the phone app without tracking">Untracked fallback</a></details>}{status && <small aria-live="polite">{status}</small>}</span>
}
