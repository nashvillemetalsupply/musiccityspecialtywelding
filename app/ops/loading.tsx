import type { CSSProperties } from "react"

/* The ops layout still loads the light sheets until Task 7 flips it, so this
   surface binds the board's dark roles on its own subtree. Roles, not hex. */
const dark = {
  "--surface-sunken": "var(--dark-surface-sunken)",
  "--surface": "var(--dark-surface)",
  "--surface-raised": "var(--dark-surface-raised)",
  "--border": "var(--dark-border)",
  "--text-primary": "var(--dark-text-primary)",
} as CSSProperties

const ground: CSSProperties = {
  ...dark, minHeight: "100dvh", background: "var(--surface-sunken)", color: "var(--text-primary)",
  fontFamily: "var(--font)", display: "grid", gap: "var(--s5)", alignContent: "start",
  padding: "var(--s4) var(--s4) calc(64px + var(--safe-area-bottom))",
}
const card: CSSProperties = {
  display: "grid", gap: "var(--s3)", background: "var(--surface)",
  border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: "var(--s5) var(--s4)",
}
const bar = (width: string, height: string): CSSProperties => ({ width, height, background: "var(--surface-raised)", borderRadius: "var(--r-sm)" })

export default function OpsLoading() {
  return <div style={ground} aria-busy="true" aria-label="Loading MCSW Jobs">
    <section style={card} aria-hidden="true"><span style={bar("40%", "var(--s3)")} /><span style={bar("72%", "var(--s3)")} /><span style={bar("100%", "96px")} /></section>
    <section style={card} aria-hidden="true"><span style={bar("40%", "var(--s3)")} /><span style={bar("100%", "var(--row)")} /><span style={bar("100%", "var(--row)")} /><span style={bar("100%", "var(--row)")} /></section>
  </div>
}
