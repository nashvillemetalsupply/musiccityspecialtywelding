"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { SkipLink } from "./skip-link"
import { useRouter } from "next/navigation"
import { costPerLeadTile } from "@/lib/ad-spend.mjs"
import { startOpsPulsePolling } from "@/lib/ops-pulse-polling.mjs"
import { SafeSubmitButton } from "@/app/ops/safe-action-controls"
import { updateLeadStatus } from "@/app/ops/actions"
import { emptyCallSketchSpec } from "@/lib/call-sketch-live.mjs"
import {
  PANEL_FACT_KEYS, PANEL_FACT_LABELS, answeredFactCount, dimensionMark,
  factText, factTone, pricingSentence, sketchAriaLabel, sketchGeometry,
} from "@/lib/call-sketch-panel.mjs"
import type { BoardCallSketch } from "@/lib/call-sketch-store"
import type { OwnerVoiceSnapshot } from "@/lib/voice-of-character"
import { VoicePreview } from "./voice-preview"
import { TrackedCallButton } from "@/app/ops/tracked-call-button"
import type { BoardSignalKind } from "@/lib/shop-brain-invariants.mjs"
import type { PromiseSummary } from "@/lib/commitments"
import type { BoardJobDetail, BoardJobRow, JobBoardStage, MonthCostPerLead, OutTheDoorWeek, WeekAheadDay } from "@/lib/ops-data"
import { shopClaimLabel, shopClaimText, shopSourceLabel } from "@/lib/shop-language"
import { outcomeLine } from "@/lib/call-summary-shared"
import { enableUsage, tapped, TAPS } from "./usage"

type TodayTrailItem = {
  id: number
  occurredAt: string
  kind: string
  body: string
  // Several kinds carry a fixed body, so the customer is what tells two of
  // them apart. Null for shop-wide events like the morning brief.
  customer: string | null
}

export type BoardPaneData = {
  counts: Record<JobBoardStage, number>
  signalCounts: Record<BoardSignalKind, number>
  promises: PromiseSummary
  week: WeekAheadDay[]
  outTheDoor: OutTheDoorWeek
  // Null for crew and signed out: cost per lead is money.
  costPerLead: MonthCostPerLead | null
  medianFirstResponseMinutes: number | null
  todayTrail: TodayTrailItem[]
  callSketch: BoardCallSketch | null
  // Null for crew, signed out, or before the first call has been learned from.
  voice: OwnerVoiceSnapshot | null
  // The tracker: whichever stage the URL asked for, ordered newest-first.
  items: BoardJobRow[]
  details: Map<number, BoardJobDetail>
  resultTotal: number
  pageSize: number
  page: number
  hasNext: boolean
  stage: JobBoardStage
  signal?: BoardSignalKind
  stages: JobBoardStage[]
}

type BoardChrome = {
  date: string
  operatorInitial: string
  owner: boolean
  query: string
  // Resolved on the server from the session role. The board only ever carries
  // this value forward; it never derives it from the URL it was rendered at.
  includeTests: boolean
}

const TRAIL_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

function money(cents: number | null) {
  if (cents === null) return "—"
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`
}

function sinceInWords(iso: string, nowMs: number) {
  const minutes = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? "day" : "days"} ago`
}

// What the panel says about the call itself. A call still on the line has no
// end time to report, and a call with no duration on its receipt yet gets its
// start rather than an invented finish.
function callLine(sketch: BoardCallSketch, nowMs: number) {
  const name = sketch.callerName || "Unknown caller"
  if (sketch.status === "listening") return `${name} · phone call, on the line now`
  if (!sketch.endedAt) return `${name} · phone call, started ${TRAIL_TIME.format(new Date(sketch.startedAt))}`
  return `${name} · phone call, ended ${TRAIL_TIME.format(new Date(sketch.endedAt))} · ${sinceInWords(sketch.endedAt, nowMs)}`
}

// The tracker's stage tabs are JOB_BOARD_STAGES in their canonical order.
// Labels are the product's own stage names, declared here beside the type.
const TAB_LABELS: Record<JobBoardStage, string> = {
  attention: "Attention",
  shop: "In the shop",
  waiting: "Waiting",
  ready: "Ready",
  closed: "Closed",
  board: "Open jobs",
}

// Open jobs first, newest at the top: that is the board he opens to. The
// working stages follow as filters, Closed last. Owner, 2026-09-03: "all jobs
// that are open should be the first ones and the newest one should be the
// top." The server's JOB_BOARD_STAGES order is a data contract; this is the
// tab order.
const TAB_ORDER: JobBoardStage[] = ["board", "attention", "shop", "waiting", "ready", "closed"]

const SOCIAL_POSTING_FOLDER_URL = "https://drive.google.com/drive/u/2/folders/19dNpxjCuQoEsMZ2uX19ZDpZuW-_xReCa"

