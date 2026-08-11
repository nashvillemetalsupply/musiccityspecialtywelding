"use client"

import {
  Check,
  Download,
  FileText,
  LockKeyhole,
  MessageCircleQuestion,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
} from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { createGateDxf, formatShopInches } from "@/lib/call-sketch-dxf.mjs"
import styles from "./call-sketch-prototype.module.css"

type Stage = "live" | "review" | "saved"
export type TruthState = "uncertain" | "stated" | "confirmed"

export type GateSpec = {
  kind?: "gate" | "frame"
  width: number | null
  height: number | null
  stockSize: number | null
  railCount: number
  hingeSide: "left" | "right" | null
  latchSide: "left" | "right" | null
  swing: string | null
  widthTruth: TruthState
  heightTruth: TruthState
  widthSource: number
  heightSource: number
}

type CallMoment = {
  speaker: "Customer" | "Philippe"
  transcript: string
  askNext: string
  drawingStatus: string
  spec: GateSpec
}

const CALL_MOMENTS: CallMoment[] = [
  {
    speaker: "Customer",
    transcript: "I need a small gate—about four feet wide.",
    askNext: "How tall should the gate be?",
    drawingStatus: "Starting a rough elevation",
    spec: {
      width: 48,
      height: null,
      stockSize: null,
      railCount: 0,
      hingeSide: null,
      latchSide: null,
      swing: null,
      widthTruth: "uncertain",
      heightTruth: "uncertain",
      widthSource: 0,
      heightSource: 0,
    },
  },
  {
    speaker: "Customer",
    transcript: "Make it forty-two inches tall, using two-inch square tubing.",
    askNext: "Is four feet the opening or the gate itself?",
    drawingStatus: "Height and stock added",
    spec: {
      width: 48,
      height: 42,
      stockSize: 2,
      railCount: 0,
      hingeSide: null,
      latchSide: null,
      swing: null,
      widthTruth: "uncertain",
      heightTruth: "stated",
      widthSource: 0,
      heightSource: 1,
    },
  },
  {
    speaker: "Customer",
    transcript: "Put two rails across it and hinge it on the left.",
    askNext: "Is four feet the opening or the actual gate width?",
    drawingStatus: "Rails and hinge side added",
    spec: {
      width: 48,
      height: 42,
      stockSize: 2,
      railCount: 2,
      hingeSide: "left",
      latchSide: null,
      swing: null,
      widthTruth: "uncertain",
      heightTruth: "stated",
      widthSource: 0,
      heightSource: 1,
    },
  },
  {
    speaker: "Philippe",
    transcript: "Is that forty-eight-inch opening, or is the gate itself forty-eight?",
    askNext: "Waiting for the width clarification.",
    drawingStatus: "Holding the uncertain width",
    spec: {
      width: 48,
      height: 42,
      stockSize: 2,
      railCount: 2,
      hingeSide: "left",
      latchSide: null,
      swing: null,
      widthTruth: "uncertain",
      heightTruth: "stated",
      widthSource: 0,
      heightSource: 1,
    },
  },
  {
    speaker: "Customer",
    transcript: "The opening is forty-eight. Make the actual gate forty-seven and a half.",
    askNext: "Which way should it swing, and where does the latch go?",
    drawingStatus: "Gate width corrected from the call",
    spec: {
      width: 47.5,
      height: 42,
      stockSize: 2,
      railCount: 2,
      hingeSide: "left",
      latchSide: null,
      swing: null,
      widthTruth: "stated",
      heightTruth: "stated",
      widthSource: 4,
      heightSource: 1,
    },
  },
  {
    speaker: "Customer",
    transcript: "Latch on the right. It swings toward the driveway.",
    askNext: "The basic geometry is captured. Review it after the call.",
    drawingStatus: "Ready for owner review",
    spec: {
      width: 47.5,
      height: 42,
      stockSize: 2,
      railCount: 2,
      hingeSide: "left",
      latchSide: "right",
      swing: "Toward driveway",
      widthTruth: "stated",
      heightTruth: "stated",
      widthSource: 4,
      heightSource: 1,
    },
  },
]

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function truthLabel(truth: TruthState) {
  if (truth === "confirmed") return "Owner locked"
  if (truth === "stated") return "Customer stated"
  return "Needs an answer"
}

