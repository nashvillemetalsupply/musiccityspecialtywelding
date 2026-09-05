import "../../styles/ops-legacy.css"
import type { ReactNode } from "react"
import type { Metadata, Viewport } from "next"
import { chivo, golos } from "@/app/fonts"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { ConnectivityStatus } from "./connectivity-status"
import { SkipLink } from "../board/skip-link"
import { OpsLive } from "./ops-live"
import { OpsCompactHeader } from "./ops-header"
import "../../styles/control.css"
import "./ops-shell.css"

export const metadata: Metadata = {
  title: "MCSW Jobs",
  description: "Music City Specialty Welding jobs.",
  applicationName: "MCSW Jobs",
  manifest: "/ops/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "MCSW Jobs", statusBarStyle: "black-translucent" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#100f0d",
}

export const dynamic = "force-dynamic"
export default async function OpsLayout({ children }: { children: ReactNode }) {
  const operator = await getAuthenticatedOperator()
  const voiceReady = voiceTranscriptionConfigured()
  return <div className={`${golos.variable} ${chivo.variable} ops-shell`}>
    <div className="ops-frame">
      {!operator && <SkipLink />}
      {operator && <OpsCompactHeader name={operator.name || operator.email} role={operator.role} voiceReady={voiceReady} />}
      {operator && <ConnectivityStatus />}
      <main id="main" tabIndex={-1}>{children}</main>
    </div>
    {operator && <OpsLive />}
  </div>
}
