import type { Metadata } from "next"
import { HybridDirectionsClient } from "./hybrid-client"
import "./hybrid.css"

export const metadata: Metadata = {
  title: "MCSW Jobs Signal Color Study",
  robots: { index: false, follow: false },
}

export default function MCSWJobsHybridDirectionsPage() {
  return (
    <main className="hybrid-review">
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
