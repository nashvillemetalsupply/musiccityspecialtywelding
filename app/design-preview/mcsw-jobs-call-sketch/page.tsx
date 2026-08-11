import type { Metadata } from "next"
import { Chivo } from "next/font/google"
import { CallSketchPrototype } from "@/components/call-sketch/call-sketch-prototype"

const chivo = Chivo({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-mcsw-jobs",
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  title: "Call Sketch Prototype | MCSW Jobs",
  description: "Interactive prototype for turning a live shop call into a traceable rough gate sketch.",
  robots: { index: false, follow: false },
}

export default function MCSWJobsCallSketchPage() {
  return <div className={chivo.variable}>
    <CallSketchPrototype compareHierarchy />
  </div>
}
