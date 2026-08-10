"use client"

import Image from "next/image"
import { useState } from "react"

type PunchCard = { selector: string; name: string; hasEmail: boolean; hasSms: boolean }

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

  return <main className="ops-login">
    <div className="ops-login-shell">
      <div className="ops-login-plate">
        <div className="ops-login-brand">
          <Image src="/images/optimized/mcs_welding_logo.webp" alt="MCS Welding" width={240} height={160} sizes="72px" priority unoptimized />
          <strong>Jobs</strong>
        </div>
        <h1>Sign in</h1><p>Choose your name. This device stays signed in for up to 90 days.</p>
      </div>
      {linkError && <p className="ops-alert" role="alert">That sign-in link expired or was already used. Request a fresh one.</p>}

      {operators.length > 0 && <section className="ops-punch-rack" aria-label="Team members">
        <span>Choose your name</span>
        <div>{operators.map((operator) => <button type="button" key={operator.selector} aria-pressed={selector === operator.selector} className={selector === operator.selector ? "is-picked" : ""} onClick={() => chooseOperator(operator)}><strong>{operator.name}</strong><small>{selector === operator.selector ? "Selected" : "Sign in"}</small></button>)}</div>
      </section>}
      {!picked && !manual && <p className="ops-login-hint">One tap. Then choose text or email.</p>}

      {(picked || manual) && <section className="ops-punch-delivery">
        <div className="ops-login-cards" role="group" aria-label="Sign-in method">
          {(!picked || picked.hasEmail) && <button type="button" aria-pressed={mode === "email"} className={mode === "email" ? "is-active" : ""} onClick={() => chooseMode("email")}><strong>Email link</strong><span>Open it once</span></button>}
          {smsReady && (!picked || picked.hasSms) && <button type="button" aria-pressed={mode === "sms"} className={mode === "sms" ? "is-active" : ""} onClick={() => chooseMode("sms")}><strong>Text code</strong><span>Six digits</span></button>}
        </div>

        {mode === "email" ? <form onSubmit={submitEmail}>
          {picked ? <p className="ops-login-destination">Send the one-tap key to {picked.name}&apos;s shop email.</p> : <><label htmlFor="ops-email">Your email</label><input id="ops-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></>}
          <button type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending..." : "Send my link"}</button>
        </form> : codeRequested ? <form onSubmit={verifyCode}>
          <label htmlFor="ops-code">Six-digit code</label><input id="ops-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required />
          <button type="submit" disabled={state === "sending"}>{state === "sending" ? "Checking..." : "Sign in"}</button>
          <button type="button" className="ops-ghost" onClick={resetDelivery}>Send another code</button>
        </form> : <form onSubmit={requestCode}>
          {picked ? <p className="ops-login-destination">Text six shop digits to {picked.name}&apos;s phone.</p> : <><label htmlFor="ops-phone">Your cell number</label><input id="ops-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required /></>}
          <button type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending..." : "Text my code"}</button>
        </form>}
      </section>}

      {picked && <button type="button" className="ops-login-switch" onClick={() => { setSelector(""); resetDelivery() }}>Choose a different person</button>}
      {!picked && operators.length > 0 && <details className="ops-login-manual" open={manual}><summary onClick={() => setManual(true)}>My name isn&apos;t here</summary>{manual && <><p>Ask the owner to add you, or use manual sign-in below.</p><button type="button" onClick={() => setManual(true)}>Use manual sign-in</button></>}</details>}
      {message && <p className={state === "error" ? "ops-alert" : "ops-ok"} role={state === "error" ? "alert" : "status"}>{message}</p>}
    </div>
  </main>
}
