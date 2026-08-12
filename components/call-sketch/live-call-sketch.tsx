"use client"

import { Check, Download, PencilLine, Radio, TriangleAlert } from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { formatShopInches } from "@/lib/call-sketch-dxf.mjs"
import type { CallSketchSpec, SketchFact } from "@/lib/call-sketch-live.mjs"
import { GateDrawing, type GateSpec } from "./call-sketch-prototype"
import styles from "./live-call-sketch.module.css"

type Payload = {
  callerName: string
  callStatus: string
  status: "waiting" | "listening" | "review" | "confirmed" | "stopped" | "error"
  observedSpec: CallSketchSpec
  confirmedSpec: CallSketchSpec | null
  revision: number
  confirmedAt: string | null
  lastError: string
  lastEventAt: string | null
  liveTranscriptionEnabled: boolean
  buildQuestion: { question: string; reason: string } | null
  utterances: Array<{
    sequenceId: number
    speaker: "Customer" | "Shop"
    transcript: string
    final: boolean
  }>
}

type FormValues = {
  kind: "gate" | "frame"
  width: string
  height: string
  stockSize: string
  railCount: string
  hingeSide: "left" | "right"
  latchSide: "left" | "right"
  swing: string
  material: string
}

function asGateSpec(spec: CallSketchSpec): GateSpec {
  const truth = (fact: SketchFact<unknown>) => fact.truth === "confirmed" ? "confirmed" : fact.truth === "stated" ? "stated" : "uncertain"
  return {
    kind: spec.kind.value ?? "gate",
    width: spec.width.value,
    height: spec.height.value,
    stockSize: spec.stockSize.value,
    railCount: spec.railCount.value ?? 0,
    hingeSide: spec.hingeSide.value,
    latchSide: spec.latchSide.value,
    swing: spec.swing.value,
    widthTruth: truth(spec.width),
    heightTruth: truth(spec.height),
    widthSource: 0,
    heightSource: 0,
  }
}

function formValues(spec: CallSketchSpec): FormValues {
  return {
    kind: spec.kind.value === "frame" ? "frame" : "gate",
    width: spec.width.value == null ? "" : String(spec.width.value),
    height: spec.height.value == null ? "" : String(spec.height.value),
    stockSize: spec.stockSize.value == null ? "" : String(spec.stockSize.value),
    railCount: String(spec.railCount.value ?? 0),
    hingeSide: spec.hingeSide.value ?? "left",
    latchSide: spec.latchSide.value ?? "right",
    swing: spec.swing.value ?? "",
    material: spec.material.value ?? "",
  }
}

function factLabel(fact: SketchFact<unknown>) {
  if (fact.truth === "confirmed") return "Owner confirmed"
  if (fact.truth === "stated") return "Heard on call"
  if (fact.truth === "uncertain") return "Needs clarification"
  return "Not stated"
}

function measurement(fact: SketchFact<number>) {
  return fact.value == null ? "—" : formatShopInches(fact.value)
}

function statusCopy(payload: Payload) {
  if (!payload.liveTranscriptionEnabled) return { label: "Waiting on phone activation", tone: "waiting" }
  if (payload.status === "confirmed") return { label: "Owner confirmed", tone: "confirmed" }
  if (payload.status === "listening") return { label: "Drawing from the call", tone: "live" }
  if (payload.status === "review" || payload.status === "stopped") return { label: "Call ended · review", tone: "review" }
  if (payload.status === "error") return { label: "Transcript interrupted", tone: "error" }
  return { label: "Waiting for speech", tone: "waiting" }
}

function Fact({ label, fact, children }: { label: string; fact: SketchFact<unknown>; children: React.ReactNode }) {
  return <div className={styles.fact}>
    <dt>{label}</dt>
    <dd>
      <strong>{children}</strong>
      <span data-truth={fact.truth}>{factLabel(fact)}</span>
      {fact.evidence && <small>“{fact.evidence}”</small>}
    </dd>
  </div>
}