// The row mark draws the SERVICE, which the schema actually stores, not the
// part's geometry, which it does not. `service` is TEXT, but every writer picks
// from a fixed list — the public form in components/mainstreet-contact.tsx and
// both ops intake forms — so these keys are the values that exist. Anything
// unrecognised, including "Not Sure / Other" and an empty column, falls back to
// the blank sheet of stock. Guessing a part from free text is how a drawing
// starts lying about a job.
const SERVICE_MARKS: Record<string, React.ReactNode> = {
  // A torch: nozzle and arc.
  "Mobile Welding (On-Site)": <>
    <path d="M12 22 20 14l4 4-8 8z" /><path d="M24 14l4-4" />
    <path d="M30 9v-3M33 12h3M32.5 9.5l2-2" />
  </>,
  // A trailer: bed, tongue, two wheels.
  "Trailer / Truck Welding Repair": <>
    <path d="M11 12h20v7H11z" /><path d="M11 17 6 20" />
    <circle cx="16" cy="23" r="3" /><circle cx="27" cy="23" r="3" />
  </>,
  // An I-beam, end on.
  "Equipment & Structural Repair": <>
    <path d="M14 9h18M14 25h18M23 9v16" />
  </>,
  // A railing: top rail and balusters.
  "Architectural Welding & Fabrication": <>
    <path d="M10 12h26M10 25h26M16 12v13M23 12v13M30 12v13" />
  </>,
  // A folded plate.
  "Specialty Fabrication": <>
    <path d="M9 24 17 11l9 9 8-6" />
  </>,
  // A hull on the water.
  "Aluminum / Boat Welding": <>
    <path d="M12 13h22l-4 8H16z" /><path d="M23 13V8" />
    <path d="M8 26q4-3 8 0t8 0 8 0" />
  </>,
  // A mailbox on its post.
  "Custom Wrought Iron Mailboxes": <>
    <path d="M13 20v-4a6 6 0 0 1 12 0v4z" /><path d="M19 20v7" />
    <path d="M25 18v-8M25 10h4v3h-4" />
  </>,
  // A tapered planter with its rim.
  "Custom Metal Planter Boxes": <>
    <path d="M13 13h20l-3 12H16z" /><path d="M11 13h24" />
  </>,
  // A countertop slab with a sink cutout.
  "Stainless Countertops / Manifolds": <>
    <path d="M8 12h30v10H8z" /><path d="M13 15h8v4h-8z" />
    <path d="M8 25h30" />
  </>,
}

function serviceMark(service: string) {
  return SERVICE_MARKS[service.trim()] ?? (
    // A blank sheet of stock. No part, dimension or count implied.
    <rect x="10" y="10" width="26" height="14" />
  )
}

function customerName(lead: BoardJobRow) {
  return `${lead.first_name} ${lead.last_name}`.trim() || "Customer"
}

// The "Came in" cell: how long ago the job arrived, and the date. The list
// is ordered by that same clock (created_at, newest first), so the column
// always reads in order. It used to show board_since -- time in the current
// stage, which resets whenever the job is touched -- and a 36-minute job sat
// above a 25-minute one. Two clocks in one column; now it is one.
function waitingAge(iso: string, nowMs: number) {
  const minutes = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000))
  if (!Number.isFinite(minutes)) return "—"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(Math.floor(minutes % 60)).padStart(2, "0")}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${String(hours % 24).padStart(2, "0")}h`
}

function waitingDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  })
}

// The money cell names the field it is showing, in the shop's own words:
// paid, invoiced, booked, estimated — or honestly "no price". Crew rows
// arrive with every money field nulled by projectLeadForRole, so a crew
// member sees "— no price" on every job; the owner sees the real number.
function moneyFor(lead: BoardJobRow): { value: string; note: string; confirmHref?: string } {
  if (lead.paid_at) {
    const cents = lead.paid_amount_cents ?? lead.invoice_total_cents ?? lead.revenue_cents
    return cents !== null ? { value: money(cents), note: "paid" } : { value: "—", note: "no price" }
  }
  if (lead.invoice_total_cents !== null) return { value: money(lead.invoice_total_cents), note: "invoiced" }
  if (lead.status === "won" && lead.revenue_cents !== null) return { value: money(lead.revenue_cents), note: "booked" }
  if (lead.estimate_value_cents !== null) return { value: money(lead.estimate_value_cents), note: "estimated" }
  // Heard on the call, not yet confirmed. The question mark is the honesty;
  // the tap lands on the quote-capture slip on the work order.
  if (lead.heard_quote_cents !== null && lead.heard_quote_cents > 0) {
    return { value: `${money(lead.heard_quote_cents)}?`, note: "confirm", confirmHref: `/ops/leads/${lead.id}#quote-capture` }
  }
  return { value: "—", note: "no price" }
}

// Tone comes from where the job sits and which signal raised it. The label
// itself is lead.board_reason verbatim — never mapped, never paraphrased.
function chipTone(lead: BoardJobRow): "stop" | "warn" | "good" | "info" {
  if (lead.board_stage === "ready") return "good"
  if (lead.board_stage === "attention") {
    return lead.board_stop_signal ? "stop" : "warn"
  }
  return "info"
}

const CHIP_CLASS = { stop: "chip--stop", warn: "chip--warn", good: "chip--good", info: "chip--info" } as const

// The open card's progress line, one step per milestone the row already
// carries: created, newest photo, quoted, won, paid.
const STAGE_NAMES = ["Came in", "Photos", "Quoted", "Booked", "Paid"]

// How much of the call stays unfolded. Four lines is the opening exchange; a
// live call only ever carries three, so it never folds at all.
const PANEL_OPEN_LINES = 4

