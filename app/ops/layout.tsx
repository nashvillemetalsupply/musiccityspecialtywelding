import type { ReactNode } from "react"
import type { Metadata } from "next"
import { Chivo } from "next/font/google"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { ConnectivityStatus } from "./connectivity-status"
import { OpsLive } from "./ops-live"
import { OpsCompactHeader } from "./ops-header"
import "./jobs.css"
import "./jobs-brand.css"

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

export const dynamic = "force-dynamic"
export default async function OpsLayout({ children }: { children: ReactNode }) {
  const operator = await getAuthenticatedOperator()
  const voiceReady = voiceTranscriptionConfigured()
  return <div className={`${chivo.variable} jobs-root`} data-jobs-theme="brand">
    <div className="jobs-product-frame">
      {operator && <OpsCompactHeader name={operator.name || operator.email} role={operator.role} voiceReady={voiceReady} />}
      {operator && <ConnectivityStatus />}
      {children}
    </div>
    {operator && <OpsLive />}
  </div>
}
