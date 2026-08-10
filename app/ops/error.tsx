"use client"

import Link from "next/link"
import { useEffect } from "react"

export default function OpsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("MCSW Jobs route failed", error) }, [error])
  return <main className="jobs-route-state">
    <section className="jobs-panel" role="alert">
      <p className="jobs-route-kicker">Nothing was changed</p>
      <h1>MCSW Jobs could not load.</h1>
      <p>Check the connection and try again. If this repeats, call the shop before entering the job twice.</p>
      <div><button type="button" onClick={reset}>Try again</button><Link href="/ops">Back to jobs</Link></div>
    </section>
  </main>
}
