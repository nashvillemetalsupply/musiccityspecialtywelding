"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { offlineRecordingScope, readCurrentVoiceScope, scopedVoiceStorageKey, voiceIntentMatchesScope } from "./voice-outbox-client"

type SavedVoiceIntent = { scope?: string; id: string; recoveryKey: string; contentType: string; blob: Blob; archivedAt?: string }
const VOICE_DB = "mcsw-voice-outbox"
const VOICE_STORE = "voice_intents"

function voiceRecoveryMatches(savedKey: string, currentKey: string) {
  return savedKey === currentKey || (/^done:[1-9][0-9]*$/.test(currentKey) && savedKey === currentKey.replace(/^done:/, "closeout:"))
}

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
    transaction.onabort = () => reject(transaction.error || new Error("Voice note could not be saved on this phone."))
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

async function pendingVoiceIntent(scope: string, recoveryKey: string) {
  const db = await voiceDb()
  return new Promise<SavedVoiceIntent | null>((resolve, reject) => {
    const request = db.transaction(VOICE_STORE, "readonly").objectStore(VOICE_STORE).getAll()
    request.onsuccess = () => resolve((request.result as SavedVoiceIntent[]).find((intent) =>
      voiceIntentMatchesScope(intent, scope) && voiceRecoveryMatches(intent.recoveryKey, recoveryKey) && !intent.archivedAt) ?? null)
    request.onerror = () => reject(request.error || new Error("Saved voice notes could not be reopened."))
  }).finally(() => db.close())
}

async function archiveVoiceIntent(intent: SavedVoiceIntent) {
  await saveVoiceIntent({ ...intent, archivedAt: new Date().toISOString() })
}

