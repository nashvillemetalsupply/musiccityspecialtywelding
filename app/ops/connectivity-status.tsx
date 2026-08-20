"use client"

import { useEffect, useState } from "react"

export function ConnectivityStatus() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const sync = () => setOnline(window.navigator.onLine)
    sync()
    window.addEventListener("online", sync)
    window.addEventListener("offline", sync)
    return () => {
      window.removeEventListener("online", sync)
      window.removeEventListener("offline", sync)
    }
  }, [])

  if (online) return null
  return <p className="ops-offline" role="status">Offline. Reconnect before saving, calling, or sending.</p>
}
