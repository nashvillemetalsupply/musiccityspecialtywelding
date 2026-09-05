import Link from "next/link"
import type { CSSProperties } from "react"

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

export default function OpsNotFound() {
  return <div style={ground}>
    <section style={card}>
      <p className="t-label">Nothing was changed</p>
      <h1 className="t-title">Job or customer not found.</h1>
      <p>The link may be old, or this record may have been filed somewhere else. Check Active Jobs or search from the Jobs home.</p>
      <div><Link className="btn btn--edge" style={wide} href="/ops">Back to Jobs</Link></div>
    </section>
  </div>
}
