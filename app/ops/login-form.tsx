"use client"

import Image from "next/image"
import type { CSSProperties } from "react"
import { useState } from "react"
import "../../styles/control.css"

type PunchCard = { selector: string; name: string; hasEmail: boolean; hasSms: boolean }

/* The ops layout still loads the light sheets until Task 7 flips it, so this
   surface binds the board's dark roles on its own subtree. Roles, not hex. */
const dark = {
  "--surface-sunken": "var(--dark-surface-sunken)",
  "--surface": "var(--dark-surface)",
  "--surface-raised": "var(--dark-surface-raised)",
  "--border": "var(--dark-border)",
  "--border-subtle": "var(--dark-border-subtle)",
  "--border-strong": "var(--dark-border-strong)",
  "--text-primary": "var(--dark-text-primary)",
  "--text-secondary": "var(--dark-text-secondary)",
  "--text-muted": "var(--dark-text-muted)",
  "--action": "var(--dark-action)",
  "--action-ink": "var(--dark-action-ink)",
  "--focus": "var(--dark-focus)",
  "--status-good-ink": "var(--dark-good-ink)",
  "--status-good-sur": "var(--dark-good-sur)",
  "--status-stop-ink": "var(--dark-stop-ink)",
  "--status-stop-sur": "var(--dark-stop-sur)",
} as CSSProperties

const ground: CSSProperties = {
  ...dark, minHeight: "100dvh", background: "var(--surface-sunken)", color: "var(--text-primary)",
  fontFamily: "var(--font)", fontSize: "var(--t-body)", lineHeight: "var(--lh-body)",
  display: "grid", placeItems: "center", padding: "var(--s5) var(--s4)",
}
const card: CSSProperties = {
  width: "min(100%, 26rem)", display: "grid", gap: "var(--s5)", background: "var(--surface)",
  border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: "var(--s5) var(--s4)",
}
const stack: CSSProperties = { display: "grid", gap: "var(--s3)" }
const rows: CSSProperties = { display: "grid", gap: "var(--s2)" }
const plate: CSSProperties = { display: "flex", alignItems: "center", gap: "var(--s3)", minWidth: 0 }
const mark: CSSProperties = { flex: "none", display: "grid", placeItems: "center", padding: "var(--s2)", background: "var(--surface-raised)", borderRadius: "var(--r-md)" }
const logo: CSSProperties = { width: "56px", height: "auto" }
const field: CSSProperties = {
  width: "100%", minHeight: "44px", padding: "0 var(--s3)", background: "var(--surface-raised)",
  border: "1px solid var(--border)", borderRadius: "var(--r-md)", color: "var(--text-primary)",
  fontFamily: "var(--font)", fontSize: "var(--t-data)",
}
/* one tone map for both notes: a refusal wears stop, a receipt wears good */
const note = (tone: "stop" | "good"): CSSProperties => ({
  margin: 0, padding: "var(--s2) var(--s3)", borderRadius: "var(--r-md)",
  background: `var(--status-${tone}-sur)`, color: `var(--status-${tone}-ink)`,
  fontSize: "var(--t-label)", lineHeight: "var(--lh-label)",
})
/* a name or a method reads as a board row: picked carries the action edge */
const pick = (on: boolean): CSSProperties => ({
  display: "grid", gap: "2px", justifyItems: "start", textAlign: "left", whiteSpace: "normal",
  minHeight: "44px", padding: "var(--s2) var(--s3)", borderRadius: "var(--r-md)",
  background: on ? "var(--surface-raised)" : "none", color: "var(--text-primary)",
  boxShadow: on ? "inset 0 0 0 2px var(--action)" : "inset 0 0 0 1px var(--border)",
})
const wide = (busy = false): CSSProperties => ({ width: "100%", opacity: busy ? 0.65 : 1 })

