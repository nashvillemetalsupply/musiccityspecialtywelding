"use client"

import { useEffect, useRef, useState } from "react"
import { swipeFinishDecision } from "@/lib/shop-brain-invariants.mjs"
import { SafeSubmitButton } from "../../safe-action-controls"
import { VoiceCaptureButton } from "../../voice-capture-button"
import { addLeadCompletionNote, markLeadComplete, undoLeadComplete } from "../../actions"

type SwipeStart = { x: number; y: number; width: number } | null

export function DoneStamp({ leadId, completed, undoUntil, voiceReady }: { leadId: number; completed: boolean; undoUntil: string | null; voiceReady: boolean }) {
  const finishRef = useRef<HTMLFormElement>(null)
  const addendumRef = useRef<HTMLFormElement>(null)
  const swipeStartRef = useRef<SwipeStart>(null)
  const submittedRef = useRef(false)
  const cuePlayedRef = useRef(false)
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [keyboardArmed, setKeyboardArmed] = useState(false)
  const [addendumOpen, setAddendumOpen] = useState(false)
  const [undoExpired, setUndoExpired] = useState(false)
  const [note, setNote] = useState("")
  const [noteSource, setNoteSource] = useState<"typed" | "voice">("typed")
  const [voiceIntentId, setVoiceIntentId] = useState("")
  const [voiceError, setVoiceError] = useState("")

  useEffect(() => {
    const remaining = undoUntil ? new Date(undoUntil).getTime() - Date.now() : 0
    const stateTimer = window.setTimeout(() => setUndoExpired(remaining <= 0), 0)
    const expiryTimer = remaining > 0 ? window.setTimeout(() => setUndoExpired(true), remaining) : null
    return () => {
      window.clearTimeout(stateTimer)
      if (expiryTimer !== null) window.clearTimeout(expiryTimer)
    }
  }, [undoUntil])

  useEffect(() => {
    if (!completed || !submittedRef.current || cuePlayedRef.current) return
    cuePlayedRef.current = true
    navigator.vibrate?.([35, 20, 55])
    if (voiceReady && "speechSynthesis" in window) {
      speechSynthesis.cancel()
      speechSynthesis.speak(new SpeechSynthesisUtterance("Say what you did."))
    }
  }, [completed, voiceReady])

  useEffect(() => {
    if (!completed) return
    const timer = window.setTimeout(() => {
      submittedRef.current = false
      swipeStartRef.current = null
      setSubmitting(false)
      setProgress(0)
      setDragging(false)
      setKeyboardArmed(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [completed])

  function finish() {
    if (completed || submitting || submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true)
    setProgress(1)
    setDragging(false)
    setUndoExpired(false)
    setAddendumOpen(true)
    navigator.vibrate?.([45, 25, 70])
    finishRef.current?.requestSubmit()
  }

  function resetSwipe() {
    swipeStartRef.current = null
    setDragging(false)
    if (!submittedRef.current) setProgress(0)
  }

  function armOrFinish() {
    if (submitting) return
    if (keyboardArmed) finish()
    else setKeyboardArmed(true)
  }

  return <section className={`ops-done-bench${completed ? " is-done" : ""}`} aria-labelledby="finish-job-title">
    <div><strong id="finish-job-title">{completed ? "Job Finished" : "Finish Job"}</strong></div>

    {!completed && <form ref={finishRef} action={markLeadComplete}>
      <input type="hidden" name="leadId" value={leadId} />
      <button
        type="button"
        className={`ops-swipe-finish${dragging ? " is-dragging" : ""}${submitting ? " is-submitting" : ""}`}
        aria-disabled={submitting}
        aria-pressed={keyboardArmed}
        aria-describedby="swipe-finish-help"
        aria-label={keyboardArmed ? "Press again to finish job" : "Swipe to Finish. Activate twice without swiping."}
        style={{ "--swipe-progress": progress } as React.CSSProperties}
        onClick={(event) => {
          // Pointer taps are not a finish gesture. A zero-detail click is the
          // platform path used by keyboard and assistive virtual activation.
          if (event.detail === 0) armOrFinish()
        }}
        onBlur={() => setKeyboardArmed(false)}
        onPointerDown={(event) => {
          if (submitting) return
          const width = Math.max(1, event.currentTarget.getBoundingClientRect().width - 64)
          swipeStartRef.current = { x: event.clientX, y: event.clientY, width }
          setDragging(true)
          setKeyboardArmed(false)
        }}
        onPointerMove={(event) => {
          const start = swipeStartRef.current
          if (!start || submitting) return
          const decision = swipeFinishDecision({ deltaX: event.clientX - start.x, deltaY: event.clientY - start.y, width: start.width, submitted: submittedRef.current })
          if (decision.outcome === "cancel") { resetSwipe(); return }
          setProgress(decision.progress)
          if (decision.outcome === "submit") finish()
        }}
        onPointerUp={resetSwipe}
        onPointerCancel={resetSwipe}
        onKeyDown={(event) => {
          if (event.repeat) return
          if (event.key === "Escape") { setKeyboardArmed(false); return }
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          armOrFinish()
        }}
      >
        <span className="ops-swipe-track">{submitting ? "Finishing…" : keyboardArmed ? "Press again to finish" : "Swipe to Finish"}</span>
        <span className="ops-swipe-thumb" aria-hidden="true">→</span>
      </button>
      <small id="swipe-finish-help">
        Swipe right to finish. Vertical scrolling stays safe.
        <span className="ops-sr-only"> Keyboard users press Enter twice.</span>
      </small>
    </form>}

    {completed && !addendumOpen && <button type="button" className="ops-closeout-add" onClick={() => setAddendumOpen(true)}>Add closeout note or photo</button>}

    {completed && addendumOpen && <form ref={addendumRef} action={addLeadCompletionNote} className="ops-done-note" onSubmit={() => setAddendumOpen(false)}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="noteSource" value={noteSource} />
      <input type="hidden" name="voiceIntentId" value={voiceIntentId} />
      <label htmlFor="done-note">Optional closeout note</label>
      <input id="done-note" name="note" value={note} onChange={(event) => { setNoteSource("typed"); setNote(event.target.value) }} placeholder="Welded hinge, tested swing, customer happy" />
      <VoiceCaptureButton
        available={voiceReady}
        recoveryKey={`done:${leadId}`}
        className="ops-done-voice"
        idleLabel="Hold to say it"
        onError={setVoiceError}
        onTranscript={(transcript, intentId) => {
          setNoteSource("voice")
          setVoiceIntentId(intentId ?? "")
          setNote((current) => current.trim() ? `${current.trim()} ${transcript}` : transcript)
          window.setTimeout(() => addendumRef.current?.requestSubmit(), 100)
        }}
      />
      {voiceError && <small className="ops-done-voice-error" aria-live="polite">{voiceError}</small>}
      <label className="ops-done-photo"><span>Add a finished-work photo</span><input type="file" name="photo" accept="image/*" capture="environment" onChange={(event) => { if (event.currentTarget.files?.length) window.setTimeout(() => addendumRef.current?.requestSubmit(), 100) }} /></label>
      <SafeSubmitButton className="ops-ghost" pendingLabel="Filing…">File typed note</SafeSubmitButton>
    </form>}

    {completed && (undoUntil && !undoExpired
      ? <form action={undoLeadComplete}><input type="hidden" name="leadId" value={leadId} /><SafeSubmitButton className="ops-peel-back" pendingLabel="Undoing…">Undo finish (10 sec)</SafeSubmitButton></form>
      : <span className="ops-done-locked">Undo no longer available</span>)}
  </section>
}
