"use client"

import { useEffect, useState } from "react"
import { registerOpsServiceWorker } from "./register-ops-service-worker"

function base64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(normalized)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<
    "unsupported" | "checking" | "off" | "on" | "enabling" | "disabling" | "denied"
  >("checking")
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    let cancelled = false
    const detect = async () => {
      await Promise.resolve()
      if (cancelled) return
      setErrorMessage("")
      if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported")
        return
      }
      if (Notification.permission === "denied") {
        setState("denied")
        return
      }
      try {
        const registration = await registerOpsServiceWorker()
        if (!registration) throw new Error("service worker unavailable")
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          // Existing browsers predate per-person identity. Re-posting is
          // idempotent and binds the endpoint to whoever punched in today.
          const rebound = await fetch("/api/ops/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(subscription.toJSON()),
          })
          if (!rebound.ok) throw new Error("push rebind failed")
        }
        if (!cancelled) setState(subscription ? "on" : "off")
      } catch {
        if (!cancelled) {
          setState("off")
          setErrorMessage("Alerts could not be checked. Check your connection and try again.")
        }
      }
    }
    void detect()
    return () => {
      cancelled = true
    }
  }, [vapidPublicKey])

  const enable = async () => {
    setErrorMessage("")
    setState("enabling")
    try {
      const registration = await registerOpsServiceWorker()
      if (!registration) throw new Error("service worker unavailable")
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
      const denied = Notification.permission === "denied"
      setState(denied ? "denied" : "off")
      if (!denied) setErrorMessage("Alerts could not be enabled. Check your connection and try again.")
    }
  }

  const disable = async () => {
    setErrorMessage("")
    setState("disabling")
    try {
      const registration = await registerOpsServiceWorker()
      if (!registration) throw new Error("service worker unavailable")
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const response = await fetch("/api/ops/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        if (!response.ok) throw new Error("push removal failed")
        await subscription.unsubscribe()
      }
      setState("off")
    } catch {
      setState("on")
      setErrorMessage("Alerts could not be turned off. Check your connection and try again.")
    }
  }

  if (state === "unsupported") return null
  if (state === "denied") {
    return <span className="ops-followup-current">notifications blocked in browser settings</span>
  }
  return <>
    <button
      type="button"
      className="ops-ghost"
      aria-pressed={state === "on" || state === "disabling"}
      disabled={state === "checking" || state === "enabling" || state === "disabling"}
      onClick={state === "on" ? disable : enable}
    >
      {state === "on"
        ? "Alerts on"
        : state === "enabling"
          ? "Turning alerts on"
          : state === "disabling"
            ? "Turning alerts off"
            : "Alerts"}
    </button>
    {errorMessage && <span className="ops-followup-current" role="alert">{errorMessage}</span>}
  </>
}
