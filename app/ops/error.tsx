"use client"

import Link from "next/link"
import type { CSSProperties } from "react"
import { useEffect } from "react"
import "../../styles/control.css"

/* The ops layout still loads the light sheets until Task 7 flips it, so this
   surface binds the board's dark roles on its own subtree. Roles, not hex. */
const dark = {
  "--surface-sunken": "var(--dark-surface-sunken)",
  "--surface": "var(--dark-surface)",
  "--surface-raised": "var(--dark-surface-raised)",
  "--border": "var(--dark-border)",
  "--border-subtle": "var(--dark-border-subtle)",
  "--text-primary": "var(--dark-text-primary)",
  "--text-secondary": "var(--dark-text-secondary)",
  "--text-muted": "var(--dark-text-muted)",
  "--action": "var(--dark-action)",
  "--action-ink": "var(--dark-action-ink)",
  "--focus": "var(--dark-focus)",
} as CSSProperties

const ground: CSSProperties = {
  ...dark, minHeight: "100dvh", background: "var(--surface-sunken)", color: "var(--text-primary)",
  fontFamily: "var(--font)", fontSize: "var(--t-body)", lineHeight: "var(--lh-body)",
  display: "grid", placeItems: "center", padding: "var(--s5) var(--s4)",
}
const card: CSSProperties = {
  width: "min(100%, 30rem)", display: "grid", gap: "var(--s3)", background: "var(--surface)",
  border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: "var(--s5) var(--s4)",
}
const wide: CSSProperties = { width: "100%" }

export default function OpsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("MCSW Jobs route failed", error) }, [error])
  return <main style={ground}>
    <section style={card} role="alert">
      <p className="t-label">Nothing was changed</p>
      <h1 className="t-title">MCSW Jobs could not load.</h1>
      <p>Check the connection and try again. If this repeats, call the shop before entering the job twice.</p>
      <div style={{ display: "grid", gap: "var(--s2)" }}><button type="button" className="btn btn--go" style={wide} onClick={reset}>Try again</button><Link className="btn btn--edge" style={wide} href="/ops">Back to jobs</Link></div>
    </section>
  </main>
}
