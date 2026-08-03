"use client"

import { useState } from "react"

export function OpsLoginForm({ linkError }: { linkError: boolean }) {
  const [email, setEmail] = useState("")
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [message, setMessage] = useState("")

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setState("sending")
    setMessage("")
    try {
      const response = await fetch("/api/ops/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || "Sign-in failed.")
      setState("sent")
      setMessage(data.message || "Check your email for the sign-in link.")
    } catch (error) {
      setState("error")
      setMessage(error instanceof Error ? error.message : "Sign-in failed.")
    }
  }

  return (
    <main className="ops-login">
      <h1>Shop operations</h1>
      <p>Enter the shop email. A one-time sign-in link lands in the inbox.</p>
      {linkError && (
        <p className="ops-alert" role="alert">
          That sign-in link expired or was already used. Request a fresh one.
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor="ops-email">Shop email</label>
        <input
          id="ops-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
      {message && (
        <p className={state === "error" ? "ops-alert" : "ops-ok"} role="status">
          {message}
        </p>
      )}
    </main>
  )
}
