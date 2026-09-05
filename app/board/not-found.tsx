import Link from "next/link"
import { chivo, golos } from "@/app/fonts"
import { SkipLink } from "./skip-link"
import "./board.css"

export default function BoardNotFound() {
  return <div className={`${golos.variable} ${chivo.variable} app`}>
    <SkipLink />
    <main id="main" tabIndex={-1} className="empty-state" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
      <h1 className="t-title">Nothing here</h1>
      <p>That link points at a job or page that is not on the board.</p>
      <Link className="btn btn--go" href="/board">Back to the job tracker</Link>
    </main>
  </div>
}
