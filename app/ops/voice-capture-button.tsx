"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type SavedVoiceIntent = { id: string; recoveryKey: string; contentType: string; blob: Blob }
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
  available: boolean
  disabled?: boolean
  className?: string
  idleLabel?: string
  unavailableLabel?: string
  recoveryKey?: string
}) {
  const [listening, setListening] = useState(false)
  const [starting, setStarting] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const pressedRef = useRef(false)
  const transcriptHandler = useRef(onTranscript)
  const errorHandler = useRef(onError)
  const effectiveRecoveryKey = recoveryKey === "voice" ? (className || idleLabel) : recoveryKey
  const storageKey = `mcsw-voice:${effectiveRecoveryKey.replace(/[^a-z0-9:_-]/gi, "-")}`

  useEffect(() => {
    transcriptHandler.current = onTranscript
    errorHandler.current = onError
  }, [onError, onTranscript])

  useEffect(() => () => {
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  function report(message: string) {
    onError?.(message)
  }

  const uploadSavedVoice = useCallback(async (intent: SavedVoiceIntent) => {
    return fetch("/api/ops/transcribe", {
      method: "POST",
      headers: { "Content-Type": intent.contentType, "X-Voice-Intent-Id": intent.id, "X-Voice-Recovery-Key": intent.recoveryKey },
      body: intent.blob,
    })
  }, [])

  const recoverTranscript = useCallback(async (intentId: string) => {
    const waits = [900, 1600, 2800, 4800, 8000, 15000, 30000, 45000]
    const saved = await readVoiceIntent(intentId).catch(() => null)
    let resubmitted = false
    let serverHasIntent = false
    for (const wait of waits) {
      await new Promise((resolve) => window.setTimeout(resolve, wait))
      let response = await fetch(`/api/ops/transcribe?id=${encodeURIComponent(intentId)}`, { cache: "no-store" })
      if (response.status === 404 && saved && !resubmitted) {
        try {
          const upload = await uploadSavedVoice(saved)
          resubmitted = true
          const uploadState = await upload.json().catch(() => null) as { transcript?: string } | null
          if (upload.ok && uploadState?.transcript) return uploadState.transcript
          response = await fetch(`/api/ops/transcribe?id=${encodeURIComponent(intentId)}`, { cache: "no-store" })
        } catch {
          resubmitted = false
          continue
        }
      }
      const state = await response.json().catch(() => null) as { status?: string; transcript?: string; last_error?: string } | null
      if (response.ok) serverHasIntent = true
      if (response.ok && state?.status === "completed" && state.transcript) return state.transcript
      if (state?.status === "failed" && wait === waits.at(-1)) throw new Error(state.last_error || "The saved voice note could not be transcribed yet.")
    }
    if (!serverHasIntent) throw new Error("That voice note never reached the shop. It is still saved on this phone; reconnect and try again.")
    throw new Error("Your voice note is safely filed. MCSW Jobs will finish it in the background.")
  }, [uploadSavedVoice])

  useEffect(() => {
    if (!available) return
    const pendingId = window.localStorage.getItem(storageKey)
    if (!pendingId) return
    let active = true
    const kickoff = window.setTimeout(() => {
      if (!active) return
      setTranscribing(true)
      void recoverTranscript(pendingId).then(async (transcript) => {
        if (!active) return
        window.localStorage.removeItem(storageKey)
        await deleteVoiceIntent(pendingId).catch(() => undefined)
        transcriptHandler.current(transcript, pendingId)
        navigator.vibrate?.(24)
      }).catch((error) => {
        if (active) errorHandler.current?.(error instanceof Error ? error.message : "Your saved voice note is still being processed.")
      }).finally(() => { if (active) setTranscribing(false) })
    }, 0)
    return () => { active = false; window.clearTimeout(kickoff) }
  }, [available, recoverTranscript, storageKey])

  async function startRecording() {
    if (!available || disabled || transcribing || recorderRef.current) return
    const pendingId = window.localStorage.getItem(storageKey)
    if (pendingId) {
      setTranscribing(true)
      try {
        const transcript = await recoverTranscript(pendingId)
        window.localStorage.removeItem(storageKey)
        await deleteVoiceIntent(pendingId).catch(() => undefined)
        onTranscript(transcript, pendingId)
        navigator.vibrate?.(24)
      } catch (error) {
        report(error instanceof Error ? error.message : "The saved voice note is still waiting on this phone.")
      } finally {
        setTranscribing(false)
      }
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      report("This phone does not expose its microphone to the browser.")
      return
    }
    report("")
    try {
      setStarting(true)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!pressedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        setStarting(false)
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
        setListening(false)
        if (!blob.size) return
        onAudio?.(blob)
        setTranscribing(true)
        try {
          const clientIntentId = crypto.randomUUID()
          await saveVoiceIntent({ id: clientIntentId, recoveryKey: effectiveRecoveryKey, contentType: blob.type, blob })
          window.localStorage.setItem(storageKey, clientIntentId)
          let response: Response
          try {
            response = await uploadSavedVoice({ id: clientIntentId, recoveryKey: effectiveRecoveryKey, contentType: blob.type, blob })
          } catch {
            const transcript = await recoverTranscript(clientIntentId)
            window.localStorage.removeItem(storageKey)
            await deleteVoiceIntent(clientIntentId).catch(() => undefined)
            onTranscript(transcript, clientIntentId)
            navigator.vibrate?.(24)
            return
          }
          const data = await response.json() as { transcript?: string; error?: string; intentId?: string; retryable?: boolean }
          if (data.intentId && data.retryable) window.localStorage.setItem(storageKey, data.intentId)
          const transcript = response.ok && data.transcript
            ? data.transcript
            : data.intentId && data.retryable
              ? await recoverTranscript(data.intentId)
              : ""
          if (!transcript) throw new Error(data.error || "Could not catch that voice note.")
          window.localStorage.removeItem(storageKey)
          await deleteVoiceIntent(data.intentId || clientIntentId).catch(() => undefined)
          onTranscript(transcript, data.intentId || clientIntentId)
          navigator.vibrate?.(24)
        } catch (error) {
          report(error instanceof Error ? error.message : "Voice transcription failed.")
        } finally {
          setTranscribing(false)
        }
      }
      recorder.start()
      setStarting(false)
      setListening(true)
      navigator.vibrate?.(12)
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      setStarting(false)
      setListening(false)
      report(error instanceof Error ? error.message : "Microphone permission was not granted.")
    }
  }

  function pressStart() {
    pressedRef.current = true
    void startRecording()
  }

  function pressEnd() {
    pressedRef.current = false
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
    disabled={!available || disabled || transcribing}
    aria-pressed={available && (listening || starting)}
    aria-label={!available
      ? unavailableLabel
      : transcribing
        ? "Transcribing voice note"
      : listening
        ? "Recording voice note. Activate to stop."
        : starting
          ? "Opening the microphone. Activate to cancel."
        : `${idleLabel}. Activate to start, then activate again to stop.`}
    title={!available ? unavailableLabel : undefined}
  >{!available ? unavailableLabel : transcribing ? "Printing words…" : listening ? "Release to use it" : starting ? "Opening microphone…" : idleLabel}</button>
}
