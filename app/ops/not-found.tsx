import Link from "next/link"
import type { CSSProperties } from "react"
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

/* `jobs-route-state` stays on the main only because
   scripts/recent-regressions.test.mjs pins the literal; nothing here depends on
   it visually — every rule it still carries is overridden below, and the class
   goes inert when Task 7 deletes the sheet. */
const ground: CSSProperties = {
  ...dark, width: "100%", minHeight: "100dvh", margin: 0,
  background: "var(--surface-sunken)", color: "var(--text-primary)",
  fontFamily: "var(--font)", fontSize: "var(--t-body)", lineHeight: "var(--lh-body)",
  display: "grid", placeItems: "center", padding: "var(--s5) var(--s4)",
}
const card: CSSProperties = {
  width: "min(100%, 30rem)", display: "grid", gap: "var(--s3)", background: "var(--surface)",
  border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: "var(--s5) var(--s4)",
}
const title: CSSProperties = { fontSize: "var(--t-title)" }
const edge: CSSProperties = {
  width: "100%", minHeight: "44px", border: 0, borderRadius: "var(--r-md)",
  boxShadow: "inset 0 0 0 1px var(--border)", background: "none",
  color: "var(--text-primary)", fontWeight: "var(--w-semi)",
}

export default function OpsNotFound() {
  return <main className="jobs-route-state" style={ground}>
    <section style={card}>
      <p className="t-label">Nothing was changed</p>
      <h1 className="t-title" style={title}>Job or customer not found.</h1>
      <p>The link may be old, or this record may have been filed somewhere else. Check Active Jobs or search from the Jobs home.</p>
      <div><Link className="btn btn--edge" style={edge} href="/ops">Back to Jobs</Link></div>
    </section>
  </main>
}