function nextClarifyingQuestion(spec: GateSpec) {
  if (!spec.height) return "How tall should the gate be?"
  if (!spec.stockSize) return "What stock size and material should it use?"
  if (spec.widthTruth === "uncertain") return "Is four feet the opening or the actual gate width?"
  if (!spec.railCount) return "How should the inside be divided—rails, pickets, or open?"
  if (!spec.hingeSide) return "Which side should carry the hinges?"
  if (!spec.latchSide) return "Where should the latch go?"
  if (!spec.swing) return "Which way should it swing?"
  return "The basic geometry is captured. Review it after the call."
}

export function GateDrawing({ spec, compact = false }: { spec: GateSpec; compact?: boolean }) {
  const isGate = spec.kind !== "frame"
  const drawingWidth = spec.width ?? 48
  const drawingHeight = spec.height ?? 36
  const scale = Math.min(500 / drawingWidth, 330 / drawingHeight)
  const frameWidth = drawingWidth * scale
  const frameHeight = drawingHeight * scale
  const frameX = 445 - frameWidth / 2
  const frameY = 92 + (330 - frameHeight) / 2
  const tube = Math.max(10, (spec.stockSize ?? 1.5) * scale)
  const widthUncertain = spec.widthTruth === "uncertain"
  const heightUncertain = spec.heightTruth === "uncertain"
  const widthLabel = spec.width ? `${widthUncertain ? "≈ " : ""}${formatShopInches(spec.width)}${widthUncertain ? " ?" : isGate ? " GATE" : " FRAME"}` : "WIDTH ?"
  const heightLabel = spec.height ? `${formatShopInches(spec.height)}${heightUncertain ? " ?" : ""}` : "HEIGHT ?"
  const bottomDimensionY = frameY + frameHeight + 88
  const leftDimensionX = frameX - 76
  const railCenters = Array.from({ length: spec.railCount }, (_, index) => frameY + (frameHeight * (index + 1)) / (spec.railCount + 1))
  const frameRight = frameX + frameWidth
  const frameCenterY = frameY + frameHeight / 2
  const upperOpeningTop = frameY + tube / 2
  const upperOpeningBottom = (railCenters[0] ?? frameCenterY) - tube / 2
  const hingeX = spec.hingeSide === "left" ? frameX - tube * 0.72 : frameRight + tube * 0.72
  const hingeGateEdge = spec.hingeSide === "left" ? frameX : frameRight
  const hingeLabelX = spec.hingeSide === "left" ? frameX + 54 : frameRight - 54
  const hingeLabelY = upperOpeningTop + (upperOpeningBottom - upperOpeningTop) / 2
  const hingeLeaderInnerX = spec.hingeSide === "left" ? frameX + 28 : frameRight - 28
  const hingeLeaderEndX = spec.hingeSide === "left" ? hingeLabelX - 14 : hingeLabelX + 14
  const latchOuterX = spec.latchSide === "left" ? frameX - tube * 0.72 : frameRight + tube * 0.72
  const latchLabelX = spec.latchSide === "left" ? frameX + 54 : frameRight - 54
  const latchLabelY = frameCenterY
  const latchLeaderInnerX = spec.latchSide === "left" ? frameX + 28 : frameRight - 28
  const latchLeaderEndX = spec.latchSide === "left" ? latchLabelX - 14 : latchLabelX + 14
  const latchLeaderY = frameCenterY + Math.max(31, tube * 2)

  return (
    <svg
      className={`${styles.drawing}${compact ? ` ${styles.drawingCompact}` : ""}`}
      viewBox="0 0 900 610"
      role="img"
      aria-labelledby="call-sketch-drawing-title call-sketch-drawing-description"
    >
      <title id="call-sketch-drawing-title">Rough front elevation of the described {isGate ? "gate" : "frame"}</title>
      <desc id="call-sketch-drawing-description">
        A {widthLabel} wide by {heightLabel} high {isGate ? "gate" : "rectangular frame"} with {spec.railCount || "no confirmed"} interior rails
        {isGate ? `${spec.hingeSide ? `, hinges on the ${spec.hingeSide}` : ", hinge side not yet stated"}${spec.latchSide ? `, and a latch on the ${spec.latchSide}` : ", and latch side not yet stated"}.` : "."}
      </desc>
      <defs>
        <pattern id="call-sketch-grid-small" width="18" height="18" patternUnits="userSpaceOnUse">
          <path d="M 18 0 L 0 0 0 18" className={styles.gridMinor} />
        </pattern>
        <pattern id="call-sketch-grid-large" width="90" height="90" patternUnits="userSpaceOnUse">
          <rect width="90" height="90" fill="url(#call-sketch-grid-small)" />
          <path d="M 90 0 L 0 0 0 90" className={styles.gridMajor} />
        </pattern>
      </defs>
      <rect width="900" height="610" fill="url(#call-sketch-grid-large)" />

      <g className={styles.elevation}>
        <rect
          x={frameX}
          y={frameY}
          width={frameWidth}
          height={frameHeight}
          rx="1"
          className={`${styles.frame}${!spec.height || widthUncertain ? ` ${styles.frameUncertain}` : ""}`}
          style={{ strokeWidth: tube }}
        />
        {railCenters.map((center, index) => (
          <line
            className={styles.rail}
            key={index}
            x1={frameX + tube / 2}
            y1={center}
            x2={frameX + frameWidth - tube / 2}
            y2={center}
            style={{ strokeWidth: tube }}
          />
        ))}

        {isGate && spec.hingeSide && [0.27, 0.73].map((position) => {
          return <g key={position} className={styles.hardware}>
            <line x1={hingeGateEdge} y1={frameY + frameHeight * position} x2={hingeX} y2={frameY + frameHeight * position} />
            <circle cx={hingeX} cy={frameY + frameHeight * position} r={Math.max(6, tube * 0.24)} />
          </g>
        })}

        {isGate && spec.latchSide && <g className={styles.hardware}>
          <rect
            x={spec.latchSide === "left" ? frameX - tube * 0.72 : frameRight + tube * 0.32}
            y={frameY + frameHeight / 2 - tube * 0.36}
            width={tube * 0.4}
            height={tube * 0.72}
          />
          <line
            x1={spec.latchSide === "left" ? frameX : frameRight}
            y1={frameY + frameHeight / 2}
            x2={latchOuterX}
            y2={frameY + frameHeight / 2}
          />
        </g>}
      </g>

      <g className={`${styles.dimension}${widthUncertain ? ` ${styles.dimensionUncertain}` : ""}`}>
        <line x1={frameX} y1={frameY + frameHeight + tube / 2} x2={frameX} y2={bottomDimensionY + 12} />
        <line x1={frameX + frameWidth} y1={frameY + frameHeight + tube / 2} x2={frameX + frameWidth} y2={bottomDimensionY + 12} />
        <line x1={frameX} y1={bottomDimensionY} x2={frameX + frameWidth} y2={bottomDimensionY} />
        <line x1={frameX - 7} y1={bottomDimensionY + 7} x2={frameX + 7} y2={bottomDimensionY - 7} />
        <line x1={frameX + frameWidth - 7} y1={bottomDimensionY + 7} x2={frameX + frameWidth + 7} y2={bottomDimensionY - 7} />
        <text x={frameX + frameWidth / 2} y={bottomDimensionY - 18} textAnchor="middle">{widthLabel}</text>
      </g>

      <g className={`${styles.dimension}${heightUncertain ? ` ${styles.dimensionUncertain}` : ""}`}>
        <line x1={frameX - tube / 2} y1={frameY} x2={leftDimensionX - 16} y2={frameY} />
        <line x1={frameX - tube / 2} y1={frameY + frameHeight} x2={leftDimensionX - 16} y2={frameY + frameHeight} />
        <line x1={leftDimensionX} y1={frameY} x2={leftDimensionX} y2={frameY + frameHeight} />
        <line x1={leftDimensionX - 7} y1={frameY - 7} x2={leftDimensionX + 7} y2={frameY + 7} />
        <line x1={leftDimensionX - 7} y1={frameY + frameHeight - 7} x2={leftDimensionX + 7} y2={frameY + frameHeight + 7} />
        <text transform={`translate(${leftDimensionX - 17} ${frameY + frameHeight / 2}) rotate(-90)`} textAnchor="middle">{heightLabel}</text>
      </g>

      {spec.stockSize && <g className={styles.callout}>
        <line x1={frameX + frameWidth * 0.72} y1={frameY - tube / 2} x2={frameX + frameWidth * 0.82} y2={frameY - 12} />
        <line x1={frameX + frameWidth * 0.82} y1={frameY - 12} x2={frameX + frameWidth * 0.98} y2={frameY - 12} />
        <text x={frameX + frameWidth * 0.98} y={frameY - 26} textAnchor="end">{formatShopInches(spec.stockSize)} SQ TUBE</text>
      </g>}

      {isGate && spec.hingeSide && <g className={styles.hardwareCallout}>
        <polyline points={`${hingeX},${frameY + frameHeight * 0.27} ${hingeLeaderInnerX},${frameY + frameHeight * 0.27} ${hingeLeaderEndX},${hingeLabelY + 26}`} />
        <text x={hingeLabelX} y={hingeLabelY} dominantBaseline="middle" textAnchor={spec.hingeSide === "left" ? "start" : "end"}>HINGES</text>
      </g>}
      {isGate && spec.latchSide && <g className={styles.hardwareCallout}>
        <polyline points={`${latchOuterX},${frameCenterY} ${latchLeaderInnerX},${frameCenterY} ${latchLeaderInnerX},${latchLeaderY} ${latchLeaderEndX},${latchLeaderY}`} />
        <text x={latchLabelX} y={latchLabelY} dominantBaseline="middle" textAnchor={spec.latchSide === "left" ? "start" : "end"}>LATCH</text>
      </g>}
      {isGate && spec.swing && <text className={styles.swingLabel} x="445" y="578" textAnchor="middle">SWINGS TOWARD DRIVEWAY</text>}
    </svg>
  )
}