export function LiveCallSketch({ draftId }: { draftId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loadError, setLoadError] = useState("")
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState("")
  const [values, setValues] = useState<FormValues | null>(null)

  useEffect(() => {
    let mounted = true
    let timer: number | undefined
    let nextDelay = 1_500
    async function refresh() {
      try {
        const response = await fetch(`/api/ops/call-sketch/${encodeURIComponent(draftId)}`, { cache: "no-store" })
        const data = await response.json().catch(() => null) as Payload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data ? data.error : "The call sketch could not be loaded.")
        if (mounted) {
          const next = data as Payload
          setPayload(next)
          setLoadError("")
          nextDelay = next.liveTranscriptionEnabled && ["waiting", "listening"].includes(next.status) ? 1_500 : 10_000
        }
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : "The call sketch could not be loaded.")
          nextDelay = 10_000
        }
      } finally {
        if (mounted) timer = window.setTimeout(refresh, nextDelay)
      }
    }
    void refresh()
    return () => {
      mounted = false
      if (timer) window.clearTimeout(timer)
    }
  }, [draftId])

  const activeSpec = payload?.confirmedSpec ?? payload?.observedSpec
  const drawingSpec = useMemo(() => activeSpec ? asGateSpec(activeSpec) : null, [activeSpec])
  const status = payload ? statusCopy(payload) : { label: "Loading call sketch", tone: "waiting" }

  function beginReview() {
    if (!activeSpec) return
    setValues(formValues(activeSpec))
    setEditing(true)
    setActionError("")
  }

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => current ? { ...current, [key]: value } : current)
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (!values || !payload || saving) return
    setSaving(true)
    setActionError("")
    try {
      const response = await fetch(`/api/ops/call-sketch/${encodeURIComponent(draftId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: payload.revision, spec: values }),
      })
      const data = await response.json().catch(() => null) as { error?: string; spec?: CallSketchSpec; revision?: number; confirmedAt?: string } | null
      if (!response.ok || !data?.spec) throw new Error(data?.error || "The sketch could not be confirmed.")
      setPayload((current) => current ? {
        ...current,
        status: "confirmed",
        confirmedSpec: data.spec!,
        revision: data.revision ?? current.revision + 1,
        confirmedAt: data.confirmedAt ?? new Date().toISOString(),
      } : current)
      setEditing(false)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The sketch could not be confirmed.")
    } finally {
      setSaving(false)
    }
  }

  if (!payload && loadError) return <section className={styles.shell} aria-label="Live call sketch">
    <div className={styles.unavailable}><TriangleAlert aria-hidden="true" /><div><strong>Call sketch unavailable</strong><p>{loadError}</p></div></div>
  </section>

  return <section className={styles.shell} aria-labelledby="live-call-sketch-title">
    <header className={styles.header}>
      <div>
        <span>Live Call Sketch</span>
        <h2 id="live-call-sketch-title">Say it. See it.</h2>
      </div>
      <p className={styles.status} data-tone={status.tone}>{status.tone === "live" && <Radio aria-hidden="true" />}{status.label}</p>
    </header>

    {!payload || !drawingSpec || !activeSpec ? <div className={styles.loading}>Preparing the drawing surface…</div> : <>
      {!payload.liveTranscriptionEnabled && <div className={styles.setupNotice}>
        <TriangleAlert aria-hidden="true" />
        <p><strong>The workspace is ready.</strong> Live call audio starts after the Twilio business profile and phone number are approved.</p>
      </div>}

      <div className={styles.workspace}>
        <div className={styles.canvas}>
          <GateDrawing spec={drawingSpec} compact />
          <p>Rough call sketch · not a fabrication drawing</p>
        </div>
        <div className={styles.review}>
          <div className={styles.question}>
            <span>Ask next</span>
            <p>{payload.buildQuestion?.question ?? activeSpec.nextQuestion}</p>
            {payload.buildQuestion && <small>{payload.buildQuestion.reason}</small>}
          </div>
          <dl className={styles.facts}>
            <Fact label="Finished width" fact={activeSpec.width}>{measurement(activeSpec.width)}</Fact>
            <Fact label="Height" fact={activeSpec.height}>{measurement(activeSpec.height)}</Fact>
            <Fact label="Stock" fact={activeSpec.stockSize}>{measurement(activeSpec.stockSize)}</Fact>
            <Fact label="Rails" fact={activeSpec.railCount}>{activeSpec.railCount.value ?? "—"}</Fact>
            {activeSpec.kind.value !== "frame" && <>
              <Fact label="Hinges" fact={activeSpec.hingeSide}>{activeSpec.hingeSide.value ?? "—"}</Fact>
              <Fact label="Latch" fact={activeSpec.latchSide}>{activeSpec.latchSide.value ?? "—"}</Fact>
            </>}
          </dl>
        </div>
      </div>

      {payload.utterances.length > 0 && <div className={styles.transcript}>
        <span>Recent call language</span>
        <ol>{payload.utterances.slice(-4).map((utterance) => <li key={`${utterance.sequenceId}-${utterance.speaker}`}>
          <strong>{utterance.speaker}</strong>
          <p>{utterance.transcript}{!utterance.final && <em> listening…</em>}</p>
        </li>)}</ol>
      </div>}

      {editing && values ? <form className={styles.form} onSubmit={confirm}>
        <div className={styles.formHead}><div><span>Owner review</span><h3>Confirm every shop fact</h3></div><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        <div className={styles.formGrid}>
          <label><span>Drawing type</span><select value={values.kind} onChange={(event) => update("kind", event.target.value as "gate" | "frame")}><option value="gate">Gate</option><option value="frame">Rectangular frame</option></select></label>
          <label><span>Finished width (in.)</span><input required min="0.0625" step="0.0625" inputMode="decimal" value={values.width} onChange={(event) => update("width", event.target.value)} /></label>
          <label><span>Height (in.)</span><input required min="0.0625" step="0.0625" inputMode="decimal" value={values.height} onChange={(event) => update("height", event.target.value)} /></label>
          <label><span>Stock size (in.)</span><input required min="0.0625" step="0.0625" inputMode="decimal" value={values.stockSize} onChange={(event) => update("stockSize", event.target.value)} /></label>
          <label><span>Interior rails</span><input required min="0" max="8" step="1" inputMode="numeric" value={values.railCount} onChange={(event) => update("railCount", event.target.value)} /></label>
          {values.kind === "gate" && <>
            <label><span>Hinge side</span><select value={values.hingeSide} onChange={(event) => update("hingeSide", event.target.value as "left" | "right")}><option value="left">Left</option><option value="right">Right</option></select></label>
            <label><span>Latch side</span><select value={values.latchSide} onChange={(event) => update("latchSide", event.target.value as "left" | "right")}><option value="right">Right</option><option value="left">Left</option></select></label>
            <label className={styles.formWide}><span>Swing direction</span><input value={values.swing} onChange={(event) => update("swing", event.target.value)} placeholder="Toward driveway" /></label>
          </>}
          <label className={styles.formWide}><span>Material</span><input value={values.material} onChange={(event) => update("material", event.target.value)} placeholder="Mild steel" /></label>
        </div>
        {actionError && <p className={styles.error} role="alert">{actionError}</p>}
        <button className={styles.confirm} type="submit" disabled={saving}><Check aria-hidden="true" />{saving ? "Confirming…" : "Confirm facts & unlock DXF"}</button>
      </form> : <div className={styles.actions}>
        <button type="button" onClick={beginReview}><PencilLine aria-hidden="true" />{payload.confirmedSpec ? "Edit confirmed facts" : "Review & confirm facts"}</button>
        {payload.confirmedSpec && <a href={`/api/ops/call-sketch/${encodeURIComponent(draftId)}/dxf`}><Download aria-hidden="true" />Download DXF</a>}
      </div>}
    </>}
  </section>
}
