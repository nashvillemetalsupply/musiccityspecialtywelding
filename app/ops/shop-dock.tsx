"use client"

import { useEffect, useRef, useState } from "react"
import { shopEventLabel, withoutEvidenceMarkers } from "@/lib/shop-language"
import { VoiceCaptureButton } from "./voice-capture-button"

type Receipt = { id: number; occurred_at: string; kind: string; lead_id: number | null; body: string }
type HandsetSlip = { id: number; question: string; answer: string; receipt_ids: number[]; created_at: string }

export function ShopDock({ voiceReady }: { voiceReady: boolean }) {
  const [open, setOpen] = useState<"handset" | "radio" | null>(null)
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [slips, setSlips] = useState<HandsetSlip[]>([])
  const [working, setWorking] = useState(false)
  const [speak, setSpeak] = useState(true)
  const [brief, setBrief] = useState("")
  const [briefAudio, setBriefAudio] = useState("")
  const [daySheet, setDaySheet] = useState<Array<{ label: string; url: string }>>([])
  const [answerStatus, setAnswerStatus] = useState("")
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const handsetTriggerRef = useRef<HTMLButtonElement | null>(null)
  const radioTriggerRef = useRef<HTMLButtonElement | null>(null)
  const questionRef = useRef<HTMLInputElement | null>(null)
  const radioHeadingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    void fetch("/api/ops/handset-slips").then((response) => response.ok ? response.json() : { slips: [] }).then((data) => setSlips(Array.isArray(data.slips) ? data.slips : [])).catch(() => undefined)
    const hashTimer = window.setTimeout(() => {
      if (window.location.hash === "#handset") setOpen("handset")
      if (window.location.hash === "#radio") {
        setOpen("radio")
        void fetch("/api/ops/brief/latest").then((response) => response.json()).then((data) => {
          setBrief(data.brief?.body || "The Morning Brief is not ready yet.")
          setBriefAudio(data.audioUrl || "")
          setDaySheet(Array.isArray(data.daySheet) ? data.daySheet : [])
        }).catch(() => setBrief("The Morning Brief could not load. Try again."))
      }
    }, 0)
    return () => { window.clearTimeout(hashTimer); audioRef.current?.pause(); if ("speechSynthesis" in window) speechSynthesis.cancel() }
  }, [])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      if (open === "handset") questionRef.current?.focus()
      else radioHeadingRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  function closePanel(panel = open) {
    if (!panel) return
    audioRef.current?.pause()
    if ("speechSynthesis" in window) speechSynthesis.cancel()
    setOpen(null)
    window.requestAnimationFrame(() => {
      if (panel === "handset") handsetTriggerRef.current?.focus()
      else radioTriggerRef.current?.focus()
    })
  }

  async function pullReceipts(ids: number[]) {
    if (!ids.length) { setReceipts([]); return }
    const data = await fetch(`/api/ops/receipts?ids=${ids.join(",")}`).then((response) => response.json())
    setReceipts(data.receipts ?? [])
  }

  async function ask(text = question) {
    const clean = text.trim()
    if (!clean || working) return
    setWorking(true); setAnswer(""); setReceipts([]); setAnswerStatus("Ask Jobs is working.")
    try {
      const response = await fetch("/api/ops/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: clean }) })
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error || "Ask Jobs could not answer.")
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let full = ""
      while (true) { const { done, value } = await reader.read(); if (done) break; full += decoder.decode(value, { stream: true }); setAnswer(full) }
      const ids = [...new Set([...full.matchAll(/\[e:(\d+)\]/g)].map((match) => Number(match[1])))]
      await pullReceipts(ids)
      const stored = await fetch("/api/ops/handset-slips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: clean, answer: full, receiptIds: ids }) }).then((item) => item.ok ? item.json() : null)
      if (stored?.slip) setSlips((current) => [stored.slip, ...current.filter((item) => Number(item.id) !== Number(stored.slip.id))].slice(0, 6))
      if (speak && "speechSynthesis" in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(withoutEvidenceMarkers(full))) }
      setAnswerStatus("Ask Jobs answer ready.")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ask Jobs could not answer."
      setAnswer(message)
      setAnswerStatus(message)
    }
    finally { setWorking(false) }
  }

  async function reopenSlip(slip: HandsetSlip) {
    setQuestion(slip.question); setAnswer(slip.answer); setOpen("handset")
    await pullReceipts((slip.receipt_ids ?? []).map(Number))
  }

  async function emptyBasket() {
    const response = await fetch("/api/ops/handset-slips", { method: "DELETE" })
    if (response.ok) setSlips([])
  }

  async function loadBrief() {
    setOpen("radio")
    try {
      const data = await fetch("/api/ops/brief/latest").then((response) => response.json())
      const text = data.brief?.body || "The Morning Brief is not ready yet."
      setBrief(text); setBriefAudio(data.audioUrl || ""); setDaySheet(Array.isArray(data.daySheet) ? data.daySheet : [])
      if (speak && data.audioUrl) { audioRef.current?.pause(); audioRef.current = new Audio(data.audioUrl); void audioRef.current.play().catch(() => undefined) }
      else if (speak && "speechSynthesis" in window && data.brief?.body) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)) }
    } catch {
      setBrief("The Morning Brief could not load. Try again.")
      setBriefAudio("")
      setDaySheet([])
    }
  }

  return <section className="ops-dock" aria-label="Ask Jobs and Morning Brief">
    <p className="jobs-sr-only" role="status" aria-live="polite" aria-atomic="true">{answerStatus}</p>
    {open === "handset" && <section className="ops-handset-panel" id="ops-handset-panel" aria-labelledby="ops-handset-title">
      <header><div><span>Answers with sources</span><h2 id="ops-handset-title">Ask Jobs</h2></div><button type="button" onClick={() => closePanel("handset")}>Close</button></header>
      <div className="ops-handset-controls"><VoiceCaptureButton available={voiceReady} className="ops-hold-talk" disabled={working} onError={(message) => { setAnswer(message); setAnswerStatus(message) }} onTranscript={(transcript) => { setQuestion(transcript); void ask(transcript) }} /><form onSubmit={(event) => { event.preventDefault(); void ask() }}><label className="jobs-sr-only" htmlFor="ops-handset-question">Question for Ask Jobs</label><input ref={questionRef} id="ops-handset-question" name="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Type a question" /><button type="submit" disabled={working}>Ask</button></form><label><input type="checkbox" checked={speak} onChange={(event) => setSpeak(event.target.checked)} /> Read answer aloud</label></div>
      {(answer || working) && <article className="ops-thermal-slip" aria-busy={working}><span>{working ? "Working..." : "Answer"}</span><p>{withoutEvidenceMarkers(answer) || "Working..."}</p>{receipts.length > 0 && <div><small>Sources</small>{receipts.map((item) => {
        // The receipt drawer is gone. A source with a job opens that job; one
        // without a job has nowhere to go, so it stays plain text.
        const label = <>{shopEventLabel(item.kind)}, {new Date(item.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</>
        return item.lead_id
          ? <a href={`/ops/leads/${item.lead_id}`} key={item.id}>{label}</a>
          : <span key={item.id}>{label}</span>
      })}</div>}<button type="button" className="ops-crumple" onClick={() => { setAnswer(""); setAnswerStatus("Answer cleared."); setQuestion(""); setReceipts([]); questionRef.current?.focus() }}>Clear answer</button></article>}
      {slips.length > 0 && <details className="ops-slip-basket"><summary>Saved answers, {slips.length}</summary><div>{slips.map((slip) => <button type="button" key={slip.id} onClick={() => void reopenSlip(slip)}><strong>{slip.question}</strong><small>{new Date(slip.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></button>)}</div><button type="button" className="ops-ghost" onClick={() => void emptyBasket()}>Clear saved answers</button></details>}
    </section>}
    {open === "radio" && <section className="ops-radio-panel" id="ops-radio-panel" aria-labelledby="ops-radio-title"><header><div><span>Today at the shop</span><h2 ref={radioHeadingRef} id="ops-radio-title" tabIndex={-1}>Morning Brief</h2></div><button type="button" onClick={() => closePanel("radio")}>Close</button></header><p>{brief}</p>{daySheet.length > 0 && <div className="ops-day-sheet"><strong>Today’s jobs</strong>{daySheet.map((item, index) => <a href={item.url} key={`${item.url}-${index}`}>{item.label}</a>)}</div>}<button type="button" onClick={() => { if (briefAudio) { audioRef.current?.pause(); audioRef.current = new Audio(briefAudio); void audioRef.current.play().catch(() => undefined) } else if (brief && "speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(brief)) }}>Play again</button></section>}
    <div className="ops-dock-base"><button ref={radioTriggerRef} type="button" className="ops-radio-key" aria-expanded={open === "radio"} aria-controls="ops-radio-panel" onClick={() => open === "radio" ? closePanel("radio") : void loadBrief()}>Morning Brief</button><button ref={handsetTriggerRef} type="button" className="ops-handset-key" aria-expanded={open === "handset"} aria-controls="ops-handset-panel" onClick={() => open === "handset" ? closePanel("handset") : setOpen("handset")}>Ask Jobs</button></div>
  </section>
}
