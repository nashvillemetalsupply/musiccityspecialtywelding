"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { OwnerVoiceSnapshot } from "@/lib/voice-of-character"

// Below this the profile refuses to draft, and the strip says so instead of
// offering a button that only ever returns an apology. It is the same floor
// `voiceProfileIsUsable` enforces on the server.
const VOICE_FLOOR = 8

export function VoicePreview({ voice }: { voice: OwnerVoiceSnapshot | null }) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState<"" | "preview" | "learn">("")
  const audio = useRef<HTMLAudioElement | null>(null)
  const spoken = useRef(0)
  const lineCount = voice?.lineCount ?? 0
  const sourceCount = voice?.sourceCount ?? 0
  const name = voice?.displayName || "the owner"

  // The browser's own voice. It is nobody's clone and it is free, which is what
  // makes it the right floor to fall to.
  function speakLine(line: string) {
    if (!line || typeof window === "undefined" || !window.speechSynthesis) return
    setText(line)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(line))
  }

  // Rotates through his samples so pressing twice does not replay one sentence,
  // and so the corpus growing is audible: new calls put new lines in here.
  function speakHisOwnWords() {
    const samples = voice?.samples ?? []
    if (!samples.length) return
    const line = samples[spoken.current % samples.length]
    spoken.current += 1
    speakLine(line)
  }

  async function play() {
    setBusy("preview")
    setNote("")
    try {
      const response = await fetch("/api/ops/voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "voicemail" }),
      })
      const result = await response.json().catch(() => ({})) as
        { text?: string; audio?: string; audioType?: string; error?: string; drafter?: string }
      // A draft that came back without audio is still the thing worth hearing:
      // his words, newly written. The browser reads them, and the note says so
      // rather than letting a stock voice pass for one the shop paid for.
      if (response.ok && result.text && !result.audio) {
        setNote(`Written by ${result.drafter ?? "the model"}, read by your browser — no speech provider on this plan.`)
        speakLine(result.text)
        return
      }
      if (!response.ok || !result.audio) {
        setNote(result.error ?? "The preview could not be built.")
        // The gateway drafting his voice is the nice version. The honest one
        // needs no gateway at all: his own recorded sentence, read by the
        // browser. It costs nothing, works on any plan, and is the half of the
        // preview that was never invented in the first place.
        speakHisOwnWords()
        return
      }
      setText(result.text ?? "")
      // Played straight from the response. Nothing is stored: the preview is
      // his current voice, and the point of it is that the next one differs.
      audio.current?.pause()
      const player = new Audio(`data:${result.audioType || "audio/mpeg"};base64,${result.audio}`)
      audio.current = player
      await player.play()
    } catch {
      setNote("The preview could not be built.")
      speakHisOwnWords()
    } finally {
      setBusy("")
    }
  }

  // The sweep over every call and note the shop already holds. It is what makes
  // the count jump the first time, and it is safe to press twice.
  async function learn() {
    setBusy("learn")
    setNote("")
    try {
      const response = await fetch("/api/ops/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rebuild" }),
      })
      const result = await response.json() as { profile?: { lineCount?: number; sourceCount?: number }; error?: string }
      if (!response.ok) {
        setNote(result.error ?? "The sweep did not finish.")
        return
      }
      const lines = result.profile?.lineCount ?? 0
      setNote(`${lines} of his own line${lines === 1 ? "" : "s"} on record.`)
      // The count and the button state are server-rendered from the profile the
      // sweep just replaced. Without this the strip still reads "nothing on
      // record" over a corpus of three hundred lines, and tells the owner to go
      // reload the page himself.
      router.refresh()
    } catch {
      setNote("The sweep did not finish.")
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="voice-strip">
      <div>
        <p className="t-label">Voice of character</p>
        <p className="t-caption">
          {lineCount === 0
            ? `Nothing of ${name} on record yet. Every call he takes adds to it.`
            : `Built from ${lineCount} of his own line${lineCount === 1 ? "" : "s"} across ${sourceCount} call${sourceCount === 1 ? "" : "s"} and note${sourceCount === 1 ? "" : "s"}. It moves closer with every call.`}
        </p>
        {text && <p className="voice-said">&ldquo;{text}&rdquo;</p>}
        {note && <p className="t-caption">{note}</p>}
      </div>
      <span className="end">
        <button className="btn btn--sm btn--edge" type="button" onClick={learn} disabled={busy !== ""}>
          {busy === "learn" ? "Reading…" : "Learn from every call"}
        </button>
        <button className="btn btn--sm btn--go" type="button" onClick={play} disabled={busy !== "" || !voice?.usable}>
          {busy === "preview" ? "Writing…" : voice?.usable ? "Hear it now" : `Needs ${VOICE_FLOOR - lineCount} more lines`}
        </button>
      </span>
    </div>
  )
}
