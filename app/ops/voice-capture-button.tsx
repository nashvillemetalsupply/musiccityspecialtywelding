"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { offlineRecordingScope, readCurrentVoiceScope, scopedVoiceStorageKey, voiceIntentMatchesScope } from "./voice-outbox-client"

type SavedVoiceIntent = { scope?: string; id: string; recoveryKey: string; contentType: string; blob: Blob }
const VOICE_DB = "mcsw-voice-outbox"
const VOICE_STORE = "voice_intents"

function voiceDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(VOICE_DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(VOICE_STORE)) request.result.createObjectStore(VOICE_STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Voice outbox could not open."))
  })
}

async function saveVoiceIntent(intent: SavedVoiceIntent) {
  const db = await voiceDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(VOICE_STORE, "readwrite")
    transaction.objectStore(VOICE_STORE).put(intent)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error("Voice note could not be saved on this phone."))
  }).finally(() => db.close())
}

async function readVoiceIntent(id: string) {
  const db = await voiceDb()
  return new Promise<SavedVoiceIntent | null>((resolve, reject) => {
    const request = db.transaction(VOICE_STORE, "readonly").objectStore(VOICE_STORE).get(id)
    request.onsuccess = () => resolve((request.result as SavedVoiceIntent | undefined) ?? null)
    request.onerror = () => reject(request.error || new Error("Saved voice note could not be reopened."))
  }).finally(() => db.close())
}

async function deleteVoiceIntent(id: string) {
  const db = await voiceDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(VOICE_STORE, "readwrite")
    transaction.objectStore(VOICE_STORE).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error("Voice outbox could not be cleared."))
  }).finally(() => db.close())
}

