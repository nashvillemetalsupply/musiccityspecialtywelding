"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { chivo, golos } from "@/app/fonts"
import { SkipLink } from "./skip-link"
import "./board.css"

export default function BoardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const reported = useRef(new Set<string>())

  useEffect(() => {
    const key = error.digest || error.message || "board-error"
    if (reported.current.has(key)) return
    reported.current.add(key)
    void fetch("/api/ops/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, digest: error.digest ?? "", route: "/board" }),
      keepalive: true,
    }).catch(() => undefined)
  }, [error])

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
