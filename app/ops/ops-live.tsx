"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { startOpsPulsePolling } from "@/lib/ops-pulse-polling.ts"

function editing() {
  const node = document.activeElement
  return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement || (node instanceof HTMLElement && node.isContentEditable)
}

export function OpsLive() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let refreshPending = false
    const refresh = () => {
      if (editing()) {
        refreshPending = true
        return
      }
      refreshPending = false
      router.refresh()
    }
    const polling = startOpsPulsePolling({ onChange: refresh })
    const finishEditing = () => {
      window.setTimeout(() => {
        if (refreshPending && !editing()) refresh()
      }, 0)
    }
    const serviceWorkerMessage = (event: MessageEvent) => { if (event.data?.type === "ops-refresh") polling.checkNow() }
    document.addEventListener("focusout", finishEditing)
    navigator.serviceWorker?.addEventListener("message", serviceWorkerMessage)
    return () => {
      polling.stop()
      document.removeEventListener("focusout", finishEditing)
      navigator.serviceWorker?.removeEventListener("message", serviceWorkerMessage)
    }
  }, [router, pathname])

  return null
}
