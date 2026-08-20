import type { ReactNode } from "react"
import type { Metadata, Viewport } from "next"
import { Chivo } from "next/font/google"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { ConnectivityStatus } from "./connectivity-status"
import { OpsLive } from "./ops-live"
import { OpsCompactHeader } from "./ops-header"
import "../../styles/control.css"
import "./ops-shell.css"

const chivo = Chivo({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-mcsw-jobs",
  display: "swap",
})

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
  return <div className={`${chivo.variable} ops-shell`}>
    <div className="ops-frame">
      {operator && <OpsCompactHeader name={operator.name || operator.email} role={operator.role} voiceReady={voiceReady} />}
      {operator && <ConnectivityStatus />}
      {children}
    </div>
    {operator && <OpsLive />}
  </div>
}
