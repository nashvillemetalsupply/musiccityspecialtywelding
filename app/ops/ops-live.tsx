"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

function editing() {
  const node = document.activeElement
  return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement || (node instanceof HTMLElement && node.isContentEditable)
}

export function OpsLive() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let lastRefresh = Date.now()
    const refresh = () => {
      if (document.visibilityState !== "visible" || editing()) return
      lastRefresh = Date.now()
      router.refresh()
    }
    const timer = window.setInterval(refresh, 30_000)
    const visible = () => { if (document.visibilityState === "visible" && Date.now() - lastRefresh > 15_000) refresh() }
    const serviceWorkerMessage = (event: MessageEvent) => { if (event.data?.type === "ops-refresh") refresh() }
    document.addEventListener("visibilitychange", visible)
    navigator.serviceWorker?.addEventListener("message", serviceWorkerMessage)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", visible)
      navigator.serviceWorker?.removeEventListener("message", serviceWorkerMessage)
    }
  }, [router, pathname])

  return null
}