function TranscriptList({ through }: { through: number }) {
  return <ol className={styles.transcriptList}>
    {CALL_MOMENTS.slice(0, through + 1).map((moment, index) => (
      <li key={`${moment.speaker}-${index}`}>
        <span>{moment.speaker}</span>
        <p>{moment.transcript}</p>
      </li>
    ))}
  </ol>
}

export function CallSketchPrototype({ embedded = false }: { embedded?: boolean } = {}) {
  const [stage, setStage] = useState<Stage>("live")
  const [momentIndex, setMomentIndex] = useState(0)
  const [frozen, setFrozen] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [showFix, setShowFix] = useState(false)
  const [widthOverride, setWidthOverride] = useState<number | null>(null)
  const [heightOverride, setHeightOverride] = useState<number | null>(null)
  const [editWidth, setEditWidth] = useState("")
  const [editHeight, setEditHeight] = useState("")
  const [correctionError, setCorrectionError] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(38)
  const [announcement, setAnnouncement] = useState("Call Sketch is drawing from the conversation.")

  const currentMoment = CALL_MOMENTS[momentIndex]
  const spec = useMemo<GateSpec>(() => ({
    ...currentMoment.spec,
    width: widthOverride ?? currentMoment.spec.width,
    height: heightOverride ?? currentMoment.spec.height,
    widthTruth: confirmed || widthOverride !== null ? "confirmed" : currentMoment.spec.widthTruth,
    heightTruth: confirmed || heightOverride !== null ? "confirmed" : currentMoment.spec.heightTruth,
  }), [confirmed, currentMoment, heightOverride, widthOverride])

  const exportReady = Boolean(
    confirmed &&
    spec.width &&
    spec.height &&
    spec.stockSize &&
    spec.hingeSide &&
    spec.latchSide,
  )
  const askNext = nextClarifyingQuestion(spec)

  useEffect(() => {
    if (stage !== "live") return
    const interval = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1000)
    return () => window.clearInterval(interval)
  }, [stage])

  useEffect(() => {
    if (stage !== "live" || frozen || showFix) return
    const delay = momentIndex < CALL_MOMENTS.length - 1 ? 4200 : 5200
    const timeout = window.setTimeout(() => {
      if (momentIndex < CALL_MOMENTS.length - 1) {
        setMomentIndex((current) => current + 1)
        setAnnouncement("The sketch was updated from the next completed thought.")
      } else {
        setStage("review")
        setShowNotes(false)
        setAnnouncement("Call ended. Review the dimensions before saving or exporting.")
      }
    }, delay)
    return () => window.clearTimeout(timeout)
  }, [frozen, momentIndex, showFix, stage])

  function advanceDemo() {
    if (stage !== "live") return
    if (momentIndex < CALL_MOMENTS.length - 1) {
      setMomentIndex((current) => current + 1)
      setAnnouncement("The sketch was updated from the next completed thought.")
      return
    }
    setStage("review")
    setFrozen(false)
    setShowNotes(false)
    setAnnouncement("Call ended. Review the dimensions before saving or exporting.")
  }

  function openCorrection() {
    setEditWidth(spec.width?.toString() ?? "")
    setEditHeight(spec.height?.toString() ?? "")
    setCorrectionError("")
    setShowFix(true)
    if (stage === "live") setFrozen(true)
  }

  function applyCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextWidth = Number(editWidth)
    const nextHeight = Number(editHeight)
    if (!Number.isFinite(nextWidth) || nextWidth <= 0 || !Number.isFinite(nextHeight) || nextHeight <= 0) {
      setCorrectionError("Enter positive width and height.")
      return
    }
    if (spec.stockSize && spec.stockSize * 2 >= Math.min(nextWidth, nextHeight)) {
      setCorrectionError("Those measurements leave no opening inside the selected tube size.")
      return
    }
    setWidthOverride(nextWidth)
    setHeightOverride(nextHeight)
    setShowFix(false)
    setCorrectionError("")
    setAnnouncement(`Owner correction locked at ${formatShopInches(nextWidth)} by ${formatShopInches(nextHeight)}.`)
  }

  function confirmDimensions() {
    setConfirmed(true)
    setShowFix(false)
    setAnnouncement("Dimensions locked by the owner. DXF export is now available.")
  }

  function downloadDxf() {
    if (!exportReady || !spec.width || !spec.height || !spec.stockSize || !spec.hingeSide || !spec.latchSide) return
    const dxf = createGateDxf({
      kind: spec.kind ?? "gate",
      width: spec.width,
      height: spec.height,
      stockSize: spec.stockSize,
      railCount: spec.railCount,
      hingeSide: spec.hingeSide,
      latchSide: spec.latchSide,
      title: "Mike Henderson gate call sketch",
    })
    const blob = new Blob([dxf], { type: "application/dxf;charset=us-ascii" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "mike-henderson-gate-call-sketch.dxf"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setAnnouncement("The browser prepared the confirmed DXF file.")
  }

  function restartPrototype() {
    setStage("live")
    setMomentIndex(0)
    setFrozen(false)
    setShowNotes(false)
    setShowFix(false)
    setWidthOverride(null)
    setHeightOverride(null)
    setConfirmed(false)
    setElapsedSeconds(38)
    setCorrectionError("")
    setAnnouncement("Call Sketch restarted. Nothing in production was changed.")
  }

  const factWidth = spec.width ? formatShopInches(spec.width) : "Not caught"
  const factHeight = spec.height ? formatShopInches(spec.height) : "Not caught"
  const factStock = spec.stockSize ? `${formatShopInches(spec.stockSize)} square tube` : "Not caught"

  return (
    <main className={`${styles.page}${embedded ? ` ${styles.embedded}` : ""}`}>
      <div className={styles.prototypeBar}>
        <div>
          <strong>Call Sketch <span className={styles.prototypeWord}>prototype</span></strong>
          <span>No production calls or jobs are changed.</span>
        </div>
        {stage === "live" ? <button type="button" onClick={advanceDemo}>Advance demo</button> : <button type="button" onClick={restartPrototype}><RotateCcw aria-hidden="true" size={17} /> Replay call</button>}
      </div>

      <div className={styles.productFrame}>
        {!embedded && <header className={styles.productHeader}>
          <a href="/ops" aria-label="Back to MCSW Jobs"><span aria-hidden="true" />MCSW Jobs</a>
          <div><span>Philippe</span><button type="button">More</button></div>
        </header>}

        {stage === "live" && <div className={styles.liveWorkspace}>
          <section className={styles.liveHeading} aria-labelledby="call-sketch-live-title">
            <div className={styles.liveFlag}><span aria-hidden="true" /> Live call</div>
            <div>
              <h1 id="call-sketch-live-title">Mike Henderson</h1>
              <span>(615) 555-0189</span>
            </div>
            <time dateTime={`PT${elapsedSeconds}S`}>{formatDuration(elapsedSeconds)}</time>
          </section>

          <section className={styles.sketchPanel} aria-label="Live gate sketch">
            <header>
              <div><span>Front elevation</span><strong>{currentMoment.drawingStatus}</strong></div>
              <small>{frozen ? "Sketch frozen" : `Listening · ${momentIndex + 1} of ${CALL_MOMENTS.length}`}</small>
            </header>
            <GateDrawing spec={spec} />
            <div className={styles.truthLegend} aria-label="Drawing certainty legend">
              <span><i className={styles.legendSolid} /> Stated</span>
              <span><i className={styles.legendDashed} /> Needs answer</span>
              <span><LockKeyhole aria-hidden="true" size={14} /> Owner locked</span>
            </div>
          </section>

          <div className={styles.callRail}>
            <section className={styles.heardPanel} aria-live="polite">
              <span>{currentMoment.speaker} just said</span>
              <blockquote>{currentMoment.transcript}</blockquote>
            </section>

            <section className={styles.askPanel}>
              <MessageCircleQuestion aria-hidden="true" size={22} />
              <div><span>Ask next</span><strong>{askNext}</strong></div>
            </section>

            {showFix && <form className={styles.correctionPanel} onSubmit={applyCorrection}>
              <header><div><span>Owner correction</span><strong>Lock the measurements</strong></div><button type="button" onClick={() => setShowFix(false)}>Close</button></header>
              <div>
                <label>Gate width, inches<input name="gate-width" inputMode="decimal" value={editWidth} onChange={(event) => setEditWidth(event.target.value)} aria-invalid={Boolean(correctionError)} aria-describedby={correctionError ? "call-sketch-correction-error" : undefined} autoFocus /></label>
                <label>Gate height, inches<input name="gate-height" inputMode="decimal" value={editHeight} onChange={(event) => setEditHeight(event.target.value)} aria-invalid={Boolean(correctionError)} aria-describedby={correctionError ? "call-sketch-correction-error" : undefined} /></label>
              </div>
              <p id="call-sketch-correction-error" role={correctionError ? "alert" : undefined} aria-hidden={!correctionError} data-empty={!correctionError}>{correctionError || "Correction status"}</p>
              <button className={styles.primaryButton} type="submit"><LockKeyhole aria-hidden="true" size={18} /> Apply and lock</button>
            </form>}

            {showNotes && <section className={styles.notesPanel} aria-label="Call transcript so far">
              <header><span>Call notes so far</span><button type="button" onClick={() => setShowNotes(false)}>Close</button></header>
              <TranscriptList through={momentIndex} />
            </section>}

            <div className={styles.liveControls} aria-label="Live sketch controls">
              <button type="button" aria-pressed={frozen} onClick={() => { setFrozen((current) => !current); setAnnouncement(frozen ? "Live drawing resumed." : "Sketch frozen. The phone call continues.") }}>
                {frozen ? <Play aria-hidden="true" size={20} /> : <Pause aria-hidden="true" size={20} />}
                <span>{frozen ? "Resume" : "Freeze"}</span>
              </button>
              <button type="button" aria-expanded={showFix} onClick={showFix ? () => setShowFix(false) : openCorrection}>
                <PencilLine aria-hidden="true" size={20} />
                <span>Fix</span>
              </button>
              <button type="button" aria-expanded={showNotes} onClick={() => setShowNotes((current) => !current)}>
                <FileText aria-hidden="true" size={20} />
                <span>Notes</span>
              </button>
            </div>
          </div>
        </div>}

        {stage === "review" && <div className={styles.reviewWorkspace}>
          <header className={styles.reviewHeading}>
            <div>
              <div className={styles.headingMeta}>
                <span>Call finished · {formatDuration(elapsedSeconds)}</span>
                <span className={styles.reviewCount}>{confirmed ? "Dimensions locked" : "2 dimensions to confirm"}</span>
              </div>
              <h1>Review Mike’s gate sketch</h1>
              <p>Nothing becomes a shop drawing until you confirm it.</p>
            </div>
          </header>

          <div className={styles.reviewGrid}>
            <section className={styles.reviewDrawing}>
              <header><div><span>Call sketch</span><strong>Front elevation</strong></div><small>{confirmed ? "Owner confirmed" : "Needs owner review"}</small></header>
              <GateDrawing spec={spec} />
              <p>{confirmed ? "Owner-confirmed concept. Verify fit and field conditions before fabrication." : "Rough interpretation from the call—not fabrication ready."}</p>
            </section>

            <section className={styles.factPanel} aria-labelledby="call-sketch-facts-title">
              <header><span>Confirm the shop facts</span><h2 id="call-sketch-facts-title">What the drawing is using</h2></header>
              <dl>
                <div><dt>Gate width</dt><dd><strong>{factWidth}</strong><span>{truthLabel(spec.widthTruth)}</span><small>“{CALL_MOMENTS[spec.widthSource].transcript}”</small></dd></div>
                <div><dt>Gate height</dt><dd><strong>{factHeight}</strong><span>{truthLabel(spec.heightTruth)}</span><small>“{CALL_MOMENTS[spec.heightSource].transcript}”</small></dd></div>
                <div><dt>Stock</dt><dd><strong>{factStock}</strong><span>Customer stated</span></dd></div>
                <div><dt>Hardware</dt><dd><strong>Hinges left · latch right</strong><span>Customer stated</span></dd></div>
                <div><dt>Swing</dt><dd><strong>{spec.swing ?? "Not caught"}</strong><span>Customer stated</span></dd></div>
              </dl>

              {showFix && <form className={styles.correctionPanel} onSubmit={applyCorrection}>
                <header><div><span>Owner correction</span><strong>Change before confirming</strong></div><button type="button" onClick={() => setShowFix(false)}>Close</button></header>
                <div>
                  <label>Gate width, inches<input name="gate-width" inputMode="decimal" value={editWidth} onChange={(event) => setEditWidth(event.target.value)} aria-invalid={Boolean(correctionError)} aria-describedby={correctionError ? "call-sketch-correction-error" : undefined} autoFocus /></label>
                  <label>Gate height, inches<input name="gate-height" inputMode="decimal" value={editHeight} onChange={(event) => setEditHeight(event.target.value)} aria-invalid={Boolean(correctionError)} aria-describedby={correctionError ? "call-sketch-correction-error" : undefined} /></label>
                </div>
                <p id="call-sketch-correction-error" role={correctionError ? "alert" : undefined} aria-hidden={!correctionError} data-empty={!correctionError}>{correctionError || "Correction status"}</p>
                <button className={styles.primaryButton} type="submit"><LockKeyhole aria-hidden="true" size={18} /> Apply and lock</button>
              </form>}

              {!confirmed ? <div className={styles.reviewActions}>
                <button className={styles.primaryButton} type="button" onClick={confirmDimensions}><Check aria-hidden="true" size={19} /> Confirm {factWidth} × {factHeight}</button>
                <button className={styles.secondaryButton} type="button" onClick={openCorrection}><PencilLine aria-hidden="true" size={18} /> Correct a dimension</button>
                <button className={styles.secondaryButton} type="button" disabled title="Confirm dimensions first"><Download aria-hidden="true" size={18} /> DXF locked</button>
              </div> : <div className={styles.reviewActions}>
                <div className={styles.lockedNotice}><LockKeyhole aria-hidden="true" size={19} /><span><strong>Dimensions locked by owner</strong>DXF is available from this confirmed revision.</span></div>
                <button className={styles.primaryButton} type="button" onClick={() => { setStage("saved"); setAnnouncement("Showing the confirmed sketch in its Job Summary placement. This prototype did not write to production.") }}>Preview in Job Summary</button>
                <button className={styles.secondaryButton} type="button" onClick={downloadDxf}><Download aria-hidden="true" size={18} /> Download DXF</button>
                <button className={styles.textButton} type="button" onClick={openCorrection}>Create corrected revision</button>
              </div>}
            </section>
          </div>
        </div>}

        {stage === "saved" && <div className={styles.savedWorkspace}>
          <header className={styles.savedHeading}>
            <div>
              <div className={styles.headingMeta}>
                <span>Job Summary placement preview</span>
                <span>Job #—</span>
              </div>
              <h1>Mike Henderson</h1>
              <p>Gate fabrication · Needs quote</p>
            </div>
          </header>

          <section className={styles.savedSummary} aria-labelledby="saved-sketch-title">
            <header>
              <div>
                <div className={styles.savedCardMeta}>
                  <span>Drawing</span>
                  <span className={styles.confirmedLabel}><LockKeyhole aria-hidden="true" size={15} /> Confirmed</span>
                </div>
                <h2 id="saved-sketch-title">Owner-confirmed call sketch</h2>
              </div>
            </header>
            <div className={styles.savedDrawing}><GateDrawing spec={spec} compact /></div>
            <div className={styles.savedFacts}>
              <div><span>Overall gate</span><strong>{factWidth} × {factHeight}</strong></div>
              <div><span>Stock</span><strong>{factStock}</strong></div>
              <div><span>Hardware</span><strong>Hinges left · latch right</strong></div>
            </div>
            <div className={styles.savedActions}>
              <button className={styles.primaryButton} type="button" onClick={downloadDxf}><Download aria-hidden="true" size={18} /> Download confirmed DXF</button>
              <button className={styles.secondaryButton} type="button" onClick={restartPrototype}><RotateCcw aria-hidden="true" size={18} /> Replay prototype</button>
            </div>
            <details className={styles.sourceReceipt}>
              <summary>Show source call</summary>
              <TranscriptList through={CALL_MOMENTS.length - 1} />
            </details>
            <p className={styles.prototypeTruth}>Prototype only: this placement is held in the current browser session and was not written to MCSW Jobs.</p>
          </section>
        </div>}
      </div>

      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    </main>
  )
}
