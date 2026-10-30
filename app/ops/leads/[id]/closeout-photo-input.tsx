"use client"

import { upload } from "@vercel/blob/client"
import { useEffect, useId, useRef, useState } from "react"
import { offlineRecordingScope, readCurrentVoiceScope } from "../../voice-outbox-client"
import { queuePhotoCapture, readPhotoIntents, savePhotoIntent, type SavedPhotoIntent } from "../../photo-outbox-client"
import { prepareCloseoutImage } from "../../photo-media-client"

const MAX_PHOTO_BYTES = 12 * 1024 * 1024
const RETRY_DELAYS = [30_000, 60_000, 300_000, 900_000, 3_600_000, 14_400_000]
const SAVED_MESSAGE = "Photo saved on this device; will upload when storage is available. Reopen this job to finish filing it."
const UNSAVED_MESSAGE = "Photo not saved yet: device storage is unavailable. Keep this page open; it will retry saving this capture."

export function CloseoutPhotoInput({ leadId, mode, onBusyChange, onUploaded, disabled = false }: {
  leadId: number
  mode: "completion" | "addendum"
  onBusyChange?: (busy: boolean) => void
  onUploaded?: () => void
  disabled?: boolean
}) {
  const instanceId = useId()
  const receiptRef = useRef<HTMLInputElement>(null)
  const inFlightRef = useRef(false)
  const captureRef = useRef(false)
  const rawCaptureRef = useRef<{ file: File; input: HTMLInputElement; scope: string; leadId: number; mode: "completion" | "addendum" } | null>(null)
  const scopeRef = useRef("")
  const contextRef = useRef({ leadId, mode, active: true })
  const callbacksRef = useRef({ onUploaded, onBusyChange })
  const notifiedRef = useRef("")
  const retryRef = useRef<() => void>(() => {})
  const [message, setMessage] = useState("")
  const [progress, setProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState<SavedPhotoIntent | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const [scopeReady, setScopeReady] = useState(false)
  const fragment = mode === "completion" ? "finish-photo" : "done-photo"
  const fieldId = `${fragment}-${instanceId}`

  useEffect(() => { callbacksRef.current = { onUploaded, onBusyChange } }, [onUploaded, onBusyChange])

  function current(intent?: SavedPhotoIntent) {
    const context = contextRef.current
    return context.active && context.leadId === leadId && context.mode === mode
      && (!intent || (intent.leadId === leadId && (intent.mode === mode || (mode === "addendum" && intent.mode === "completion")) && intent.scope === scopeRef.current))
  }

  async function checkReceipt(intent: SavedPhotoIntent) {
    const scope = await readCurrentVoiceScope()
    scopeRef.current = scope
    if (scope !== intent.scope || !current(intent)) throw new Error("The signed-in person or job changed. The photo remains saved for its original job.")
    const query = new URLSearchParams({ uploadId: intent.id, leadId: String(intent.leadId), mode: intent.mode })
    const response = await fetch(`/api/ops/closeout-upload?${query}`, { cache: "no-store", headers: { "X-Voice-Operator-Scope": scope } })
    if (!response.ok) throw new Error("Photo storage is temporarily unavailable.")
    return response.json() as Promise<{ uploadRequired?: boolean; ready?: boolean; attached?: boolean }>
  }

  async function attempt(intent: SavedPhotoIntent, force = false) {
    if (inFlightRef.current || disabled || intent.state === "archived" || (!force && intent.nextAttemptAt > Date.now())) return
    inFlightRef.current = true
    if (current(intent)) { setUploading(true); setProgress(0); callbacksRef.current.onBusyChange?.(true) }
    try {
      let state = await checkReceipt(intent)
      if (!state.ready && state.uploadRequired === true) {
        if (!intent.prepared) {
          const prepared = await prepareCloseoutImage(intent.original, intent.originalName)
          intent = { ...intent, ...prepared, prepared: true }
          // Persist the exact compressed payload before its first upload, too.
          await savePhotoIntent(intent)
        }
        if (!current(intent)) return
        const file = intent.file
        const pathname = `closeouts/${intent.id}-${intent.filename.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "").slice(-120) || "closeout-image"}`
        setMessage("Uploading saved photo…")
        await upload(pathname, file, {
          access: "private",
          handleUploadUrl: "/api/ops/closeout-upload",
          clientPayload: JSON.stringify({ uploadId: intent.id, leadId: intent.leadId, mode: intent.mode, operatorScope: intent.scope, originalName: intent.filename, contentType: intent.contentType, sizeBytes: file.size }),
          contentType: intent.contentType,
          multipart: false,
          onUploadProgress: ({ percentage }) => { if (current(intent)) setProgress(Math.round(percentage)) },
        })
        state = await checkReceipt(intent)
      }
      if (!state.ready) throw new Error("The photo is still awaiting storage confirmation.")
      intent = { ...intent, state: state.attached ? "archived" : "ready", attempts: 0, nextAttemptAt: 0 }
      await savePhotoIntent(intent)
      if (!current(intent)) return
      setPending(state.attached ? null : intent)
      if (receiptRef.current) receiptRef.current.value = state.attached ? "" : intent.id
      setMessage(state.attached ? "Photo already filed with this job. Its original remains saved on this device." : "Photo uploaded and ready to file. Its original remains saved on this device.")
      if (!state.attached && notifiedRef.current !== intent.id) {
        notifiedRef.current = intent.id
        callbacksRef.current.onUploaded?.()
      }
    } catch {
      intent = { ...intent, attempts: intent.attempts + 1, nextAttemptAt: Date.now() + RETRY_DELAYS[Math.min(intent.attempts, RETRY_DELAYS.length - 1)] }
      // The original save remains valid even if writing retry metadata fails.
      await savePhotoIntent(intent).catch(() => undefined)
      if (current(intent)) { setPending(intent); setMessage(SAVED_MESSAGE) }
    } finally {
      inFlightRef.current = false
      if (current()) { setUploading(false); callbacksRef.current.onBusyChange?.(false) }
    }
  }

  useEffect(() => {
    const context = { leadId, mode, active: true }
    contextRef.current = context
    if (receiptRef.current) receiptRef.current.value = ""
    notifiedRef.current = ""
    let timer: number | undefined
    let recovering = false
    const recover = async (force = false) => {
      if (!context.active || disabled || recovering || inFlightRef.current || captureRef.current) return
      recovering = true
      try {
        const scope = await readCurrentVoiceScope()
        if (!context.active) return
        scopeRef.current = scope
        setScopeReady(true)
        const raw = rawCaptureRef.current
        if (raw) {
          if (raw.scope !== scope || raw.leadId !== leadId || raw.mode !== mode) return
          const retained = await queuePhotoCapture(raw.file, raw.scope, raw.leadId, raw.mode)
          raw.input.value = ""
          rawCaptureRef.current = null
          if (!context.active) return
          setUnsaved(false)
          callbacksRef.current.onBusyChange?.(false)
          setPending(retained)
          setMessage(SAVED_MESSAGE)
          await attempt(retained, force)
          return
        }
        // A job may finish while storage is paused. Resume its original
        // completion capture as an addendum without changing the receipt.
        const retained = (await Promise.all([
          readPhotoIntents(scope, leadId, mode),
          mode === "addendum" ? readPhotoIntents(scope, leadId, "completion") : [],
        ])).flat().sort((a, b) => a.createdAt - b.createdAt)[0]
        if (!context.active) return
        setPending(retained ?? null)
        if (retained) {
          if (retained.state === "queued") setMessage(SAVED_MESSAGE)
          await attempt(retained, force)
        }
      } catch (error) {
        // Do not expose an outbox before an authenticated identity is known.
        if (context.active) {
          if (!offlineRecordingScope(error, scopeRef.current)) { scopeRef.current = ""; setScopeReady(false) }
          setPending(null)
          if (rawCaptureRef.current) { setMessage(UNSAVED_MESSAGE); callbacksRef.current.onBusyChange?.(true) }
          if (receiptRef.current) receiptRef.current.value = ""
        }
      } finally { recovering = false }
    }
    retryRef.current = () => { void recover(true) }
    const resume = () => { if (document.visibilityState !== "hidden") void recover() }
    const tick = () => { resume(); if (context.active) timer = window.setTimeout(tick, 30_000) }
    void recover()
    timer = window.setTimeout(tick, 30_000)
    window.addEventListener("online", resume)
    window.addEventListener("focus", resume)
    document.addEventListener("visibilitychange", resume)
    return () => {
      context.active = false
      window.clearTimeout(timer)
      window.removeEventListener("online", resume)
      window.removeEventListener("focus", resume)
      document.removeEventListener("visibilitychange", resume)
      callbacksRef.current.onBusyChange?.(false)
    }
    // The recovery loop reads callbacks through refs and owns this job's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, mode, disabled])

  async function capturePhoto(file: File, input: HTMLInputElement) {
    if (!scopeReady || inFlightRef.current || captureRef.current || rawCaptureRef.current || disabled || (pending && pending.state !== "archived")) return
    if (!file.type.toLowerCase().startsWith("image/") || file.size <= 0 || file.size > MAX_PHOTO_BYTES) { setMessage("Choose an image under 12 MB."); return }
    captureRef.current = true
    let scope: string
    try { scope = await readCurrentVoiceScope() }
    catch (error) {
      const offlineScope = offlineRecordingScope(error, scopeRef.current)
      if (!offlineScope) { captureRef.current = false; setMessage("Photo not saved yet. Keep this page open and reconnect to check your sign-in."); return }
      scope = offlineScope
    }
    scopeRef.current = scope
    if (!current()) { captureRef.current = false; return }
    inFlightRef.current = true
    setUploading(true)
    callbacksRef.current.onBusyChange?.(true)
    let intent: SavedPhotoIntent
    rawCaptureRef.current = { file, input, scope, leadId, mode }
    try {
      intent = await queuePhotoCapture(file, scope, leadId, mode)
      input.value = ""
      rawCaptureRef.current = null
      if (current()) setUnsaved(false)
    } catch {
      if (current()) { setUnsaved(true); setMessage(UNSAVED_MESSAGE) }
      return
    } finally {
      captureRef.current = false
      inFlightRef.current = false
      if (current()) { setUploading(false); callbacksRef.current.onBusyChange?.(Boolean(rawCaptureRef.current)) }
    }
    if (!current(intent)) return
    if (intent.state === "archived") { setMessage("This photo is already filed with this job. Its original remains saved on this device."); return }
    setPending(intent)
    setMessage(SAVED_MESSAGE)
    await attempt(intent, true)
  }

  const canRetry = pending?.leadId === leadId && (pending.mode === mode || (mode === "addendum" && pending.mode === "completion"))
  return <>
    <input ref={receiptRef} type="hidden" name="photoUploadId" />
    <label className="ops-done-photo" htmlFor={fieldId}>
      <span>{!scopeReady ? "Reconnect to enable photo capture" : uploading ? `Uploading photo ${progress}%` : pending ? "Photo saved on this device" : "Add a finished-work photo"}</span>
      <input id={fieldId} data-job-fragment={fragment} type="file" accept="image/*" capture="environment" disabled={!scopeReady || uploading || disabled || unsaved || Boolean(pending)} onChange={event => {
        const file = event.currentTarget.files?.[0]
        if (file) void capturePhoto(file, event.currentTarget)
      }} />
    </label>
    {message && <small className="ops-done-voice-error" aria-live="polite">{message}</small>}
    {canRetry && <button type="button" className="ops-closeout-add" disabled={uploading || disabled} onClick={() => retryRef.current()}>Retry photo</button>}
  </>
}
