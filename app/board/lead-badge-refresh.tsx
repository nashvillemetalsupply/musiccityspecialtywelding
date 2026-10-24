"use client"

// Business tabs have no ops pulse, so the lead badges re-read every 5 minutes
// while the page is visible. The main board already refreshes on its pulse.
import { useRouter } from "next/navigation"
import { useEffect } from "react"

export function LeadBadgeRefresh() {
  const router = useRouter()
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh()
    }, 5 * 60_000)
    return () => window.clearInterval(timer)
  }, [router])
  return null
}
