import type { Metadata } from "next"
import { Chivo } from "next/font/google"
import { HybridDirectionsClient } from "./hybrid-client"
import "./hybrid.css"

const chivo = Chivo({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-hybrid-signal",
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  title: "MCSW Jobs Signal Color Study",
  robots: { index: false, follow: false },
}

export default function MCSWJobsHybridDirectionsPage() {
  return (
    <main className={`${chivo.variable} hybrid-review`}>
      <header className="hybrid-review-head">
        <a href="/design-preview/mcsw-jobs-call-concepts">MCSW Jobs</a>
        <div>
          <h1>Choose a color.</h1>
          <p>
            One locked Signal layout with four color treatments. Sample data is
            used throughout.
          </p>
        </div>
      </header>
      <HybridDirectionsClient />
    </main>
  )
}
