"use client"

import { useId, useEffect, useRef, useState } from "react"
import { shopEventLabel, withoutEvidenceMarkers } from "@/lib/shop-language"
import { VoiceCaptureButton } from "./voice-capture-button"
import { clearDockAnswers, readDockJson } from "./shop-dock-requests"

type Receipt = { id: number; occurred_at: string; kind: string; lead_id: number | null; body: string }
type BriefResult = { brief?: { body?: string }; audioUrl?: string; daySheet?: Array<{ label: string; url: string }> }

type HandsetSlip = { id: number; question: string; answer: string; receipt_ids: number[]; created_at: string }

export function ShopDock({ voiceReady }: { voiceReady: boolean }) {
  const instanceId = useId()
  const domId = (name: string) => `${name}-${instanceId}`
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
  const [basketStatus, setBasketStatus] = useState("")
  const [clearing, setClearing] = useState(false)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefHasContent, setBriefHasContent] = useState(false)
  const briefRequest = useRef(0)
  const answerRequest = useRef(0)
  const activePanel = useRef<"handset" | "radio" | null>(null)
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
        activePanel.current = "radio"
        setOpen("radio")
        setBrief("Loading the Morning Brief...")
        setBriefLoading(true)
        const requestId = ++briefRequest.current
        void readDockJson<BriefResult>("/api/ops/brief/latest", "Brief unavailable").then((data) => {
          if (requestId !== briefRequest.current) return
          setBriefHasContent(Boolean(data.brief?.body || data.audioUrl))
          setBrief(data.brief?.body || "The Morning Brief is not ready yet.")
          setBriefAudio(data.audioUrl || "")
          setDaySheet(Array.isArray(data.daySheet) ? data.daySheet : [])
        }).catch(() => {
          if (requestId === briefRequest.current) setBrief("The Morning Brief could not load. Try again.")
        }).finally(() => {
          if (requestId === briefRequest.current) setBriefLoading(false)
        })
      }
    }, 0)
    return () => { window.clearTimeout(hashTimer); briefRequest.current += 1; answerRequest.current += 1; activePanel.current = null; audioRef.current?.pause(); if ("speechSynthesis" in window) speechSynthesis.cancel() }
  }, [])

  useEffect(() => {
    activePanel.current = open
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      if (open === "handset") questionRef.current?.focus()
      else radioHeadingRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  function closePanel(panel = open) {
    if (!panel) return
    briefRequest.current += 1
    setBriefLoading(false)
    activePanel.current = null
    audioRef.current?.pause()
    if ("speechSynthesis" in window) speechSynthesis.cancel()
    setOpen(null)
    window.requestAnimationFrame(() => {
      if (panel === "handset") handsetTriggerRef.current?.focus()
      else radioTriggerRef.current?.focus()
    })
  }

  async function pullReceipts(ids: number[]): Promise<Receipt[]> {
    if (!ids.length) return []
    const data = await readDockJson<{ receipts?: Receipt[] }>(`/api/ops/receipts?ids=${ids.join(",")}`, "Sources could not load. Check your connection and try again.")
    return data.receipts ?? []
  }

  async function ask(text = question) {
    const clean = text.trim()
    if (!clean || working) return
    const requestId = ++answerRequest.current
    setBasketStatus("")
    setWorking(true); setAnswer(""); setReceipts([]); setAnswerStatus("Ask Jobs is working.")
    try {
      const response = await fetch("/api/ops/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: clean }) })
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error || "Ask Jobs could not answer.")
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let full = ""
      while (true) {
        const { done, value } = await reader.read()
        if (requestId !== answerRequest.current) { await reader.cancel(); return }
        if (done) break
        full += decoder.decode(value, { stream: true }); setAnswer(full)
      }
      const ids = [...new Set([...full.matchAll(/\[e:(\d+)\]/g)].map((match) => Number(match[1])))]
      try {
        const sourceReceipts = await pullReceipts(ids)
        if (requestId !== answerRequest.current) return
        setReceipts(sourceReceipts)
      } catch {
        if (requestId !== answerRequest.current) return
        setBasketStatus("The answer is ready, but its sources could not load.")
      }
      try {
        const saved = await fetch("/api/ops/handset-slips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: clean, answer: full, receiptIds: ids }) })
        if (!saved.ok) throw new Error("Save failed")
        const stored = await saved.json()
        if (requestId !== answerRequest.current) return
        if (stored?.slip) setSlips((current) => [stored.slip, ...current.filter((item) => Number(item.id) !== Number(stored.slip.id))].slice(0, 6))
      } catch {
        if (requestId !== answerRequest.current) return
        setBasketStatus((current) => `${current ? `${current} ` : ""}This answer could not be saved. Keep it open and check your connection.`)
      }
      if (requestId !== answerRequest.current) return
      if (activePanel.current === "handset" && speak && "speechSynthesis" in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(withoutEvidenceMarkers(full))) }
      setAnswerStatus("Ask Jobs answer ready.")
    } catch (error) {
      if (requestId !== answerRequest.current) return
      const message = error instanceof Error ? error.message : "Ask Jobs could not answer."
      setAnswer(message)
      setAnswerStatus(message)
    }
    finally { if (requestId === answerRequest.current) setWorking(false) }
  }

  function showHandset() {
    briefRequest.current += 1
    activePanel.current = "handset"
    setBriefLoading(false)
    audioRef.current?.pause()
    if ("speechSynthesis" in window) speechSynthesis.cancel()
    setOpen("handset")
  }

  async function reopenSlip(slip: HandsetSlip) {
    if (working) return
    const requestId = ++answerRequest.current
    setQuestion(slip.question); setAnswer(slip.answer); showHandset()
    setBasketStatus(""); setReceipts([])
    try {
      const sourceReceipts = await pullReceipts((slip.receipt_ids ?? []).map(Number))
      if (requestId !== answerRequest.current) return
      setReceipts(sourceReceipts)
      setBasketStatus("Saved answer opened.")
    } catch {
      if (requestId !== answerRequest.current) return
      setBasketStatus("Saved answer opened, but its sources could not load. Check your connection and try again.")
    }
    if (requestId === answerRequest.current) questionRef.current?.focus()
  }

  async function emptyBasket() {
    if (clearing) return
    setClearing(true); setBasketStatus("")
    try {
      await clearDockAnswers()
      setSlips([])
      setBasketStatus("Saved answers cleared.")
      questionRef.current?.focus()
    } catch {
      setBasketStatus("Saved answers could not be cleared. Check your connection and try again.")
    } finally {
      setClearing(false)
    }
  }

  async function loadBrief() {
    const requestId = ++briefRequest.current
    activePanel.current = "radio"
    setOpen("radio"); setBriefLoading(true); setBriefHasContent(false)
    setBrief("Loading the Morning Brief..."); setBriefAudio(""); setDaySheet([])
    audioRef.current?.pause()
    if ("speechSynthesis" in window) speechSynthesis.cancel()
    try {
      const data = await readDockJson<BriefResult>("/api/ops/brief/latest", "Brief unavailable")
      if (requestId !== briefRequest.current || activePanel.current !== "radio") return
      setBriefHasContent(Boolean(data.brief?.body || data.audioUrl))
      const text = data.brief?.body || "The Morning Brief is not ready yet."
      setBrief(text); setBriefAudio(data.audioUrl || ""); setDaySheet(Array.isArray(data.daySheet) ? data.daySheet : [])
      if (speak && data.audioUrl) { audioRef.current?.pause(); audioRef.current = new Audio(data.audioUrl); void audioRef.current.play().catch(() => undefined) }
      else if (speak && "speechSynthesis" in window && data.brief?.body) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)) }
    } catch {
      if (requestId !== briefRequest.current) return
      setBrief("The Morning Brief could not load. Try again.")
      setBriefAudio("")
      setDaySheet([])
    } finally {
      if (requestId === briefRequest.current) setBriefLoading(false)
    }
  }

  return <section className="ops-dock" aria-label="Ask Jobs and Morning Brief">
    <p className="jobs-sr-only" role="status" aria-live="polite" aria-atomic="true">{answerStatus}</p>
    {open === "handset" && <section className="ops-handset-panel" id={domId("ops-handset-panel")} aria-labelledby={domId("ops-handset-title")}>
      <header><div><span>Answers with sources</span><h2 id={domId("ops-handset-title")}>Ask Jobs</h2></div><button type="button" onClick={() => closePanel("handset")}>Close</button></header>
      <div className="ops-handset-controls"><VoiceCaptureButton available={voiceReady} className="ops-hold-talk" disabled={working} onError={(message) => { setAnswer(message); setAnswerStatus(message) }} onTranscript={(transcript) => { setQuestion(transcript); void ask(transcript) }} /><form aria-busy={working} onSubmit={(event) => { event.preventDefault(); void ask() }}><label className="jobs-sr-only" htmlFor={domId("ops-handset-question")}>Question for Ask Jobs</label><input ref={questionRef} id={domId("ops-handset-question")} name="question" type="text" autoComplete="off" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Type a question" /><button type="submit" disabled={working}>{working ? "Asking…" : "Ask"}</button></form><label htmlFor={domId("ops-handset-speak")}><input id={domId("ops-handset-speak")} type="checkbox" checked={speak} onChange={(event) => setSpeak(event.target.checked)} /> Read answer aloud</label></div>
      {(answer || working) && <article className="ops-thermal-slip" aria-busy={working}><span>{working ? "Working..." : "Answer"}</span><p>{withoutEvidenceMarkers(answer) || "Working..."}</p>{receipts.length > 0 && <div><small>Sources</small>{receipts.map((item) => {
        // The receipt drawer is gone. A source with a job opens that job; one
        // without a job has nowhere to go, so it stays plain text.
        const label = <>{shopEventLabel(item.kind)}, {new Date(item.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</>
        return item.lead_id
          ? <a href={`/ops/leads/${item.lead_id}`} key={item.id}>{label}</a>
          : <span key={item.id}>{label}</span>
      })}</div>}<button type="button" className="ops-crumple" disabled={working} onClick={() => { answerRequest.current += 1; setBasketStatus(""); setAnswer(""); setAnswerStatus("Answer cleared."); setQuestion(""); setReceipts([]); questionRef.current?.focus() }}>Clear answer</button></article>}
      {slips.length > 0 && <details className="ops-slip-basket"><summary>Saved answers, {slips.length}</summary><div>{slips.map((slip) => <button type="button" key={slip.id} disabled={working} onClick={() => void reopenSlip(slip)}><strong>{slip.question}</strong><small>{new Date(slip.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></button>)}</div><button type="button" className="ops-ghost" disabled={clearing} onClick={() => void emptyBasket()}>{clearing ? "Clearing..." : "Clear saved answers"}</button></details>}
      {basketStatus && <p className="ops-basket-status" role="status">{basketStatus}</p>}
    </section>}
    {open === "radio" && <section className="ops-radio-panel" id={domId("ops-radio-panel")} aria-labelledby={domId("ops-radio-title")}><header><div><span>Today at the shop</span><h2 ref={radioHeadingRef} id={domId("ops-radio-title")} tabIndex={-1}>Morning Brief</h2></div><button type="button" onClick={() => closePanel("radio")}>Close</button></header><p role="status" aria-live="polite" aria-busy={briefLoading}>{brief}</p>{daySheet.length > 0 && <div className="ops-day-sheet"><strong>Today’s jobs</strong>{daySheet.map((item, index) => <a href={item.url} key={`${item.url}-${index}`}>{item.label}</a>)}</div>}<button type="button" disabled={briefLoading || !briefHasContent} onClick={() => { if (briefAudio) { audioRef.current?.pause(); audioRef.current = new Audio(briefAudio); void audioRef.current.play().catch(() => undefined) } else if (brief && "speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(brief)) }}>Play again</button><button type="button" disabled={briefLoading} onClick={() => void loadBrief()}>{briefLoading ? "Loading..." : "Refresh brief"}</button></section>}
    <div className="ops-dock-base"><button ref={radioTriggerRef} type="button" className="ops-radio-key" aria-expanded={open === "radio"} aria-controls={open === "radio" ? domId("ops-radio-panel") : undefined} onClick={() => open === "radio" ? closePanel("radio") : void loadBrief()}>Morning Brief</button><button ref={handsetTriggerRef} type="button" className="ops-handset-key" aria-expanded={open === "handset"} aria-controls={open === "handset" ? domId("ops-handset-panel") : undefined} onClick={() => open === "handset" ? closePanel("handset") : showHandset()}>Ask Jobs</button></div>
  </section>
}
