"use client"

import { useEffect } from "react"

export function GlassViewBeacon({ token }: { token: string }) {
  useEffect(() => {
    let timer: number | undefined
    let sent = false

    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    }
    const send = () => {
      timer = undefined
      if (sent || document.visibilityState !== "visible") return
      sent = true
      void fetch("/api/glass/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
      })
    }
    const schedule = () => {
      clear()
      if (!sent && document.visibilityState === "visible") timer = window.setTimeout(send, 3000)
    }

    schedule()
    document.addEventListener("visibilitychange", schedule)
    return () => {
      clear()
      document.removeEventListener("visibilitychange", schedule)
    }
  }, [token])

  return null
}
