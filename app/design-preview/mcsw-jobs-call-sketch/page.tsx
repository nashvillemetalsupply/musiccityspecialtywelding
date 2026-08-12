import type { Metadata } from "next"
import type { CSSProperties } from "react"
import { CallSketchPrototype } from "@/components/call-sketch/call-sketch-prototype"

export const metadata: Metadata = {
  title: "Call Sketch Prototype | MCSW Jobs",
  description: "Interactive prototype for turning a live shop call into a traceable rough gate sketch.",
  robots: { index: false, follow: false },
}

export default function MCSWJobsCallSketchPage() {
  const previewFont = {
    "--font-mcsw-jobs": "var(--font-ms-sans)",
  } as CSSProperties

  return <div style={previewFont}>
    <CallSketchPrototype compareHierarchy />
  </div>
}
