"use client"

import { useEffect, useState } from "react"
import { registerOpsServiceWorker } from "../register-ops-service-worker"

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function InstallAppButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [status, setStatus] = useState("")
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)")
    const syncInstalled = () => setInstalled(standalone.matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
    const capture = (event: Event) => { event.preventDefault(); setPromptEvent(event as InstallPromptEvent) }
    const complete = () => { setInstalled(true); setPromptEvent(null); setStatus("MCSW Jobs is installed.") }
    syncInstalled()
    void registerOpsServiceWorker().catch(() => undefined)
    window.addEventListener("beforeinstallprompt", capture)
    window.addEventListener("appinstalled", complete)
    standalone.addEventListener("change", syncInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", capture)
      window.removeEventListener("appinstalled", complete)
      standalone.removeEventListener("change", syncInstalled)
    }
  }, [])
  async function install() {
    if (installed) { setStatus("MCSW Jobs is already installed."); return }
    if (!promptEvent) { setStatus("Use the Chrome menu steps below."); return }
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    setStatus(choice.outcome === "accepted" ? "MCSW Jobs is installing." : "Install canceled.")
    setPromptEvent(null)
  }
  return <div className="install-action">
    <button className="btn btn--go" type="button" disabled={installed} onClick={() => void install()}>{installed ? "MCSW Jobs installed" : "Install MCSW Jobs"}</button>
    {status && <p className="t-caption" role="status">{status}</p>}
  </div>
}
