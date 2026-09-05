import Link from "next/link"
import { chivo, golos } from "@/app/fonts"
import { SkipLink } from "./skip-link"
import "./board.css"

export default function BoardLoading() {
  return <div className={`${golos.variable} ${chivo.variable} app`}>
    <SkipLink />
    <main id="main" tabIndex={-1} className="main" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
      <h1 className="sr-only">Job tracker</h1>
      <p className="sr-only" role="status">Loading the board</p>
      <div className="figures" aria-hidden="true">
        {[0, 1].map((figure) => <div className="figure" key={figure} style={{ height: "var(--row)", background: "var(--surface-raised)" }} />)}
      </div>
      <div className="card" aria-hidden="true">
        {[0, 1, 2].map((row) => <div key={row} style={{ height: "var(--row)", background: "var(--surface-raised)" }} />)}
      </div>
      <Link className="btn btn--edge" href="/board">Back to the job tracker</Link>
    </main>
  </div>
}