async function pendingVoiceId(scope: string, recoveryKey: string, key: string) {
  const pending = await pendingVoiceIntent(scope, recoveryKey)
  if (pending) return { id: pending.id, retained: true }
  let pointer: string | null = null
  try { pointer = window.localStorage.getItem(key) } catch { /* Optional legacy pointer. */ }
  if (!pointer) return null
  const pointed = await readVoiceIntent(pointer)
  if (!pointed) return { id: pointer, retained: false }
  if (pointed.archivedAt) return null
  if (!voiceIntentMatchesScope(pointed, scope)) throw new Error("This older voice note is kept here and will not be sent automatically.")
  if (!voiceRecoveryMatches(pointed.recoveryKey, recoveryKey)) throw new Error("This saved note belongs to a different job and has been kept intact.")
  return { id: pointed.id, retained: true }
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
  const [savedPending, setSavedPending] = useState(false)
  const [unsavedCapture, setUnsavedCapture] = useState(false)
  const [retryVersion, setRetryVersion] = useState(0)
  const unsavedRef = useRef<SavedVoiceIntent | null>(null)
  const recoveringRef = useRef(false)
  const deliveredIntentIds = useRef(new Set<string>())
  const captureBusy = checkingCapture || starting || listening || transcribing || unsavedCapture
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
    if (!voiceRecoveryMatches(intent.recoveryKey, recoveryKeyRef.current)) throw new Error("The job changed. Your voice note remains saved with its original job.")
    return fetch("/api/ops/transcribe", {
      method: "POST",
      headers: { "Content-Type": intent.contentType, "X-Voice-Intent-Id": intent.id, "X-Voice-Recovery-Key": intent.recoveryKey, "X-Voice-Operator-Scope": scope },
      body: intent.blob,
    })
  }, [ensureScope])

  const recoverTranscript = useCallback(async (intentId: string, scope: string, isActive: () => boolean = () => mountedRef.current) => {
    const waits = [0, 900, 1600, 2800]
    const saved = await readVoiceIntent(intentId).catch(() => null)
    if (saved?.archivedAt) throw new Error("This voice note has already been recovered. Its recording is archived on this device.")
    if (saved && !voiceIntentMatchesScope(saved, scope)) throw new Error("This older voice note is kept here and will not be sent automatically.")
    const recoveryContext = effectiveRecoveryKey
    if (saved && !voiceRecoveryMatches(saved.recoveryKey, recoveryContext)) throw new Error("This saved note belongs to a different job and has been kept intact.")
    let resubmitted = false
    let serverHasIntent = false
    for (const wait of waits) {
      await new Promise((resolve) => window.setTimeout(resolve, wait))
      if (!isActive()) throw new Error("Voice recovery paused. Your note remains on this device.")
      await ensureScope(scope)
      if (recoveryKeyRef.current !== recoveryContext) throw new Error("The job changed. Your voice note remains saved with its original job.")
      const poll = () => fetch(`/api/ops/transcribe?id=${encodeURIComponent(intentId)}`, { cache: "no-store", headers: { "X-Voice-Operator-Scope": scope } })
      let response = await poll()
      if (response.status === 409) throw new Error("The signed-in person changed. Your note remains saved on this device.")
      let state = await response.json().catch(() => null) as { status?: string; transcript?: string; last_error?: string; uploadRequired?: boolean } | null
      if ((response.status === 404 || (response.ok && state?.uploadRequired === true)) && saved && !resubmitted) {
        try {
          if (!isActive()) throw new Error("Voice recovery paused. Your note remains on this device.")
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
      ? "That voice note never reached the shop. Saved on this device; will upload when storage is available."
      : "That recording has not reached storage. Try again from the device that recorded it.")
    throw new Error("Your voice note is safely filed. MCSW Jobs will finish it in the background.")
  }, [ensureScope, uploadSavedVoice, effectiveRecoveryKey])

  const applyTranscript = useCallback(async (transcript: string, intentId: string, scope: string, key: string) => {
    await ensureScope(scope)
    const saved = await readVoiceIntent(intentId).catch(() => null)
    if (!mountedRef.current || scopeRef.current !== scope || key !== scopedVoiceStorageKey(scope, recoveryKeyRef.current)
      || saved?.archivedAt || (saved && (!voiceIntentMatchesScope(saved, scope) || !voiceRecoveryMatches(saved.recoveryKey, recoveryKeyRef.current)))) return
    const deliveryKey = `${scope}:${intentId}`
    if (!deliveredIntentIds.current.has(deliveryKey)) {
      transcriptHandler.current(transcript, intentId)
      deliveredIntentIds.current.add(deliveryKey)
    }
    if (saved && voiceIntentMatchesScope(saved, scope)) await archiveVoiceIntent(saved)
    try { if (window.localStorage.getItem(key) === intentId) window.localStorage.setItem(key, "") } catch { /* The retained record is already archived in IndexedDB. */ }
    setSavedPending(false)
    navigator.vibrate?.(24)
  }, [ensureScope])

  useEffect(() => {
    if (!available || !voiceScope || !storageKey) return
    let active = true
    let delay = 30000
    let timer: number
    const retry = async () => {
      if (!active) return
      if (recoveringRef.current || recorderRef.current || document.visibilityState === "hidden") {
        timer = window.setTimeout(() => { void retry() }, delay)
        return
      }
      recoveringRef.current = true
      let pending: { id: string; retained: boolean } | null = null
      try {
        const volatile = unsavedRef.current
        if (volatile && voiceIntentMatchesScope(volatile, voiceScope) && volatile.recoveryKey === effectiveRecoveryKey) {
          await saveVoiceIntent(volatile)
          unsavedRef.current = null
          if (mountedRef.current) setUnsavedCapture(false)
        }
        pending = await pendingVoiceId(voiceScope, effectiveRecoveryKey, storageKey)
        // Legacy keys never establish who recorded the blob. Keep them intact.
        try {
          if (window.localStorage.getItem(legacyStorageKey)) errorHandler.current?.("An older voice note is kept here and will not be sent automatically.")
        } catch { /* A missing localStorage pointer cannot hide durable bytes. */ }
        if (!pending || !active) return
        setSavedPending(pending.retained)
        setTranscribing(true)
        const transcript = await recoverTranscript(pending.id, voiceScope, () => active)
        if (active) await applyTranscript(transcript, pending.id, voiceScope, storageKey)
      } catch (error) {
        if (active) errorHandler.current?.(unsavedRef.current
          ? "Voice note is not saved yet. Keep this page open; local saving will retry automatically."
          : pending?.retained ? `Saved on this device; will upload when storage is available. ${error instanceof Error ? error.message : ""}`
          : error instanceof Error ? error.message : "Saved voice notes could not be reopened.")
      } finally {
        recoveringRef.current = false
        if (active) {
          setTranscribing(false)
          timer = window.setTimeout(() => { void retry() }, delay)
          delay = Math.min(delay * 2, 15 * 60 * 1000)
        }
      }
    }
    const wake = () => {
      window.clearTimeout(timer)
      delay = 30000
      void retry()
    }
    timer = window.setTimeout(() => { void retry() }, 0)
    window.addEventListener("online", wake)
    window.addEventListener("focus", wake)
    document.addEventListener("visibilitychange", wake)
    return () => { active = false; window.clearTimeout(timer); window.removeEventListener("online", wake); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake) }
  }, [available, voiceScope, recoverTranscript, applyTranscript, storageKey, legacyStorageKey, effectiveRecoveryKey, retryVersion])

  async function startRecording() {
    if (!available || disabled || transcribing || recorderRef.current || recoveringRef.current) return
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
    if (unsavedRef.current) { setRetryVersion((value) => value + 1); report("Voice note is not saved yet. Keep this page open; local saving will retry automatically."); return }
    const pending = await pendingVoiceId(scope, effectiveRecoveryKey, key)
    if (!pressedRef.current || !mountedRef.current || captureRequest !== captureRequestRef.current) return
    const pendingId = pending?.id
    if (pendingId) {
      if (recoveringRef.current) return
      recoveringRef.current = true
      setSavedPending(pending.retained)
      setTranscribing(true)
      try {
        const transcript = await recoverTranscript(pendingId, scope)
        await applyTranscript(transcript, pendingId, scope, key)
      } catch (error) {
        report(error instanceof Error ? error.message : "The saved voice note is still waiting on this phone.")
      } finally {
        recoveringRef.current = false
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      if (!pressedRef.current || !mountedRef.current || captureRequest !== captureRequestRef.current || scopeRef.current !== scope || recoveryKeyRef.current !== effectiveRecoveryKey) {
        stream.getTracks().forEach((track) => track.stop())
        if (mountedRef.current) setStarting(false)
        return
      }
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000 })
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
        recoveringRef.current = true
        if (mountedRef.current) setTranscribing(true)
        const clientIntentId = crypto.randomUUID()
        const intent = { id: clientIntentId, scope, recoveryKey: effectiveRecoveryKey, contentType: blob.type, blob }
        unsavedRef.current = intent
        if (mountedRef.current) setUnsavedCapture(true)
        let persisted = false
        try {
          // Persist under the recording identity even if the route was closed.
          await saveVoiceIntent(intent)
          persisted = true
          unsavedRef.current = null
          if (mountedRef.current) setUnsavedCapture(false)
          try { window.localStorage.setItem(key, clientIntentId) } catch { /* Recovery discovers IndexedDB directly. */ }
          if (mountedRef.current) setSavedPending(true)
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
          report(persisted ? `Saved on this device; will upload when storage is available. ${detail}` : "Voice note is not saved yet. Keep this page open; local saving will retry automatically.")
        } finally {
          recoveringRef.current = false
          if (mountedRef.current) { setTranscribing(false); setRetryVersion((value) => value + 1) }
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
    } catch (error) {
      report(error instanceof Error ? error.message : "Voice could not be saved on this device. Keep this page open.")
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
        : savedPending ? "Saved on this device; will upload. Activate to retry."
        : `${idleLabel}. Activate to start, then activate again to stop.`}
    title={!available ? unavailableLabel : undefined}
  >{!available ? unavailableLabel : scopeLoading ? "Checking sign-in..." : !voiceScope ? "Retry voice connection" : transcribing ? "Printing words…" : listening ? "Release to use it" : starting ? "Opening microphone…" : savedPending ? "Saved; will upload" : idleLabel}</button>
}
