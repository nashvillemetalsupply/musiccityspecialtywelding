"use client"

import Link from "next/link"
import { chivo, golos } from "@/app/fonts"
import { SkipLink } from "./skip-link"
import "./board.css"

export default function BoardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className={`${golos.variable} ${chivo.variable} app`}>
    <SkipLink />
    <main id="main" tabIndex={-1} className="empty-state" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
      <h1 className="t-title">The board hit an error.</h1>
      <p>Your work is saved; reload or go back to the tracker.</p>
      <button className="btn btn--edge" onClick={reset}>Try again</button>
      <Link className="btn btn--go" href="/board">Back to the job tracker</Link>
    </main>
  </div>
}
