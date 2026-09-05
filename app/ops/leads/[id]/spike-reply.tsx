"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { VoiceCaptureButton } from "../../voice-capture-button"
import { SafeSubmitButton } from "../../safe-action-controls"
import { sendLeadReplyState, type ReplyActionState } from "./message-actions"

const initialState: ReplyActionState = { status: "idle", message: "", sentAt: 0 }
const QUICK_COPIES = ["On it.", "What’s the address?", "Can swing by tomorrow AM.", "Send a photo of it."]

export function SpikeReply({
  leadId,
  hasEmail,
  hasPhone,
  initialChannel,
  targetPersonId,
  targetName,
  targetHasPhone,
  targetHasEmail,
  voiceReady,
  focusOnMount = false,
}: {
  leadId: number
  hasEmail: boolean
  hasPhone: boolean
  initialChannel: "text" | "email"
  targetPersonId?: number | null
  targetName?: string
  targetHasPhone?: boolean
  targetHasEmail?: boolean
  voiceReady: boolean
  focusOnMount?: boolean
}) {
  const [state, action, pending] = useActionState(sendLeadReplyState, initialState)
  const canText = targetPersonId ? Boolean(targetHasPhone) : hasPhone
  const canEmail = targetPersonId ? Boolean(targetHasEmail) : hasEmail
  const [channel, setChannel] = useState<"text" | "email">(initialChannel === "email" && canEmail ? "email" : "text")
  const [body, setBody] = useState("")
  const [voiceError, setVoiceError] = useState("")
  const [intentKey, setIntentKey] = useState(() => crypto.randomUUID())
  const bodyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!focusOnMount) return
    bodyRef.current?.focus({ preventScroll: true })
  }, [focusOnMount])

  useEffect(() => {
    if (state.status !== "sent") return
    const timer = window.setTimeout(() => { setBody(""); setIntentKey(crypto.randomUUID()) }, 0)
    return () => window.clearTimeout(timer)
  }, [state.sentAt, state.status])

  return (
    <form action={action} className="ops-spike-reply" id="job-reply" aria-busy={pending}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="intentKey" value={intentKey} />
      {targetPersonId && <input type="hidden" name="targetPersonId" value={targetPersonId} />}
      {targetPersonId && <strong className="ops-reply-target">Replying to {targetName || "account contact"} by {channel}</strong>}
      <button
        type="button"
        className="ops-channel-stamp"
        onClick={() => canEmail && canText && setChannel((current) => current === "text" ? "email" : "text")}
        disabled={!canEmail || !canText}
        title={canEmail && canText ? "Tap to flip the reply channel" : `This contact only has ${canEmail ? "email" : "text"}`}
      >Goes by {channel}</button>
      <VoiceCaptureButton
        available={voiceReady}
        recoveryKey={`spike:${leadId}:${targetPersonId || "primary"}`}
        className="ops-mic-key"
        disabled={pending}
        onError={setVoiceError}
        onTranscript={(transcript) => setBody((current) => current.trim() ? `${current.trim()} ${transcript}` : transcript)}
      />
      <input ref={bodyRef} id="job-reply-body" name="body" type="text" autoComplete="off" required aria-label={channel === "email" ? "Email reply" : "Text reply"} aria-invalid={state.status === "error" ? "true" : undefined} aria-describedby={voiceError || state.message ? "job-reply-result" : undefined} value={body} onChange={(event) => setBody(event.target.value)} placeholder={channel === "email" ? "Short shop email…" : "Short shop reply…"} />
      <SafeSubmitButton disabled={pending || !body.trim()} pendingLabel="Sending…">Send {channel}</SafeSubmitButton>
      <div className="ops-reply-chips" aria-label="Quick replies">
        {QUICK_COPIES.map((copy) => <button type="button" key={copy} onClick={() => setBody(copy)}>{copy}</button>)}
      </div>
      {(voiceError || state.message) && <p id="job-reply-result" className={voiceError || state.status === "error" ? "is-error" : "is-ok"} role={voiceError || state.status === "error" ? "alert" : "status"} aria-live="polite">{voiceError || state.message}</p>}
      {state.status === "error" && state.retryable && <button type="button" className="ops-ghost" onClick={() => { setIntentKey(crypto.randomUUID()); setVoiceError("") }}>File a fresh retry attempt</button>}
    </form>
  )
}
