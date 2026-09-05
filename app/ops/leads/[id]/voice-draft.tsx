"use client"

import { useState } from "react"

// The message box on a late promise, with a button that fills it in the
// owner's voice. Two things it deliberately is not:
//
// - It does not draft on its own. Opening the box costs nothing; the model
//   runs when he asks it to, once, on the promise he is looking at.
// - It does not send. The words land in a box he edits and submits himself.
//   The form around this is the same one that has always sent the text.
//
// The plain sentence stays the starting value, so with no model, a thin voice
// corpus, or JavaScript off, the box is exactly what it was before.
export function LatePromiseMessage({
  leadId,
  commitmentId,
  fallback,
}: {
  leadId: number
  commitmentId: number
  fallback: string
}) {
  const [body, setBody] = useState(fallback)
  const [state, setState] = useState<"idle" | "writing">("idle")
  const [note, setNote] = useState("")

  async function draft() {
    setState("writing")
    setNote("")
    try {
      const response = await fetch("/api/ops/promises/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, commitmentId }),
      })
      const result = await response.json().catch(() => ({})) as { text?: string; error?: string }
      if (!response.ok || !result.text) {
        // The reason is shown, not swallowed. "It didn't work" over a model
        // that said exactly what was wrong is how the last voice bug shipped.
        setNote(result.error || "The draft could not be written. The message below is yours to send as it is.")
        return
      }
      setBody(result.text)
      setNote("Written in your voice. Read it before you send it.")
    } catch {
      setNote("The draft could not be written. The message below is yours to send as it is.")
    } finally {
      setState("idle")
    }
  }

  return <>
    <textarea
      name="body"
      rows={3}
      autoComplete="off"
      value={body}
      onChange={(event) => setBody(event.target.value)}
      aria-label="Message to customer about the delayed promise"
    />
    <button type="button" className="btn btn--sm btn--edge" onClick={draft} disabled={state === "writing"}>
      {state === "writing" ? "Writing..." : "Write it in my voice"}
    </button>
    {note && <p className="t-caption" role="status">{note}</p>}
  </>
}
