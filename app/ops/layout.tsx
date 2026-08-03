import type { Metadata } from "next"
import type React from "react"

export const metadata: Metadata = {
  title: "Operations",
  robots: { index: false, follow: false },
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <div className="ops-shell">{children}</div>
}
