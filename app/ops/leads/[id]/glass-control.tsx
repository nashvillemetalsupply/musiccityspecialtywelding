"use client"

import { useActionState, useState } from "react"
import { SafeSubmitButton } from "../../safe-action-controls"
import { hangGlassClipboard, sendGlassClipboard, type GlassSendState } from "./glass-actions"

const initialSend: GlassSendState = { message: "", error: "" }

export function GlassControl({
  leadId,
  textReady,
  initialUrl,
  initialError = "",
  initialNeedsReplacement = false,
  smsReady,
}: {
  leadId: number
  textReady: boolean
  initialUrl: string
  initialError?: string
  initialNeedsReplacement?: boolean
  smsReady: boolean
}) {
  const [state, action, pending] = useActionState(hangGlassClipboard, {
    url: initialUrl,
    error: initialError,
    message: "",
    smsReady,
    needsReplacement: initialNeedsReplacement,
  })
  const [sendState, sendAction, sending] = useActionState(sendGlassClipboard, initialSend)
  const [copyMessage, setCopyMessage] = useState("")
  return (
    <section className="ops-glass-control" aria-labelledby={`customer-page-title-${leadId}`}>
      <div><h2 id={`customer-page-title-${leadId}`}>Customer Page</h2><p>Share status, approved photos, promises, and invoices. Shop notes stay private.</p></div>
      {!state.url && <form action={action} onSubmit={() => setCopyMessage("")}>
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="intent" value={state.needsReplacement ? "rotate" : "hang"} />
        <SafeSubmitButton disabled={pending} pendingLabel={state.needsReplacement ? "Replacing…" : "Creating…"}>{state.needsReplacement ? "Replace Customer Page" : "Create Customer Page"}</SafeSubmitButton>
      </form>}
      {state.error && <p className="ops-alert" role="alert">{state.error}</p>}
      {state.message && <p className="ops-glass-state" role="status" aria-live="polite">{state.message}</p>}
      {state.url && <div className="ops-glass-link">
        <code>{state.url}</code>
        <button type="button" onClick={() => {
          setCopyMessage("")
          if (!navigator.clipboard) {
            setCopyMessage("Copy is unavailable here. Press and hold the link to copy it.")
            return
          }
          void navigator.clipboard.writeText(state.url)
            .then(() => setCopyMessage("Link copied."))
            .catch(() => setCopyMessage("Copy did not work. Press and hold the link to copy it."))
        }}>Copy link</button>
        {textReady && state.smsReady && <form action={sendAction}>
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="url" value={state.url} />
          <SafeSubmitButton disabled={sending} pendingLabel="Sending…">Text from shop</SafeSubmitButton>
        </form>}
        <a href={state.url} target="_blank" rel="noreferrer">Preview</a>
        <form className="ops-glass-link-wide" action={action} onSubmit={() => setCopyMessage("")}>
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="intent" value="rotate" />
          <SafeSubmitButton className="ops-glass-cut" disabled={pending}>Replace link</SafeSubmitButton>
        </form>
        <form className="ops-glass-link-wide" action={action} onSubmit={() => setCopyMessage("")}>
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="intent" value="revoke" />
          <SafeSubmitButton className="ops-glass-revoke" disabled={pending}>Close Customer Page</SafeSubmitButton>
        </form>
        {copyMessage && <small role="status" aria-live="polite">{copyMessage}</small>}
        {sendState.message && <small role="status" aria-live="polite">{sendState.message}</small>}
        {sendState.error && <small className="ops-alert" role="alert">{sendState.error}</small>}
      </div>}
    </section>
  )
}