export function OpsLoginForm({ linkError, operators = [], smsReady = false }: { linkError: boolean; operators?: PunchCard[]; smsReady?: boolean }) {
  const [mode, setMode] = useState<"email" | "sms">("email")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [selector, setSelector] = useState("")
  const [manual, setManual] = useState(operators.length === 0)
  const [codeRequested, setCodeRequested] = useState(false)
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [message, setMessage] = useState("")
  const picked = operators.find((operator) => operator.selector === selector) ?? null

  const resetDelivery = () => { setState("idle"); setCodeRequested(false); setMessage(""); setCode("") }
  const chooseOperator = (operator: PunchCard) => {
    setSelector(operator.selector)
    setManual(false)
    setMode(operator.hasSms ? "sms" : "email")
    resetDelivery()
  }

  const request = async (path: string, payload: Record<string, string>, fallback: string) => {
    setState("sending")
    setMessage("")
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || fallback)
    return data as { message?: string }
  }

  const submitEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const data = await request("/api/ops/login", picked ? { selector } : { email }, "Sign-in failed.")
      setState("sent")
      setMessage(data.message || "Check your email for the sign-in link.")
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Sign-in failed.") }
  }

  const requestCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const data = await request("/api/ops/sms-login/request", picked ? { selector } : { phone }, "The code could not be sent.")
      setState("sent")
      setCodeRequested(true)
      setMessage(data.message || "Your sign-in code is on its way.")
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "The code could not be sent.") }
  }

  const verifyCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      await request("/api/ops/sms-login/verify", picked ? { selector, code } : { phone, code }, "That code did not work.")
      window.location.assign("/ops")
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "That code did not work.") }
  }

  const chooseMode = (next: "email" | "sms") => { setMode(next); resetDelivery() }

  return <main style={ground}>
    <div style={card}>
      <div style={plate}>
        <div style={mark}>
          <Image src="/images/optimized/mcs_welding_logo.webp" alt="MCS Welding" width={240} height={160} sizes="72px" priority unoptimized style={logo} />
        </div>
        <div style={{ display: "grid", gap: "var(--s1)", minWidth: 0 }}>
          <h1 className="t-title">Sign in</h1><p className="t-caption">Choose your name. This device stays signed in for up to 90 days.</p>
        </div>
      </div>
      {linkError && <p style={note("stop")} role="alert">That sign-in link expired or was already used. Request a fresh one.</p>}

      {operators.length > 0 && <section style={stack} aria-label="Team members">
        <span className="t-label">Choose your name</span>
        <div style={rows}>{operators.map((operator) => <button type="button" key={operator.selector} aria-label={`Sign in as ${operator.name}`} aria-pressed={selector === operator.selector} style={pick(selector === operator.selector)} onClick={() => chooseOperator(operator)}><strong className="t-data">{operator.name}</strong><small className="t-caption">{selector === operator.selector ? "Selected" : "Sign in"}</small></button>)}</div>
      </section>}
      {!picked && !manual && <p className="t-caption">One tap. Then choose text or email.</p>}

      {(picked || manual) && <section style={stack}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--s2)" }} role="group" aria-label="Sign-in method">
          {(!picked || picked.hasEmail) && <button type="button" aria-pressed={mode === "email"} style={pick(mode === "email")} onClick={() => chooseMode("email")}><strong className="t-data">Email link</strong><span className="t-caption">Open it once</span></button>}
          {smsReady && (!picked || picked.hasSms) && <button type="button" aria-pressed={mode === "sms"} style={pick(mode === "sms")} onClick={() => chooseMode("sms")}><strong className="t-data">Text code</strong><span className="t-caption">Six digits</span></button>}
        </div>

        {mode === "email" ? <form onSubmit={submitEmail} style={stack}>
          {picked ? <p className="t-caption">Send the one-tap key to {picked.name}&apos;s shop email.</p> : <><label className="t-label" htmlFor="ops-email">Your email</label><input id="ops-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required style={field} /></>}
          <button type="submit" className="btn btn--go" style={wide(state === "sending")} disabled={state === "sending"}>{state === "sending" ? "Sending..." : "Send my link"}</button>
        </form> : codeRequested ? <form onSubmit={verifyCode} style={stack}>
          <label className="t-label" htmlFor="ops-code">Six-digit code</label><input id="ops-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required style={field} />
          <button type="submit" className="btn btn--go" style={wide(state === "sending")} disabled={state === "sending"}>{state === "sending" ? "Checking..." : "Sign in"}</button>
          <button type="button" className="btn btn--edge" style={wide()} onClick={resetDelivery}>Send another code</button>
        </form> : <form onSubmit={requestCode} style={stack}>
          {picked ? <p className="t-caption">Text six shop digits to {picked.name}&apos;s phone.</p> : <><label className="t-label" htmlFor="ops-phone">Your cell number</label><input id="ops-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required style={field} /></>}
          <button type="submit" className="btn btn--go" style={wide(state === "sending")} disabled={state === "sending"}>{state === "sending" ? "Sending..." : "Text my code"}</button>
        </form>}
      </section>}

      {picked && <button type="button" className="btn btn--edge" style={wide()} onClick={() => { setSelector(""); resetDelivery() }}>Choose a different person</button>}
      {!picked && operators.length > 0 && <details style={stack} open={manual}><summary className="t-label" style={{ minHeight: "44px", display: "flex", alignItems: "center", cursor: "pointer" }} onClick={() => setManual(true)}>My name isn&apos;t here</summary>{manual && <><p className="t-caption">Ask the owner to add you, or use manual sign-in below.</p><button type="button" className="btn btn--edge" style={wide()} onClick={() => setManual(true)}>Use manual sign-in</button></>}</details>}
      {message && <p style={note(state === "error" ? "stop" : "good")} role={state === "error" ? "alert" : "status"}>{message}</p>}
    </div>
  </main>
}
