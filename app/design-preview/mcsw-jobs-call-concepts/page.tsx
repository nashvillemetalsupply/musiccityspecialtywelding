import type { Metadata } from "next"
import { ConceptsClient } from "./concepts-client"
import "./concepts.css"

export const metadata: Metadata = {
  title: "MCSW Jobs Call Concepts",
  robots: { index: false, follow: false },
}

export default function MCSWJobsCallConceptsPage() {
  return (
    <main className="call-concepts-page">
      <header className="review-head">
        <div>
          <a href="/design-preview/mcsw-jobs-finalists">MCSW Jobs</a>
          <h1>Three ways to make the call the job.</h1>
        </div>
        <p>
          Same customer. Same shop. Different product thinking. Switch between
          them and try the main action.
        </p>
      </header>
      <ConceptsClient />
    </main>
  )
}