export function VoiceCaptureButton({
  onTranscript,
  onError,
  onAudio,
  onBusyChange,
  available,
  disabled = false,
  className = "",
  idleLabel = "Hold to talk",
  unavailableLabel = "Voice not set up",
  recoveryKey = "voice",
}: {
  onTranscript: (transcript: string, intentId?: string) => void
  onError?: (message: string) => void
  onAudio?: (blob: Blob) => void
  onBusyChange?: (busy: boolean) => void
  available: boolean
  disabled?: boolean
  className?: string
  idleLabel?: string
  unavailableLabel?: string
  recoveryKey?: string
}) {
  const [voiceScope, setVoiceScope] = useState("")
  const [scopeLoading, setScopeLoading] = useState(available)
  const mountedRef = useRef(true)
  const scopeRef = useRef("")
  const scopeRequestRef = useRef(0)
  const [listening, setListening] = useState(false)
  const [starting, setStarting] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [checkingCapture, setCheckingCapture] = useState(false)
  const captureBusy = checkingCapture || starting || listening || transcribing
  useEffect(() => { onBusyChange?.(captureBusy) }, [captureBusy, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const pressedRef = useRef(false)
  const captureRequestRef = useRef(0)
  const transcriptHandler = useRef(onTranscript)
  const errorHandler = useRef(onError)
  const effectiveRecoveryKey = recoveryKey === "voice" ? (className || idleLabel) : recoveryKey
  const recoveryKeyRef = useRef(effectiveRecoveryKey)
  const legacyStorageKey = `mcsw-voice:${effectiveRecoveryKey.replace(/[^a-z0-9:_-]/gi, "-")}`
  const storageKey = voiceScope ? scopedVoiceStorageKey(voiceScope, effectiveRecoveryKey) : ""

  useEffect(() => {
    transcriptHandler.current = onTranscript
    errorHandler.current = onError
    recoveryKeyRef.current = effectiveRecoveryKey
  }, [onError, onTranscript, effectiveRecoveryKey])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      scopeRequestRef.current += 1
      pressedRef.current = false
      if (recorderRef.current?.state === "recording") recorderRef.current.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  function report(message: string) {
    if (mountedRef.current) errorHandler.current?.(message)
  }

  const ensureScope = useCallback(async (expected?: string) => {
    const requestId = ++scopeRequestRef.current
    let current: string
    try { current = await readCurrentVoiceScope() }
    catch (error) {
      if (mountedRef.current && requestId === scopeRequestRef.current) {
        if (!offlineRecordingScope(error, scopeRef.current)) {
          scopeRef.current = ""
          setVoiceScope("")
        }
      }
      throw error
    }
    if (!mountedRef.current || requestId !== scopeRequestRef.current) throw new Error("Voice identity changed. Your note remains saved on this device.")
    if (scopeRef.current && scopeRef.current !== current) {
      pressedRef.current = false
      if (recorderRef.current?.state === "recording") recorderRef.current.stop()
      setTranscribing(false)
    }
    scopeRef.current = current
    setVoiceScope(current)
    if (expected && current !== expected) throw new Error("The signed-in person changed. Your note remains saved for the person who recorded it.")
    return current
  }, [])

  useEffect(() => {
    if (!available) return
    let active = true
    const refresh = () => {
      if (document.visibilityState === "hidden") return
      void ensureScope().catch(() => undefined).finally(() => { if (active) setScopeLoading(false) })
    }
    refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener("pageshow", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      active = false
      window.removeEventListener("focus", refresh)
      window.removeEventListener("pageshow", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [available, ensureScope])

  const uploadSavedVoice = useCallback(async (intent: SavedVoiceIntent, scope: string) => {
    if (!voiceIntentMatchesScope(intent, scope)) throw new Error("This older voice note is kept here and will not be sent automatically.")
    await ensureScope(scope)
    if (intent.recoveryKey !== recoveryKeyRef.current) throw new Error("The job changed. Your voice note remains saved with its original job.")
    return fetch("/api/ops/transcribe", {
      method: "POST",
      headers: { "Content-Type": intent.contentType, "X-Voice-Intent-Id": intent.id, "X-Voice-Recovery-Key": intent.recoveryKey, "X-Voice-Operator-Scope": scope },
      body: intent.blob,
    })
  }, [ensureScope])

  const recoverTranscript = useCallback(async (intentId: string, scope: string) => {
    const waits = [900, 1600, 2800, 4800, 8000, 15000, 30000, 45000]
    const saved = await readVoiceIntent(intentId).catch(() => null)
    if (saved && !voiceIntentMatchesScope(saved, scope)) throw new Error("This older voice note is kept here and will not be sent automatically.")
    const recoveryContext = effectiveRecoveryKey
    if (saved && saved.recoveryKey !== recoveryContext) throw new Error("This saved note belongs to a different job and has been kept intact.")
    let resubmitted = false
    let serverHasIntent = false
    for (const wait of waits) {
      await new Promise((resolve) => window.setTimeout(resolve, wait))
      await ensureScope(scope)
      if (recoveryKeyRef.current !== recoveryContext) throw new Error("The job changed. Your voice note remains saved with its original job.")
      const poll = () => fetch(`/api/ops/transcribe?id=${encodeURIComponent(intentId)}`, { cache: "no-store", headers: { "X-Voice-Operator-Scope": scope } })
      let response = await poll()
      if (response.status === 409) throw new Error("The signed-in person changed. Your note remains saved on this device.")
      let state = await response.json().catch(() => null) as { status?: string; transcript?: string; last_error?: string; uploadRequired?: boolean } | null
      if ((response.status === 404 || (response.ok && state?.uploadRequired === true)) && saved && !resubmitted) {
        try {
          const upload = await uploadSavedVoice(saved, scope)
          resubmitted = true
          const uploadState = await upload.json().catch(() => null) as { transcript?: string } | null
          if (upload.ok && uploadState?.transcript) return uploadState.transcript
          response = await poll()
          state = await response.json().catch(() => null)
        } catch (error) {
          if (scopeRef.current !== scope || !mountedRef.current) throw error
          resubmitted = false
          continue
        }
      }
      if (response.ok && state?.uploadRequired !== true) serverHasIntent = true
      if (response.ok && state?.status === "completed" && state.transcript) return state.transcript
      if (state?.status === "failed" && wait === waits.at(-1)) throw new Error(state.last_error || "The saved voice note could not be transcribed yet.")
    }
    if (!serverHasIntent) throw new Error(saved
      ? "That voice note never reached the shop. It is still saved on this phone; reconnect and try again."
      : "That recording has not reached storage. Try again from the device that recorded it.")
    throw new Error("Your voice note is safely filed. MCSW Jobs will finish it in the background.")
  }, [ensureScope, uploadSavedVoice, effectiveRecoveryKey])

  const applyTranscript = useCallback(async (transcript: string, intentId: string, scope: string, key: string) => {
    await ensureScope(scope)
    const saved = await readVoiceIntent(intentId).catch(() => null)
    if (!mountedRef.current || scopeRef.current !== scope || key !== scopedVoiceStorageKey(scope, recoveryKeyRef.current)
      || (saved && (!voiceIntentMatchesScope(saved, scope) || saved.recoveryKey !== recoveryKeyRef.current))) return
    transcriptHandler.current(transcript, intentId)
    if (window.localStorage.getItem(key) === intentId) window.localStorage.removeItem(key)
    if (saved && voiceIntentMatchesScope(saved, scope)) await deleteVoiceIntent(intentId).catch(() => undefined)
    navigator.vibrate?.(24)
  }, [ensureScope])

  useEffect(() => {
    if (!available || !voiceScope || !storageKey) return
    let active = true
    const kickoff = window.setTimeout(() => {
      if (!active) return
      // Legacy keys never establish who recorded the blob. Keep them intact.
      let pendingId: string | null
      try {
        if (window.localStorage.getItem(legacyStorageKey)) errorHandler.current?.("An older voice note is kept here and will not be sent automatically.")
        pendingId = window.localStorage.getItem(storageKey)
      } catch {
        errorHandler.current?.("This browser cannot access saved voice notes. Use a regular browser window or type your note.")
        return
      }
      if (!pendingId) return
      setTranscribing(true)
      void recoverTranscript(pendingId, voiceScope).then(async (transcript) => {
        if (active) await applyTranscript(transcript, pendingId, voiceScope, storageKey)
      }).catch((error) => {
        if (active) errorHandler.current?.(error instanceof Error ? error.message : "Your saved voice note is still being processed.")
      }).finally(() => { if (active) setTranscribing(false) })
    }, 0)
    return () => { active = false; window.clearTimeout(kickoff) }
  }, [available, voiceScope, recoverTranscript, applyTranscript, storageKey, legacyStorageKey])

  async function startRecording() {
    if (!available || disabled || transcribing || recorderRef.current) return
    const captureRequest = ++captureRequestRef.current
    setCheckingCapture(true)
    try {
    let scope: string
    report("")
    try { scope = await ensureScope() }
    catch (error) {
      if (captureRequest !== captureRequestRef.current) return
      const offlineScope = offlineRecordingScope(error, scopeRef.current)
      if (!offlineScope || !mountedRef.current) { report(error instanceof Error ? error.message : "Reconnect before using voice."); return }
      scope = offlineScope
      report("Offline: this recording will stay on this device for the person last signed in. Reconnect to transcribe it.")
    }
    if (!pressedRef.current || !mountedRef.current || captureRequest !== captureRequestRef.current) return
    const key = scopedVoiceStorageKey(scope, effectiveRecoveryKey)
    let pendingId: string | null
    try { pendingId = window.localStorage.getItem(key) }
    catch { report("This browser cannot save voice notes. Use a regular browser window or type your note."); return }
    if (pendingId) {
      setTranscribing(true)
      try {
        const transcript = await recoverTranscript(pendingId, scope)
        await applyTranscript(transcript, pendingId, scope, key)
      } catch (error) {
        report(error instanceof Error ? error.message : "The saved voice note is still waiting on this phone.")
      } finally {
        if (mountedRef.current) setTranscribing(false)
      }
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      report("This phone does not expose its microphone to the browser.")
      return
    }
    try {
      setStarting(true)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!pressedRef.current || !mountedRef.current || captureRequest !== captureRequestRef.current || scopeRef.current !== scope || recoveryKeyRef.current !== effectiveRecoveryKey) {
        stream.getTracks().forEach((track) => track.stop())
        if (mountedRef.current) setStarting(false)
        return
      }
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      streamRef.current = stream
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        recorderRef.current = null
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (mountedRef.current) setListening(false)
        if (!blob.size) return
        if (mountedRef.current) setTranscribing(true)
        const clientIntentId = crypto.randomUUID()
        const intent = { id: clientIntentId, scope, recoveryKey: effectiveRecoveryKey, contentType: blob.type, blob }
        let persisted = false
        try {
          // Persist under the recording identity even if the route was closed.
          await saveVoiceIntent(intent)
          window.localStorage.setItem(key, clientIntentId)
          persisted = true
          if (!mountedRef.current || scopeRef.current !== scope || recoveryKeyRef.current !== effectiveRecoveryKey) return
          await ensureScope(scope)
          if (recoveryKeyRef.current !== effectiveRecoveryKey) return
          onAudio?.(blob)
          let response: Response
          try { response = await uploadSavedVoice(intent, scope) }
          catch {
            const transcript = await recoverTranscript(clientIntentId, scope)
            await applyTranscript(transcript, clientIntentId, scope, key)
            return
          }
          const data = await response.json() as { transcript?: string; error?: string; intentId?: string; retryable?: boolean }
          const transcript = response.ok && data.transcript
            ? data.transcript
            : data.retryable
              ? await recoverTranscript(clientIntentId, scope)
              : ""
          if (!transcript) throw new Error(data.error || "Could not catch that voice note.")
          await applyTranscript(transcript, clientIntentId, scope, key)
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Reconnect to transcribe it."
          report(persisted ? `Your voice note is saved on this device for the person who recorded it. ${detail}` : detail)
        } finally {
          if (mountedRef.current) setTranscribing(false)
        }
      }
      recorder.start()
      setStarting(false)
      setListening(true)
      navigator.vibrate?.(12)
    } catch (error) {
      if (captureRequest !== captureRequestRef.current) return
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      if (mountedRef.current) { setStarting(false); setListening(false) }
      report(error instanceof Error ? error.message : "Microphone permission was not granted.")
    }
    } finally {
      if (mountedRef.current && captureRequest === captureRequestRef.current) setCheckingCapture(false)
    }
  }

  function pressStart() {
    pressedRef.current = true
    void startRecording()
  }

  function pressEnd() {
    pressedRef.current = false
    captureRequestRef.current += 1
    setCheckingCapture(false)
    setStarting(false)
    if (recorderRef.current?.state === "recording") recorderRef.current.stop()
  }

  return <button
    type="button"
    className={`${className}${listening ? " is-listening" : ""}`}
    onPointerDown={pressStart}
    onPointerUp={pressEnd}
    onPointerCancel={pressEnd}
    onPointerLeave={pressEnd}
    onClick={(event) => {
      // Pointer interaction uses hold/release. Assistive virtual activation
      // dispatches a zero-detail click, so give it an explicit start/stop path.
      if (event.detail !== 0) return
      if (pressedRef.current || listening || recorderRef.current?.state === "recording") pressEnd()
      else pressStart()
    }}
    onBlur={() => { if (pressedRef.current) pressEnd() }}
    onKeyDown={(event) => {
      if (!event.repeat && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault()
        pressStart()
      }
    }}
    onKeyUp={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        pressEnd()
      }
    }}
    onContextMenu={(event) => event.preventDefault()}
    disabled={!available || disabled || transcribing || scopeLoading}
    aria-pressed={available && (listening || starting)}
    aria-label={!available
      ? unavailableLabel
      : scopeLoading
        ? "Checking voice sign-in"
      : !voiceScope
        ? "Retry voice connection"
      : transcribing
        ? "Transcribing voice note"
      : listening
        ? "Recording voice note. Activate to stop."
        : starting
          ? "Opening the microphone. Activate to cancel."
        : `${idleLabel}. Activate to start, then activate again to stop.`}
    title={!available ? unavailableLabel : undefined}
  >{!available ? unavailableLabel : scopeLoading ? "Checking sign-in..." : !voiceScope ? "Retry voice connection" : transcribing ? "Printing words…" : listening ? "Release to use it" : starting ? "Opening microphone…" : idleLabel}</button>
}
