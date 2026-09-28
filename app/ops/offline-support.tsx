"use client"

import { useEffect, useState } from "react"
import { registerOpsServiceWorker } from "./register-ops-service-worker"
import styles from "./offline-banner.module.css"

export function OpsOfflineSupport({ sessionCacheId }: { sessionCacheId: string | null }) {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const updateOnlineState = () => setOffline(!navigator.onLine)
    updateOnlineState()
    window.addEventListener("online", updateOnlineState)
    window.addEventListener("offline", updateOnlineState)

    let registration: ServiceWorkerRegistration | null = null
    const announceSession = () => {
      const worker = navigator.serviceWorker.controller ?? registration?.active
      worker?.postMessage({ type: "ops-session", sessionId: sessionCacheId })
    }
    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "ops-session-expired") window.location.assign("/ops")
    }
    const register = async () => {
      try {
        registration = await registerOpsServiceWorker()
        if (!registration) return
        await navigator.serviceWorker.ready
        announceSession()
      } catch {
        // The normal online product keeps working if this browser blocks PWA support.
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", announceSession)
      navigator.serviceWorker.addEventListener("message", handleWorkerMessage)
      void register()
    }

    return () => {
      window.removeEventListener("online", updateOnlineState)
      window.removeEventListener("offline", updateOnlineState)
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", announceSession)
        navigator.serviceWorker.removeEventListener("message", handleWorkerMessage)
      }
    }
  }, [sessionCacheId])

  return <div
    className={styles.banner}
    data-ops-session-cache-id={sessionCacheId ?? ""}
    role="status"
    aria-live="polite"
    hidden={!offline}
  >
    Offline. Changes to jobs and Customer Pages cannot be saved until you reconnect.
  </div>
}
