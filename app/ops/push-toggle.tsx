"use client"

import { useEffect, useState } from "react"

function base64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(normalized)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<
    "unsupported" | "checking" | "off" | "on" | "working" | "denied"
  >("checking")

  useEffect(() => {
    let cancelled = false
    const detect = async () => {
      await Promise.resolve()
      if (cancelled) return
      if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported")
        return
      }
      if (Notification.permission === "denied") {
        setState("denied")
        return
      }
      try {
        const registration = await navigator.serviceWorker.register("/ops-sw.js")
        const subscription = await registration.pushManager.getSubscription()
        if (!cancelled) setState(subscription ? "on" : "off")
      } catch {
        if (!cancelled) setState("unsupported")
      }
    }
    void detect()
    return () => {
      cancelled = true
    }
  }, [vapidPublicKey])

  const enable = async () => {
    setState("working")
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(vapidPublicKey),
      })
      const response = await fetch("/api/ops/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      })
      if (!response.ok) throw new Error("subscribe failed")
      setState("on")
    } catch {
      setState(Notification.permission === "denied" ? "denied" : "off")
    }
  }

  const disable = async () => {
    setState("working")
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await fetch("/api/ops/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
      setState("off")
    } catch {
      setState("on")
    }
  }

  if (state === "unsupported") return null
  if (state === "denied") {
    return <span className="ops-followup-current">notifications blocked in browser settings</span>
  }
  return (
    <button
      type="button"
      className="ops-ghost"
      disabled={state === "checking" || state === "working"}
      onClick={state === "on" ? disable : enable}
    >
      {state === "on" ? "Phone alerts: on" : "Enable phone alerts"}
    </button>
  )
}
