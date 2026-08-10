import type { Metadata } from "next"
import {
  Atkinson_Hyperlegible_Next,
  Commissioner,
} from "next/font/google"
import { ConceptsClient } from "./concepts-client"
import "./concepts.css"

const commissioner = Commissioner({
  subsets: ["latin"],
  weight: "variable",
  axes: ["FLAR", "VOLM"],
  variable: "--font-call-display",
  display: "swap",
  preload: false,
})

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-call-body",
  display: "swap",
  adjustFontFallback: false,
  preload: false,
})

export const metadata: Metadata = {
  title: "MCSW Jobs Call Concepts",
  robots: { index: false, follow: false },
}

export default function MCSWJobsCallConceptsPage() {
  return (
    <main className={`${commissioner.variable} ${atkinson.variable} call-concepts-page`}>
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