// fontClass carries the next/font variable classes down from page.tsx. The font
// instances are created in a server module (app/fonts.ts), so this client
// component can only be handed the class names, never the instances.
export function JobControl({ board, chrome, menu, calls, calendar, nowMs, fontClass = "" }: { board: BoardPaneData; chrome: BoardChrome; menu?: React.ReactNode; calls?: React.ReactNode; calendar?: React.ReactNode; nowMs: number; fontClass?: string }) {
  const [openJobId, setOpenJobId] = useState<number | null>(null)
  const router = useRouter()
  // Owner-only usage counts (see ./usage.ts). Flipped here, once, from the
  // role the server resolved; crew never reach the SDK.
  useEffect(() => { enableUsage(chrome.owner) }, [chrome.owner])
  const { details: jobDetails } = board
  const outTheDoor = board.outTheDoor
  // Owner only: getMonthCostPerLead returns null for crew, so crew never
  // get the tile at all.
  const cpl = board.costPerLead && costPerLeadTile(board.costPerLead, nowMs)
  const sketch = board.callSketch
  // Signed out, or with nothing sketched yet, the panel renders the same
  // frame against an empty spec: seven facts unstated, zero answered.
  const spec = sketch?.spec ?? emptyCallSketchSpec()
  const answered = answeredFactCount(spec)
  const pricingGap = pricingSentence(spec)
  // The sketch only understands gates and frames. A call about anything else
  // answers none of its seven facts, and the panel used to print seven "Not
  // stated" rows after a real conversation. When the drawing heard nothing,
  // the slots carry what the call did say instead.
  const heard = sketch?.heard ?? []
  // The fallback opens on whether there is anything to draw, not on the
  // answered count. "Frame" in a sentence about a trailer axle used to count
  // as an answered fact, which held it shut and printed six "Not stated" rows
  // beside a rectangle nobody had described; and a gate the customer had in
  // fact measured — "about 26 inches wide" — counted as nothing at all,
  // because a hedged measurement is not an answer. Both are drawings.
  const drawing = sketchGeometry(spec)
  // The post-call read wins over both fallbacks: it is the whole call in five
  // lines, where the extractor's claims were whatever survived into a record.
  const summary = sketch?.summary ?? null
  const showSummary = !drawing.hasDrawing && summary !== null
  const showHeard = !drawing.hasDrawing && !showSummary && heard.length > 0
  // A call still on the line shows its tail; an ended one shows its opening,
  // where the customer says what they need. Either way the count is honest
  // about what the column left out.
  const onTheLine = sketch?.status === "listening"
  const unshownLines = Math.max(0, (sketch?.totalLines ?? 0) - (sketch?.lines.length ?? 0))
  // An ended call brings fourteen lines, which pushed the tracker most of a
  // screen down the page. The opening stays in the open — that is where the
  // customer says what he needs — and the rest folds into a native disclosure.
  const openLines = sketch?.lines.slice(0, PANEL_OPEN_LINES) ?? []
  // The need is the headline above these slots, so it is not repeated here.
  const summarySlots = summary ? [
    ...summary.details.map((detail, index) => ({ key: `detail-${index}`, label: index === 0 ? "Details" : "", tone: "said", text: detail })),
    ...(summary.where_when ? [{ key: "where", label: "Where / when", tone: "said", text: summary.where_when }] : []),
    ...(summary.next_question ? [{ key: "ask", label: "Still to ask", tone: "ambig", text: summary.next_question }] : []),
  ] : []
  // The read leads with what happened, because the owner answers on his own
  // phone and reads this afterwards: the call is done, the question is what
  // the board did with it.
  const outcomeLabel = summary
    ? summary.auto === "filed" ? "Filed to the caller's open job"
      : sketch?.leadId != null || summary.auto === "saved" ? "Saved as a job"
      : summary.is_job === "no" ? "Probably not a job"
      : summary.auto === "failed" ? "Could not save it"
      : "Could not tell if it is a job"
    : ""
  const askLabel = showSummary ? outcomeLabel : showHeard ? "What the call said" : "Ask next"
  const askBody = showSummary
    ? (summary?.need || "Nothing asked for on this call.")
    : showHeard ? "No gate or frame was described, so the drawing stays blank." : spec.nextQuestion
  // The sketch tile is only worth its third of the card when there is a
  // drawing on it. A read call with no gate or frame hides it.
  const showTile = drawing.hasDrawing || !showSummary
  const slots = showSummary
    ? summarySlots
    : showHeard
    ? heard.map((fact) => ({ key: fact.predicate, label: fact.label, tone: "said", text: fact.text }))
    : PANEL_FACT_KEYS.map((key) => ({
      key,
      label: PANEL_FACT_LABELS[key],
      tone: factTone(spec[key]),
      text: factText(key, spec[key]),
    }))
  const countLine = board.resultTotal === 0
    ? "No jobs in this stage"
    : `Showing ${board.items.length} of ${board.resultTotal}`
  const boardHref = ({
    stage = board.stage,
    signal = board.signal,
    page,
  }: {
    stage?: JobBoardStage
    signal?: BoardSignalKind | null
    page?: number
  } = {}) => {
    const params = new URLSearchParams()
    if (stage !== "board") params.set("stage", stage)
    if (chrome.query) params.set("q", chrome.query)
    if (signal) params.set("signal", signal)
    if (page !== undefined && page > 1) params.set("p", String(page))
    // An owner who opened the board in test mode keeps it across every stage,
    // signal and paging hop. Crew and signed-out renders never see true here,
    // so the param cannot be manufactured by clicking around.
    if (chrome.includeTests) params.set("tests", "1")
    const search = params.toString()
    return `/board${search ? `?${search}` : ""}`
  }
  // The pulse read is one aggregate-only request. The board's expensive server
  // loaders rerun only after a visible change in events or calls.
  useEffect(() => {
    const polling = startOpsPulsePolling({ onChange: () => router.refresh() })
    return () => polling.stop()
  }, [router])

  useEffect(() => {
    const root = document.documentElement
    const key = "mcsw-theme"
    const themeButton = document.getElementById("theme")

    function toggleTheme() {
      const dark = root.getAttribute("data-theme") === "dark"
        || (!root.hasAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches)
      const next = dark ? "light" : "dark"
      root.setAttribute("data-theme", next)
      try {
        window.localStorage.setItem(key, next)
      } catch {}
    }

    themeButton?.addEventListener("click", toggleTheme)

    // The tracker tabs used to toggle aria-pressed here. They are now real
    // links that refetch the page server-side (?stage=...), so the pressed
    // state comes from the server render (aria-current), not from a click.
    return () => {
      themeButton?.removeEventListener("click", toggleTheme)
    }
  }, [])

  return (
    <div className={`${fontClass} app`.trim()}>
      <SkipLink label="Skip to the job tracker" />
    
      <header className="top">
        <Link className="logo-home" href="/board" aria-label="Job Control home">
          <img className="logo" alt="" src="/images/optimized/mcs_welding_logo.webp" />
        </Link>
        <span className="when">{chrome.date}</span>
        <form className="find" action="/board" method="get" role="search" onSubmit={() => tapped(TAPS.search)}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input name="q" type="search" defaultValue={chrome.query} autoComplete="off" placeholder="Customer, job number, or what it is" aria-label="Search jobs" />
          {chrome.includeTests && <input type="hidden" name="tests" value="1" />}
        </form>
        <div className="top-end">
          <Link className="btn btn--go" href="/ops/intake/new">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M8 3.5v9M3.5 8h9"/></svg>New job
          </Link>
          <button className="icon" id="theme" type="button" aria-label="Switch between the light and dark board">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8A4.4 4.4 0 0 1 8 2.2z"/></svg></button>
          {chrome.operatorInitial && <span className="who-dot" aria-label="Signed-in operator">{chrome.operatorInitial}</span>}
          {menu && <div className="board-more">{menu}</div>}
        </div>
      </header>
    
      <nav className="rail" aria-label="Board">
        <Link className="rl" href="/board" aria-label="Board" aria-current="page"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/></svg></Link>
        <Link className="rl" href="/board/customers" aria-label="Customers"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="6" r="2.4"/><path d="M3.2 13c.6-2.3 2.5-3.5 4.8-3.5S12.2 10.7 12.8 13"/></svg></Link>
        <Link className="rl" href="/board?stage=waiting" aria-label="Quotes"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 6h5M5.5 9h3"/></svg></Link>
        {chrome.owner && <Link className="rl" href="/ops/analytics" aria-label="Money"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="4" width="12" height="8" rx="1.5"/><path d="M2 7h12"/></svg></Link>}
        <span className="rl-gap"></span>
        <Link className="rl" href="/ops/install" aria-label="Help"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="6"/><path d="M6.4 6.2a1.7 1.7 0 1 1 2.2 1.9v1"/><path d="M8 11.4h.01"/></svg></Link>
      </nav>

      {onTheLine && sketch && <section className="live-call-jump" aria-label="Live MCSW call">
        <div><strong>Welding call live</strong><span>{callLine(sketch, nowMs)}</span></div>
        {sketch.leadId != null
          ? <Link className="btn btn--sm btn--go" href={`/ops/leads/${sketch.leadId}`}>Open job</Link>
          : sketch.draftId
            ? <Link className="btn btn--sm btn--go" href={`/ops/intake/${sketch.draftId}`}>Open call</Link>
            : null}
      </section>}
    
    
      <main id="main" tabIndex={-1} className="main">
        {/* The figures lead: open jobs and this week's money. Owner moved
            them up on 2026-09-03 — at the bottom
            they read as an afterthought. */}
        <section className="card figures">
          <div className="figure">
            <p className="figure-label">Open jobs</p>
            <p className="n"><b className="t-display">{board.counts.board}</b><span>on the books</span></p>
            <div className="under">
              <span className="chip chip--good"><i></i>{board.counts.shop} in the shop</span>
              <span>{board.counts.waiting} waiting on customers &middot; {board.counts.ready} ready</span>
            </div>
          </div>
          <div className="figure">
            <p className="figure-label">Closed this week</p>
            <p className="n"><b className="t-display">{money(outTheDoor.revenueCents)}</b><span>this week</span></p>
            <div className="under">
              {outTheDoor.jobs > 0 && <span className="bar" role="img"
                aria-label={`${outTheDoor.jobs} ${outTheDoor.jobs === 1 ? "job" : "jobs"} went out this week: ${outTheDoor.paidJobs} paid, ${outTheDoor.jobs - outTheDoor.paidJobs} not`}>
                {/* One mark per job, capped so a heavy week cannot overrun the
                    field. The count beside it stays exact. */}
                {Array.from({ length: Math.min(outTheDoor.jobs, 10) }, (_, index) =>
                  <i className={index < outTheDoor.paidJobs ? "good" : "warn"} key={index}></i>)}
              </span>}
              {outTheDoor.revenueCents !== null &&
                <span>{outTheDoor.paidJobs} of {outTheDoor.jobs} paid &middot; <b>{money(outTheDoor.stillOutCents)}</b> still out</span>}
            </div>
          </div>
        </section>
        <section className="card social-post-card" aria-labelledby="social-post-title">
          <div className="social-post-copy">
            <p className="social-post-kicker">After the job</p>
            <h2 id="social-post-title">Share the work</h2>
            <p>Upload a photo or video to the MCSW Social Posts folder. The automated poster handles the rest and sends it to our social channels.</p>
          </div>
          <a className="btn btn--go social-post-button" href={SOCIAL_POSTING_FOLDER_URL} target="_blank" rel="noreferrer">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><circle cx="8" cy="6.5" r="1.5" /><path d="m3.5 11 2.4-2.4 1.8 1.8 1.4-1.4 2.9 2.9" /></svg>
            Upload photo or video
          </a>
        </section>
        {/* Calls waiting to become jobs, collapsed to one bar so the tracker
            stays the first thing on the screen. Rendered by the server page;
            null when the queue is empty. */}
        {calls}
        <section className="card">
          <div className="track-top">
            <h1 className="t-title">Job tracker</h1>
            <span className="count">{countLine}</span>
            <span className="end">
              {board.signal &&
                <Link className="btn btn--sm btn--edge" href={boardHref({ signal: null })}>Clear signal filter</Link>}
              {/* The tracker is genuinely ordered newest-first — the page asks
                  for order:"newest" — so the sort chip is an honest active
                  label, not a button that claims a sort it does not perform. */}
              <span className="chip chip--info track-sort" title="Jobs are ordered by when they came in, newest at the top">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8.5 6.5 12 13 4.5"/></svg>
                Newest first
              </span>
            </span>
          </div>

          <div className="tabs" aria-label="Job stages">
            {TAB_ORDER.filter((stage) => board.stages.includes(stage)).map((stage) => (
              <Link className="tab" key={stage} href={`/board?stage=${stage}${chrome.includeTests ? "&tests=1" : ""}`} aria-current={board.stage === stage ? "page" : undefined} onClick={() => tapped(TAPS.stageTab, { stage })}>
                {TAB_LABELS[stage]} <b className={stage === "attention" ? "hot" : undefined}>{board.counts[stage]}</b>
              </Link>
            ))}
          </div>

          <div className="cols colhead">
            <span>Part</span>
            <span>Customer</span>
            <span className="right c-wait">Came in</span>
            <span className="right c-money">Money</span>
            <span className="c-state">Why it needs you</span>
            <span className="c-do"></span>
          </div>

          {board.items.length === 0
            ? <div className="track-empty">
                <p>No jobs in this stage right now.</p>
              </div>
            : board.items.map((lead) => {
                const moneyCell = moneyFor(lead)
                const detail = jobDetails.get(lead.id)
                const activeClaims = detail?.activeClaims ?? []
                const commitments = detail?.commitments ?? []
                const newestPhotoAt = detail?.newestPhotoAt ?? null
                const lineItems = detail?.lineItems ?? []
                const isOpen = openJobId === lead.id
                const panelPhoto = lead.photos[lead.photos.length - 1]
                const phone = lead.phone_is_placeholder ? "" : lead.phone.trim()
                // Same rule the pane's Broken count uses: nothing ever stores
                // `status = 'broken'`, so a promise is broken when its date has
                // passed and it is still owed. Reading the status here is what
                // made this row say "No broken promise is recorded" forever.
                // `we_promised` only, the same boundary the pane's count uses.
                // This row loads both directions, so without it the shop gets
                // blamed for a promise the *customer* made and missed.
                const brokenPromise = commitments.find((commitment) =>
                  commitment.direction === "we_promised"
                  && commitment.status === "open"
                  && commitment.due_at !== null
                  && new Date(commitment.due_at).getTime() < nowMs)
                // With nothing overdue, the promise worth showing is the next one due.
                const nextPromise = commitments
                  .filter((commitment) => commitment.direction === "we_promised"
                    && commitment.status === "open" && commitment.due_at !== null)
                  .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))[0]
                // An open card carries one green button -- Close job or Call --
                // so the row's Open job steps back to an outline while it is open.
                const hasPrimary = Boolean(phone) || lead.board_stage === "ready"
                const lineItemTotal = lineItems.reduce((total, item) => total + item.amountCents, 0)
                const lineItemsMismatch = lineItems.length > 0
                  && lead.estimate_value_cents !== null
                  && lineItemTotal !== lead.estimate_value_cents
                const personJobCount = Number(lead.person_job_count)
                const priorJobs = Number.isFinite(personJobCount) ? Math.max(0, personJobCount - 1) : null

                const centralDate = (iso: string | null) => {
                  if (!iso) return "No date"
                  const date = new Date(iso)
                  if (Number.isNaN(date.getTime())) return "Date not recorded"
                  return date.toLocaleDateString("en-US", {
                    timeZone: "America/Chicago",
                    month: "short",
                    day: "numeric",
                  })
                }
                const formatCents = (cents: number) => `$${(cents / 100).toLocaleString("en-US", {
                  minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
                  maximumFractionDigits: 2,
                })}`
                const promiseLine = brokenPromise
                  ? { label: "Missed promise", text: `${brokenPromise.summary} · was due ${centralDate(brokenPromise.due_at)}`, late: true }
                  : nextPromise
                    ? { label: "We promised", text: `${nextPromise.summary} · due ${centralDate(nextPromise.due_at)}`, late: false }
                    : lead.scheduled_at
                      ? { label: "Scheduled", text: centralDate(lead.scheduled_at), late: false }
                      : null
                const stageMilestones = [
                  lead.created_at,
                  newestPhotoAt,
                  lead.quoted_at,
                  lead.won_at,
                  lead.paid_at,
                ]
                const furthestStage = stageMilestones.reduce(
                  (furthest, milestone, index) => milestone ? index : furthest,
                  -1,
                )
                const stageState = (index: number): "done" | "now" | "off" => {
                  if (!stageMilestones[index]) return "off"
                  if (index < furthestStage || (index === stageMilestones.length - 1 && lead.paid_at)) return "done"
                  return "now"
                }

                return <article className="job" data-open={isOpen ? "" : undefined} key={lead.id}>
                  {/* The whole row toggles the panel — the mockup's hover wash
                      invites a row click, and the chevron alone was missed.
                      Clicks on the row's own links and buttons keep their job. */}
                  <div className="cols job-row"
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a, button")) return
                      setOpenJobId((current) => current === lead.id ? null : lead.id)
                    }}>
                    <span className="part">
                      {/* Keyed on the service the job was booked under. The
                          stroke settings live here so each mark is only its
                          own geometry.

                          The row's second line prints the message when there
                          is one, so on most rows this drawing is the only
                          place the service appears. That makes it content,
                          not decoration — it gets named. With no service to
                          name it goes back to being decorative. */}
                      <svg viewBox="0 0 46 34" fill="none"
                        stroke="var(--draw-line)" strokeWidth="1.5"
                        strokeLinejoin="round" strokeLinecap="round"
                        {...(lead.service.trim()
                          ? { role: "img", "aria-label": lead.service.trim() }
                          : { "aria-hidden": true })}>
                        {serviceMark(lead.service)}
                      </svg>
                    </span>
                    <span className="cust">
                      <b>{customerName(lead)}</b>
                      <span>{lead.message.trim() || lead.service}</span>
                    </span>
                    <span className="val right c-wait">{waitingAge(lead.created_at, nowMs)} <em>{waitingDate(lead.created_at)}</em></span>
                    <span className="val right c-money">
                      {moneyCell.confirmHref
                        ? <Link className="heard-quote" href={moneyCell.confirmHref} title="Heard on the call, not confirmed yet" onClick={() => tapped(TAPS.heardPrice)}>{moneyCell.value} <em>{moneyCell.note}</em></Link>
                        : <>{moneyCell.value} <em>{moneyCell.note}</em></>}
                    </span>
                    <span className="c-state"><span className={`chip ${CHIP_CLASS[chipTone(lead)]}`}><i></i>{lead.board_reason}</span></span>
                    <span className="doing c-do">
                      <Link className={`btn btn--sm ${isOpen && hasPrimary ? "btn--edge" : "btn--go"}`} href={`/ops/leads/${lead.id}`} onClick={() => tapped(TAPS.jobOpen)}>Open job</Link>
                      <button className="icon" type="button"
                        aria-label={`${isOpen ? "Collapse" : "Expand"} ${customerName(lead)} job details`}
                        aria-expanded={isOpen} aria-controls={`job-detail-${lead.id}`}
                        onClick={() => { tapped(TAPS.jobExpand); setOpenJobId((current) => current === lead.id ? null : lead.id) }}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9">
                          <path d={isOpen ? "M4 10 8 6l4 4" : "M4 6 8 10l4-4"}/>
                        </svg>
                      </button>
                    </span>
                  </div>

                  {/* Open, the card reads in the order he asks: what do I do
                      now, where is the job, what is it -- then the photo, the
                      specs and the money. Open job stays in the row above. */}
                  {isOpen && <div className="detail" id={`job-detail-${lead.id}`}>
                    {/* Handoff belongs with the actions, not in the row: the
                        row's cell is a fixed track shared with the reason chip,
                        and a third control there overran it. Text permission
                        lives on the job page; the card keeps one obvious
                        action, green, and everything else outlined. */}
                    {hasPrimary && <div className="why-end acts">
                      <span className="end">
                        {lead.board_stage === "ready" && <Link className="btn btn--sm btn--go" href={`/ops/leads/${lead.id}#finish-close`}>Close job</Link>}
                        {phone && <TrackedCallButton leadId={lead.id} phone={phone} label="Call" compact
                          className={`btn btn--sm ${lead.board_stage === "ready" ? "btn--edge" : "btn--go"}`} />}
                        {phone && lead.text_ready && <Link className="btn btn--sm btn--edge" href={`/ops/leads/${lead.id}?replyChannel=text#job-reply`}>Text</Link>}
                      </span>
                    </div>}

                    <ol className="stages" aria-label="Where the job is">
                      {STAGE_NAMES.map((name, index) => {
                        const state = stageState(index)
                        return <li className={`stage${state === "off" ? " off" : ""}`} key={name}>
                          <div className="stage-top">
                            <span className={`knot${state === "now" ? " now" : state === "off" ? " off" : ""}`}>
                              {state === "done"
                                ? <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 5"/></svg>
                                : state === "now"
                                  ? <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="4.5"/></svg>
                                  : null}
                            </span>
                            {index < STAGE_NAMES.length - 1 && <span className={`wire${state === "done" ? "" : " off"}`}></span>}
                          </div>
                          <div className="stage-body">
                            <b>{name}</b>
                            {state !== "off" && <span>{centralDate(stageMilestones[index])}</span>}
                          </div>
                        </li>
                      })}
                    </ol>

                    <div className="detail-main">
                      <dl className="facts">
                        {lead.service.trim() && <div><dt>Job type</dt><dd>{lead.service.trim()}</dd></div>}
                        <div><dt>Came in</dt><dd>{waitingDate(lead.created_at)} &middot; {shopSourceLabel(lead.source)}</dd></div>
                        {/* Crew rows arrive with every money field nulled, so
                            a price line would only ever say "not priced". */}
                        {chrome.owner && <div><dt>Price</dt><dd>
                          {moneyCell.confirmHref
                            ? <Link className="heard-quote" href={moneyCell.confirmHref} onClick={() => tapped(TAPS.heardPrice)}>{money(lead.heard_quote_cents)} heard on the call — tap to confirm</Link>
                            : moneyCell.note === "estimated" && lead.estimate_value_cents !== null
                              ? <Link className="heard-quote" href={`/ops/leads/${lead.id}#lead-estimate`}>{moneyCell.value} {moneyCell.note}</Link>
                              : moneyCell.value === "—" ? "Not priced yet" : `${moneyCell.value} ${moneyCell.note}`}
                        </dd></div>}
                        {promiseLine && <div className={promiseLine.late ? "late" : undefined}><dt>{promiseLine.label}</dt><dd>{promiseLine.text}</dd></div>}
                        <div><dt>Photos</dt><dd>{lead.photo_count > 0
                          ? `${lead.photo_count} ${lead.photo_count === 1 ? "photo" : "photos"}${newestPhotoAt ? ` · newest ${centralDate(newestPhotoAt)}` : ""}`
                          : "None yet"}</dd></div>
                        {priorJobs !== null && priorJobs > 0 && <div><dt>Repeat customer</dt><dd>{priorJobs} earlier {priorJobs === 1 ? "job" : "jobs"}</dd></div>}
                      </dl>
                      <div className="want">
                        <h2>What they want</h2>
                        <p>{lead.message.trim() || lead.service}</p>
                        {lead.status_reason.trim() && <p>{lead.status_reason.trim()}</p>}
                        {lead.notes.trim() && <p>{lead.notes.trim()}</p>}
                      </div>
                    </div>

                    <div className="detail-side">
                      {panelPhoto && <a className="photo" href={`/api/ops/photo?lead=${lead.id}&path=${encodeURIComponent(panelPhoto.pathname)}`} target="_blank" rel="noreferrer">
                        <svg className="plan" viewBox="0 0 380 244" role="img"
                          aria-label={`Job photo for ${customerName(lead)}, opens full size`}>
                          <rect width="380" height="244" fill="var(--draw-fill)" />
                          <image href={`/api/ops/photo?lead=${lead.id}&path=${encodeURIComponent(panelPhoto.pathname)}`}
                            width="380" height="244" preserveAspectRatio="xMidYMid slice" />
                        </svg>
                      </a>}
                      {activeClaims.length > 0 && <div>
                        <h2>Specs</h2>
                        <div className="spec">
                          {activeClaims.map((claim) => <span key={claim.id}>
                            {shopClaimLabel(claim.predicate)} <b>{shopClaimText(claim.value)}</b>
                          </span>)}
                        </div>
                      </div>}
                      {/* Owner only: line items are empty and the quote is
                          nulled for crew, so the table would claim neither
                          exists. */}
                      {chrome.owner && <div>
                        <h2>Price breakdown</h2>
                        <table className="sum">
                          <tbody>
                            {lineItems.length > 0
                              ? lineItems.map((item) => <tr key={item.id}>
                                  <td>{item.label}{item.note && <> <span className="q">{item.note}</span></>}</td>
                                  <td>{formatCents(item.amountCents)}</td>
                                </tr>)
                              : <tr><td colSpan={2}>No line items entered. <Link href={`/ops/leads/${lead.id}#lead-line-items`}>Add them</Link></td></tr>}
                            <tr className="total">
                              <td>Quoted</td>
                              <td>{lead.estimate_value_cents === null ? "No price" : formatCents(lead.estimate_value_cents)}</td>
                            </tr>
                          </tbody>
                        </table>
                        {lineItemsMismatch && <p className="t-caption">
                          Entered lines total {formatCents(lineItemTotal)}; the quoted price is {formatCents(lead.estimate_value_cents!)}.
                        </p>}
                        <div className="why-end">
                          <span className="end">
                            <Link className="btn btn--sm btn--edge" href={`/ops/leads/${lead.id}#lead-estimate`}>Change the price</Link>
                          </span>
                        </div>
                      </div>}
                      {/* Junk gets off the board here rather than two pages
                          away, last and small so it is never the thumb's first
                          target. Same owner-only action the job page uses, so
                          the immutable receipt and the notification
                          suppression come with it. */}
                      {chrome.owner && <form className="not-a-job" action={updateLeadStatus}>
                        <input type="hidden" name="leadId" value={lead.id} />
                        <input type="hidden" name="status" value="spam" />
                        <input type="hidden" name="reason" value="Marked Not a job from the board." />
                        <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Removing...">Not a job</SafeSubmitButton>
                      </form>}
                    </div>
                  </div>}
                </article>
              })}
          {(board.hasNext || board.page > 1) && (
            <nav className="pager" aria-label="More jobs">
              {board.page > 1 && (
                <Link className="btn btn--sm" href={boardHref({ page: board.page - 1 })}>Back</Link>
              )}
              {board.hasNext && (
                <Link className="btn btn--sm btn--edge" href={boardHref({ page: board.page + 1 })}>
                  Show the next {Math.min(board.pageSize, board.resultTotal - board.page * board.pageSize)}
                </Link>
              )}
            </nav>
          )}
        </section>

        {/* Cost per lead, as Fable ruled it 2026-09-18: all ad spend over
            every real lead this Central month, from any source. It sits under
            the tracker -- the top of the board belongs to the jobs -- as one
            money line. Spend arrives from One Roof each morning; there is no
            hand entry. Owner only: costPerLead is null for crew. */}
        {cpl && <section className="card cpl" aria-label="Cost per lead">
          <p className="cpl-label">Cost per lead</p>
          <p className="n"><b className="t-title">{cpl.big}</b>{cpl.beside && <span>{cpl.beside}</span>}</p>
          <p className="under">{cpl.under}</p>
          {cpl.channelsLine && <p className="under">{cpl.channelsLine}</p>}
        </section>}
        {calendar}

        <aside className="card" aria-label="Last call">
          <div className="call-top">
            <h2 className="t-title">{onTheLine ? "On the phone" : "Last call"}</h2>
            <span className="sub">{sketch ? callLine(sketch, nowMs) : "No calls yet"}</span>
            <span className="end">
              {sketch?.leadId != null &&
                <Link className="btn btn--sm btn--edge" href={`/ops/leads/${sketch.leadId}`}>Open the job</Link>}
              {/* A call with no job yet is the one the board could not act on:
                  it showed the conversation and offered nothing to do with it.
                  The draft is only linked while intake will still open it. */}
              {sketch?.leadId == null && sketch?.draftId &&
                <Link className="btn btn--sm btn--edge" href={`/ops/intake/${sketch.draftId}`}>Save this call as a job</Link>}
            </span>
          </div>
    
          <div className={showTile ? "call-cols" : "call-cols call-cols--read"}>
            {showTile && <div>
              <figure className="tile">
                <svg viewBox="0 0 244 172" role="img" aria-label={sketchAriaLabel(spec)}>
                  <rect width="244" height="172" fill="var(--sketch-ground)"></rect>
                  <g stroke="var(--sketch-grid)" strokeWidth="1">
                    <path d="M0 24h244M0 48h244M0 72h244M0 96h244M0 120h244M0 144h244"></path>
                    <path d="M24 0v172M48 0v172M72 0v172M96 0v172M120 0v172M144 0v172M168 0v172M192 0v172M216 0v172"></path>
                  </g>
                  {/* The copy beside this tile says the drawing stays blank on
                      a call that described no gate or frame. Until this guard
                      it said that over a full elevation. */}
                  {!showHeard && !showSummary && <>
                    {/* A box drawn from hedged numbers is drawn as a hedge. */}
                    <rect x={drawing.x} y={drawing.y} width={drawing.w} height={drawing.h}
                      fill="none" stroke="var(--sketch-line)" strokeWidth={drawing.stroke}
                      strokeDasharray={drawing.outlineUncertain ? "6 4" : undefined}></rect>
                    <g stroke="var(--sketch-line)"
                      strokeWidth={drawing.railsStated ? drawing.stroke * 0.7 : 1.6}
                      strokeDasharray={drawing.railsStated ? undefined : "4 4"}
                      opacity={drawing.railsStated ? 1 : .45}>
                      {drawing.rails.map((railY) =>
                        <path key={railY} d={`M${drawing.x} ${railY}h${drawing.w}`}></path>)}
                    </g>
                    {/* A frame export never invents gate hardware, and neither
                        does the picture of one. */}
                    {drawing.hinge && <g fill="var(--sketch-line)">
                      {drawing.hinge.ys.map((hingeY) =>
                        <circle key={hingeY} cx={drawing.hinge!.x} cy={hingeY} r={drawing.hinge!.r}></circle>)}
                    </g>}
                    {drawing.latch && <rect fill="var(--sketch-line)"
                      x={drawing.latch.x - drawing.latch.size / 2} y={drawing.latch.y - drawing.latch.size}
                      width={drawing.latch.size} height={drawing.latch.size * 2}></rect>}
                    <g stroke="var(--sketch-dim)" strokeWidth="1">
                      <path d={drawing.widthDim}></path>
                      <path d={drawing.heightDim}></path>
                    </g>
                    {/* 15 user units, not 12, and the board's number face, not
                        "Instrument Sans" — which is loaded nowhere in this repo
                        and was silently falling back to a system font. These
                        are dimension marks: they are read, so the 14px floor
                        applies to them exactly as it applies to a column. The
                        2026-09-04 baseline caught this — `text.` at 12px was
                        the smallest text on /board at 320, 375 and 768. */}
                    <g fontFamily="var(--font-display)" fontSize="15" fontWeight="600" fill="var(--sketch-line)">
                      {/* Width along the bottom, height up the left, stock size
                          outside the right rail — a fact that is not an answer
                          stays a question mark on the paper. */}
                      <text x={drawing.widthText.x} y={drawing.widthText.y} textAnchor="middle">{dimensionMark(spec.width)}</text>
                      <text x={drawing.heightText.x} y={drawing.heightText.y} textAnchor="middle">{dimensionMark(spec.height)}</text>
                      <text x={drawing.stockText.x} y={drawing.stockText.y} textAnchor="middle">{dimensionMark(spec.stockSize)}</text>
                    </g>
                  </>}
                </svg>
                <figcaption>ROUGH CALL SKETCH &middot;<br />NOT A FABRICATION DRAWING</figcaption>
              </figure>
              <p className="t-caption" style={{ "marginTop": "var(--s3)" }}>Every answer that comes back edits it.</p>
            </div>}
    
            <div>
              <p className="ask">{askLabel}</p>
              <p>{askBody}</p>
              <div className={showSummary ? "slots slots--read" : "slots"}>
                {slots.map((slot) =>
                  <span className="slot" key={slot.key}>
                    <span className="k">{slot.label}</span>
                    <span className={`v ${slot.tone}`}>{slot.text}</span>
                  </span>)}
              </div>
              <div className="call-end">
                <span>{showSummary && summary
                  ? outcomeLine(summary, sketch?.leadId ?? null)
                  : showHeard
                  ? `${heard.length} fact${heard.length === 1 ? "" : "s"} heard on this call`
                  : `${answered} of ${PANEL_FACT_KEYS.length} answered${pricingGap && ` · ${pricingGap}`}`}</span>
                {sketch?.leadId != null &&
                  <span className="end"><Link className="btn btn--sm btn--go" href={`/ops/leads/${sketch.leadId}#spike`}>Text him the three</Link></span>}
              </div>
            </div>
    
            <div>
              <p className="t-label" style={{ "marginBottom": "var(--s2)" }}>{onTheLine ? "Being said now" : "The call itself"}</p>
              {/* Live, the tail of the call is the point. Ended, the read above
                  has already said what mattered, so the whole transcript folds
                  behind one line and opens only when he wants the words. */}
              {sketch && sketch.lines.length > 0
                ? onTheLine
                  ? openLines.map((line) =>
                      <p className={line.speaker === "Shop" ? "spoke" : "spoke them"} key={line.sequenceId}>
                        <b>{line.speaker}</b><span>{line.transcript}</span>
                      </p>)
                  : <details className="spoke-more" onToggle={(event) => { if (event.currentTarget.open) tapped(TAPS.transcriptOpen) }}>
                      <summary>Read the whole call · {sketch.totalLines} line{sketch.totalLines === 1 ? "" : "s"}</summary>
                      {sketch.lines.map((line) =>
                        <p className={line.speaker === "Shop" ? "spoke" : "spoke them"} key={line.sequenceId}>
                          <b>{line.speaker}</b><span>{line.transcript}</span>
                        </p>)}
                    </details>
                : <p className="t-caption">Nothing has been transcribed on this call yet.</p>}
              {unshownLines > 0 &&
                <p className="t-caption" style={{ "marginTop": "var(--s2)" }}>{unshownLines} more line{unshownLines === 1 ? "" : "s"} on this call.</p>}
            </div>
          </div>
          {chrome.owner && <VoicePreview voice={board.voice} />}
        </aside>
    

      </main>
    </div>
  )
}
