"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BOARD_SIGNAL_LABELS, BOARD_WEIGHTS } from "@/lib/shop-brain-invariants.mjs"
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
import type { BoardJobDetail, BoardJobRow, JobBoardStage, OutTheDoorWeek, WeekAheadDay } from "@/lib/ops-data"
import { shopClaimLabel, shopClaimText, shopEventLabel, shopSourceLabel } from "@/lib/shop-language"

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
  medianFirstResponseMinutes: number | null
  todayTrail: TodayTrailItem[]
  callSketch: BoardCallSketch | null
  // Null for crew, signed out, or before the first call has been learned from.
  voice: OwnerVoiceSnapshot | null
  // The tracker: whichever stage the URL asked for, ordered oldest-first.
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

// Descending weight, which is also the order the mockup was approved in.
const SIGNAL_ORDER = (Object.keys(BOARD_WEIGHTS.signal) as BoardSignalKind[])
  .sort((a, b) => BOARD_WEIGHTS.signal[b] - BOARD_WEIGHTS.signal[a])

const WORST_WEIGHT = Math.max(...Object.values(BOARD_WEIGHTS.signal))

const TRAIL_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

const GOOD_TRAIL_EVENTS = new Set([
  "call.answered", "contact.first-response", "contact.logged",
  "email.delivered", "invoice.paid", "invoice.payment-received",
  "job.completed", "job.handed-off", "promise.kept",
])

function trailMark(kind: string) {
  if (GOOD_TRAIL_EVENTS.has(kind)) return "good"
  if (kind === "call.missed" || kind === "attachment.needs-help" || kind.endsWith(".failed")) return "warn"
  return undefined
}

// The contract reserves red for signals weighted 50 and above; a count of zero
// is not a state, so it goes quiet.
function markFor(kind: BoardSignalKind, count: number) {
  if (count === 0) return "var(--mark-quiet)"
  return BOARD_WEIGHTS.signal[kind] >= 50 ? "var(--status-stop-mark)" : "var(--status-warn-mark)"
}

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
  board: "All jobs",
}

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

// The Waiting cell: how long this job has been sitting, and the date it
// started sitting. Both come from board_since, never from a fixture.
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
function moneyFor(lead: BoardJobRow): { value: string; note: string } {
  if (lead.paid_at) {
    const cents = lead.paid_amount_cents ?? lead.invoice_total_cents ?? lead.revenue_cents
    return cents !== null ? { value: money(cents), note: "paid" } : { value: "—", note: "no price" }
  }
  if (lead.invoice_total_cents !== null) return { value: money(lead.invoice_total_cents), note: "invoiced" }
  if (lead.status === "won" && lead.revenue_cents !== null) return { value: money(lead.revenue_cents), note: "booked" }
  if (lead.estimate_value_cents !== null) return { value: money(lead.estimate_value_cents), note: "estimated" }
  return { value: "—", note: "no price" }
}

// Tone comes from where the job sits and which signal raised it. The label
// itself is lead.board_reason verbatim — never mapped, never paraphrased.
function chipTone(lead: BoardJobRow): "stop" | "warn" | "good" | "info" {
  if (lead.board_stage === "ready") return "good"
  if (lead.board_stage === "attention") {
    const stopKind = lead.board_signals.some((signal) => signal.kind === "waiting" || signal.kind === "noreply")
    return stopKind ? "stop" : "warn"
  }
  return "info"
}

const CHIP_CLASS = { stop: "chip--stop", warn: "chip--warn", good: "chip--good", info: "chip--info" } as const

// How much of the call stays unfolded. Four lines is the opening exchange; a
// live call only ever carries three, so it never folds at all.
const PANEL_OPEN_LINES = 4

export function JobControl({ board, chrome, menu, nowMs }: { board: BoardPaneData; chrome: BoardChrome; menu?: React.ReactNode; nowMs: number }) {
  const [openJobId, setOpenJobId] = useState<number | null>(null)
  const router = useRouter()
  const { details: jobDetails } = board
  const needsYou = board.counts.attention
  const promises = board.promises
  const outTheDoor = board.outTheDoor
  const median = board.medianFirstResponseMinutes
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
  const showHeard = !drawing.hasDrawing && heard.length > 0
  // A call still on the line shows its tail; an ended one shows its opening,
  // where the customer says what they need. Either way the count is honest
  // about what the column left out.
  const onTheLine = sketch?.status === "listening"
  const unshownLines = Math.max(0, (sketch?.totalLines ?? 0) - (sketch?.lines.length ?? 0))
  // An ended call brings fourteen lines, which pushed the tracker most of a
  // screen down the page. The opening stays in the open — that is where the
  // customer says what he needs — and the rest folds into a native disclosure.
  const openLines = sketch?.lines.slice(0, PANEL_OPEN_LINES) ?? []
  const foldedLines = sketch?.lines.slice(PANEL_OPEN_LINES) ?? []
  const slots = showHeard
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
  // The call panel was labelled live and was not. Every field on it comes from
  // the server render, and the board mounted no timer at all, so a call that
  // arrived while the owner was looking at the board never appeared, and a call
  // in progress never gained a line until he reloaded the page.
  //
  // router.refresh() re-runs this route's server render, which is six queries.
  // ponytail: whole-page refresh, not a sketch-only endpoint — one line here
  // beats a second read path, and the two guards below keep it cheap. A call on
  // the line ticks fast because that is the minute the panel is for; otherwise
  // it ticks slowly, just often enough to notice a new call. Both stop dead
  // while the tab is hidden, so a board left open overnight lets Neon suspend.
  useEffect(() => {
    let timer: number | undefined
    function tick() {
      if (document.visibilityState !== "visible") return
      router.refresh()
    }
    function start() {
      window.clearInterval(timer)
      if (document.visibilityState !== "visible") return
      timer = window.setInterval(tick, onTheLine ? 8_000 : 60_000)
    }
    start()
    document.addEventListener("visibilitychange", start)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", start)
    }
  }, [router, onTheLine])

  useEffect(() => {
    const root = document.documentElement
    const key = "mcsw-theme"
    let saved: string | null = null

    try {
      saved = window.localStorage.getItem(key)
    } catch {}

    if (saved) root.setAttribute("data-theme", saved)

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
    <div className="app">
    
      <header className="top">
        <Link className="logo-home" href="/board" aria-label="Job Control home">
          <img className="logo" alt="" src="data:image/webp;base64,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" />
        </Link>
        <span className="when">{chrome.date}</span>
        <form className="find" action="/board" method="get" role="search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input name="q" type="search" defaultValue={chrome.query} placeholder="Customer, job number, or what it is" aria-label="Search jobs" />
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
    
      <nav className="rail" aria-label="Sections">
        <Link className="rl" href="/board" aria-label="Board" aria-current="page"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/></svg></Link>
        <Link className="rl" href="/board/customers" aria-label="Customers"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="6" r="2.4"/><path d="M3.2 13c.6-2.3 2.5-3.5 4.8-3.5S12.2 10.7 12.8 13"/></svg></Link>
        <Link className="rl" href="/board?stage=waiting" aria-label="Quotes"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 6h5M5.5 9h3"/></svg></Link>
        <Link className="rl" href="/board?signal=promise" aria-label="Promises"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8.5 6.5 12 13 4.5"/></svg></Link>
        {chrome.owner && <Link className="rl" href="/ops/analytics" aria-label="Money"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="4" width="12" height="8" rx="1.5"/><path d="M2 7h12"/></svg></Link>}
        <span className="rl-gap"></span>
        <Link className="rl" href="/ops/install" aria-label="Help"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="6"/><path d="M6.4 6.2a1.7 1.7 0 1 1 2.2 1.9v1"/><path d="M8 11.4h.01"/></svg></Link>
      </nav>
    
      <aside className="pane">
        <div className="pane-body">
          <div className="head"><h3 className="t-sub">Why {needsYou} need you</h3><span className="t-label end">now</span></div>
          <div className="signals">
            {SIGNAL_ORDER.map((kind) => {
              const count = board.signalCounts[kind]
              return <Link className={`signal${count === 0 ? " none" : ""}`}
                href={boardHref({ signal: kind })}
                aria-current={board.signal === kind ? "true" : undefined} key={kind}>
                <i style={{ "background": markFor(kind, count) }}></i>
                <span>{BOARD_SIGNAL_LABELS[kind]}</span><b>{count}</b><em>{BOARD_WEIGHTS.signal[kind]}</em>
              </Link>
            })}
          </div>
          {board.signal && <p style={{ "marginTop": "var(--s3)" }}>
            <Link className="btn btn--sm btn--edge" href={boardHref({ signal: null })}>Clear signal filter</Link>
          </p>}
          <p className="t-caption" style={{ "marginTop": "var(--s3)" }}>How many jobs, then how bad it is — one job can carry more than one. {WORST_WEIGHT} is the worst it gets.</p>
    
          <div className="rule"></div>
    
          <div className="head"><h3 className="t-sub">Promises</h3></div>
          <div className="keep">
            <div className="keep-row"><span className="chip chip--good"><i></i>Kept</span><b>{promises.kept}</b></div>
            <div className="keep-row"><span className="chip chip--info"><i></i>Open</span><b>{promises.open}</b></div>
            <div className="keep-row"><span className="chip chip--warn"><i></i>Broken</span><b>{promises.broken}</b></div>
          </div>
          <p className="t-caption" style={{ "marginTop": "var(--s3)" }}>Open and broken are right now — broken is past its date and still owed. Kept is this month.</p>
          {/* The callout named the shop's oldest broken promise and then went
              nowhere, so the one thing on the pane that says "you are late on
              this" could not be acted on. It links to the promise on its own
              work order — where the customer's last message and the call
              button are both in reach, which is the order the shop works in.
              A promise with no lead behind it has no work order to open. */}
          {promises.overdue && (promises.overdue.leadId
            ? <Link className="due" href={`/ops/leads/${promises.overdue.leadId}#promise-${promises.overdue.id}`}>
                <p>{promises.overdue.summary}</p>
                <span>Due {sinceInWords(promises.overdue.dueAt, nowMs)}{promises.overdue.customerName && ` · ${promises.overdue.customerName}`}{promises.overdue.service && `, ${promises.overdue.service}`}</span>
              </Link>
            : <div className="due">
                <p>{promises.overdue.summary}</p>
                <span>Due {sinceInWords(promises.overdue.dueAt, nowMs)}{promises.overdue.customerName && ` · ${promises.overdue.customerName}`}{promises.overdue.service && `, ${promises.overdue.service}`}</span>
              </div>)}

          <section className="card week">
            <h4>The week</h4>
            {board.week.every((d) => !d.promises.length && !d.invoices.length && !d.followUps.length)
              ? <p className="t-caption">Nothing due in the next seven days.</p>
              : board.week
                  .filter((d) => d.promises.length || d.invoices.length || d.followUps.length)
                  .map((d) => (
                    <div key={d.date} className="week-day">
                      <span className="week-dow t-caption">{d.dow}</span>
                      <ul>
                        {[...d.promises, ...d.invoices, ...d.followUps].map((item, i) => (
                          <li key={`${d.date}-${i}`}>
                            {item.leadId
                              ? <Link href={`/ops/leads/${item.leadId}`}>{item.label}</Link>
                              : <span>{item.label}</span>}
                            <span className="t-caption"> · {item.customer}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
          </section>
          <div className="rule"></div>

          <div className="head"><h3 className="t-sub">Today</h3></div>
          <ul className="trail">
            {board.todayTrail.map((event) => <li key={event.id}>
              <i className={trailMark(event.kind)}></i>
              <time dateTime={event.occurredAt}>{TRAIL_TIME.format(new Date(event.occurredAt))}</time>
              <b>{shopEventLabel(event.kind)}{event.customer && ` · ${event.customer}`}{event.body && ` — ${event.body}`}</b>
            </li>)}
          </ul>
        </div>
    
        <div className="pane-foot">
          <Link className="btn btn--go" href={boardHref({ stage: "attention", signal: null })}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8.5 6.5 12 13 4.5"/></svg>Work the {needsYou} that {needsYou === 1 ? "needs" : "need"} you</Link>
        </div>
      </aside>
    
      <main className="main">
    
        <section className="card figures">
          <div className="figure">
            <h4>Open jobs</h4>
            <p className="n"><b className="t-display">{board.counts.board}</b><span>on the books</span></p>
            <div className="under">
              <span className="chip chip--good"><i></i>{board.counts.shop} in the shop</span>
              <span>{board.counts.waiting} waiting on customers &middot; {board.counts.ready} ready</span>
            </div>
          </div>
          <div className="figure">
            <h4>Needs you</h4>
            <p className="n"><b className="t-display">{needsYou}</b><span>today</span></p>
            <div className="under">
              {/* The seven-day sparkline is cut. Nothing stores a daily
                  attention-count history, so the trend could only be guessed at
                  by replaying the events table — a drawn line with no data
                  behind it is the exact failure this board exists to fix. It
                  returns if a daily snapshot ever ships. */}
              <span>median first reply <b>{median === null ? "—" : `${Math.round(median)} min`}</b></span>
            </div>
          </div>
          <div className="figure">
            <h4>Closed this week</h4>
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
    
        <section className="card">
          <div className="call-top">
            <h2 className="t-title">Live call sketch</h2>
            <span className="sub">{sketch ? callLine(sketch, nowMs) : "No call sketched yet"}</span>
            <span className="end">
              {sketch && sketch.unsketchedCalls > 0 &&
                <span className="t-label">{sketch.unsketchedCalls} more call{sketch.unsketchedCalls === 1 ? "" : "s"} not sketched</span>}
              {sketch?.leadId != null &&
                <Link className="btn btn--sm btn--edge" href={`/ops/leads/${sketch.leadId}`}>Open the job</Link>}
              {/* A call with no job yet is the one the board could not act on:
                  it showed the conversation and offered nothing to do with it.
                  The draft is only linked while intake will still open it. */}
              {sketch?.leadId == null && sketch?.draftId &&
                <Link className="btn btn--sm btn--edge" href={`/ops/intake/${sketch.draftId}`}>Save this call as a job</Link>}
            </span>
          </div>
    
          <div className="call-cols">
            <div>
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
                  {!showHeard && <>
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
                    <g fontFamily="Instrument Sans" fontSize="12" fontWeight="600" fill="var(--sketch-line)">
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
            </div>
    
            <div>
              <p className="ask">{showHeard ? "What the call said" : "Ask next"}</p>
              <p>{showHeard ? "No gate or frame was described, so the drawing stays blank." : spec.nextQuestion}</p>
              <div className="slots">
                {slots.map((slot) =>
                  <span className="slot" key={slot.key}>
                    <span className="k">{slot.label}</span>
                    <span className={`v ${slot.tone}`}>{slot.text}</span>
                  </span>)}
              </div>
              <div className="call-end">
                <span>{showHeard
                  ? `${heard.length} fact${heard.length === 1 ? "" : "s"} heard on this call`
                  : `${answered} of ${PANEL_FACT_KEYS.length} answered${pricingGap && ` · ${pricingGap}`}`}</span>
                {sketch?.leadId != null &&
                  <span className="end"><Link className="btn btn--sm btn--go" href={`/ops/leads/${sketch.leadId}#spike`}>Text him the three</Link></span>}
              </div>
            </div>
    
            <div>
              <p className="t-label" style={{ "marginBottom": "var(--s2)" }}>{onTheLine ? "Recent call language" : "How the call opened"}</p>
              {sketch && sketch.lines.length > 0
                ? <>
                    {openLines.map((line) =>
                      <p className={line.speaker === "Shop" ? "spoke" : "spoke them"} key={line.sequenceId}>
                        <b>{line.speaker}</b><span>{line.transcript}</span>
                      </p>)}
                    {foldedLines.length > 0 &&
                      <details className="spoke-more">
                        <summary>{foldedLines.length} more line{foldedLines.length === 1 ? "" : "s"} of this call</summary>
                        {foldedLines.map((line) =>
                          <p className={line.speaker === "Shop" ? "spoke" : "spoke them"} key={line.sequenceId}>
                            <b>{line.speaker}</b><span>{line.transcript}</span>
                          </p>)}
                      </details>}
                  </>
                : <p className="t-caption">Nothing has been transcribed on this call yet.</p>}
              {unshownLines > 0 &&
                <p className="t-caption" style={{ "marginTop": "var(--s2)" }}>{unshownLines} more line{unshownLines === 1 ? "" : "s"} on this call.</p>}
            </div>
          </div>
          {chrome.owner && <VoicePreview voice={board.voice} />}
        </section>
    
        <section className="card">
          <div className="track-top">
            <h2 className="t-title">Job tracker</h2>
            <span className="count">{countLine}</span>
            <span className="end">
              {/* The tracker is genuinely ordered oldest-first — the page asks
                  for order:"oldest" — so the sort chip is an honest active
                  label, not a button that claims a sort it does not perform. */}
              <span className="chip chip--info track-sort" title="Jobs are ordered by how long each has waited">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8.5 6.5 12 13 4.5"/></svg>
                Longest waiting first
              </span>
            </span>
          </div>

          <div className="tabs" aria-label="Job stages">
            {board.stages.map((stage) => (
              <Link className="tab" key={stage} href={`/board?stage=${stage}${chrome.includeTests ? "&tests=1" : ""}`} aria-current={board.stage === stage ? "page" : undefined}>
                {TAB_LABELS[stage]} <b className={stage === "attention" ? "hot" : undefined}>{board.counts[stage]}</b>
              </Link>
            ))}
          </div>

          <div className="cols colhead">
            <span>Part</span>
            <span>Customer</span>
            <span className="right c-wait">Waiting</span>
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
                const datedCommitment = commitments.find((commitment) => commitment.due_at)
                const bookedDate = datedCommitment?.due_at ?? lead.scheduled_at
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
                const elapsed = (startIso: string, endIso: string | null) => {
                  if (!endIso) return "none yet"
                  const start = new Date(startIso).getTime()
                  const end = new Date(endIso).getTime()
                  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "not recorded"
                  const minutes = Math.floor((end - start) / 60_000)
                  if (minutes < 60) return `${minutes} min`
                  const hours = Math.floor(minutes / 60)
                  const remainder = minutes % 60
                  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
                }
                const quotedDays = (() => {
                  if (!lead.quoted_at) return "Not quoted"
                  const quotedAt = new Date(lead.quoted_at).getTime()
                  if (!Number.isFinite(quotedAt)) return "Date not recorded"
                  const days = Math.max(0, Math.floor((nowMs - quotedAt) / 86_400_000))
                  return `${days} ${days === 1 ? "day" : "days"}`
                })()
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
                const stageFacts: Array<{
                  name: string
                  firstLabel: string
                  firstValue: React.ReactNode
                  secondLabel: string
                  secondValue: React.ReactNode
                }> = [
                  {
                    name: "Asked",
                    firstLabel: centralDate(lead.created_at),
                    firstValue: shopSourceLabel(lead.source),
                    secondLabel: "First reply",
                    secondValue: elapsed(lead.created_at, lead.first_response_at),
                  },
                  {
                    name: "Measured",
                    firstLabel: newestPhotoAt ? centralDate(newestPhotoAt) : "No photo date",
                    firstValue: `${lead.photo_count} ${lead.photo_count === 1 ? "photo" : "photos"}`,
                    secondLabel: "Active facts",
                    secondValue: activeClaims.length,
                  },
                  {
                    name: "Priced",
                    firstLabel: lead.quoted_at ? centralDate(lead.quoted_at) : "Not quoted",
                    firstValue: lead.estimate_value_cents === null
                      ? "No price"
                      : formatCents(lead.estimate_value_cents),
                    secondLabel: "Since quote",
                    secondValue: quotedDays,
                  },
                  {
                    name: "Booked",
                    firstLabel: datedCommitment ? "Promise due" : lead.scheduled_at ? "Scheduled" : "Date",
                    firstValue: bookedDate ? centralDate(bookedDate) : "No date",
                    secondLabel: "Status",
                    secondValue: lead.won_at ? "Booked" : "Not booked",
                  },
                  {
                    name: "Paid",
                    firstLabel: "Terms",
                    firstValue: lead.invoice_due_at ? `Due ${centralDate(lead.invoice_due_at)}` : "On pickup",
                    secondLabel: "Prior jobs",
                    secondValue: priorJobs ?? "—",
                  },
                ]

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
                    <span className="val right c-wait">{waitingAge(lead.board_since, nowMs)} <em>{waitingDate(lead.board_since)}</em></span>
                    <span className="val right c-money">{moneyCell.value} <em>{moneyCell.note}</em></span>
                    <span className="c-state"><span className={`chip ${CHIP_CLASS[chipTone(lead)]}`}><i></i>{lead.board_reason}</span></span>
                    <span className="doing c-do">
                      <Link className="btn btn--sm btn--go" href={`/ops/leads/${lead.id}`}>Open job</Link>
                      <button className="icon" style={{ "width": "28px", "height": "28px" }} type="button"
                        aria-label={`${isOpen ? "Collapse" : "Expand"} ${customerName(lead)} job details`}
                        aria-expanded={isOpen} aria-controls={`job-detail-${lead.id}`}
                        onClick={() => setOpenJobId((current) => current === lead.id ? null : lead.id)}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9">
                          <path d={isOpen ? "M4 10 8 6l4 4" : "M4 6 8 10l4-4"}/>
                        </svg>
                      </button>
                    </span>
                  </div>

                  {isOpen && <div className="detail" id={`job-detail-${lead.id}`}>
                    <div className="drawing">
                      <div className="drawing-top">
                        <span className="t-sub">The part</span>
                        <span className="end">
                          {lead.photo_count > 0
                            ? `${lead.photo_count} ${lead.photo_count === 1 ? "photo" : "photos"} · ${newestPhotoAt ? `newest ${centralDate(newestPhotoAt)}` : "newest date not recorded"}`
                            : "No photos yet"}
                        </span>
                      </div>
                      {panelPhoto
                        ? <svg className="plan" viewBox="0 0 380 244" role="img"
                            aria-label={`Job photo for ${customerName(lead)}`}>
                            <rect width="380" height="244" fill="var(--draw-fill)" />
                            <image href={`/api/ops/photo?lead=${lead.id}&path=${encodeURIComponent(panelPhoto.pathname)}`}
                              width="380" height="244" preserveAspectRatio="xMidYMid slice" />
                          </svg>
                        : <svg className="plan" viewBox="0 0 380 244" fill="none" role="img"
                            aria-label={lead.service.trim() || "Job part not yet identified"}>
                            <rect width="380" height="244" fill="var(--draw-fill)" />
                            <g transform="translate(79 35) scale(4.8)" stroke="var(--draw-line)" strokeWidth=".35"
                              strokeLinejoin="round" strokeLinecap="round">
                              {serviceMark(lead.service)}
                            </g>
                          </svg>}
                      <div className="spec">
                        {activeClaims.map((claim) => <span key={claim.id}>
                          {shopClaimLabel(claim.predicate)} <b>{shopClaimText(claim.value)}</b>
                        </span>)}
                      </div>
                      <p className="t-caption">
                        {activeClaims.length} {activeClaims.length === 1 ? "fact is" : "facts are"} still open.
                      </p>
                    </div>

                    <div>
                      <div className="stages">
                        {stageFacts.map((stage, index) => {
                          const state = stageState(index)
                          return <div className={`stage${state === "off" ? " off" : ""}`} key={stage.name}>
                            <div className="stage-top">
                              <span className={`knot${state === "now" ? " now" : state === "off" ? " off" : ""}`}>
                                {state === "done"
                                  ? <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M3.5 8.5 6.5 11.5 12.5 5"/></svg>
                                  : state === "now"
                                    ? <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="4.5"/></svg>
                                    : null}
                              </span>
                              {index < stageFacts.length - 1 && <span className={`wire${state === "done" ? "" : " off"}`}></span>}
                            </div>
                            <div className="stage-body">
                              <h5>{stage.name}</h5>
                              <p><span>{stage.firstLabel}</span><b>{stage.firstValue}</b></p>
                              <p><span>{stage.secondLabel}</span><b>{stage.secondValue}</b></p>
                            </div>
                          </div>
                        })}
                      </div>

                      <div className="why">
                        <div>
                          <h5>Why it needs you</h5>
                          <p>
                            {moneyCell.value === "—"
                              ? "No price is available for this job."
                              : <>This job is <b>{moneyCell.value}</b> {moneyCell.note}.</>}
                            {lead.status_reason.trim() && <> {lead.status_reason.trim()}</>}
                            {lead.notes.trim() && <> {lead.notes.trim()}</>}
                          </p>
                          <div className="why-end">
                            <span>
                              {brokenPromise
                                ? <>Broken promise: {brokenPromise.summary}{brokenPromise.due_at && ` · due ${centralDate(brokenPromise.due_at)}`}</>
                                : "No broken promise is recorded."}
                            </span>
                            <span className="end">
                              {/* Handoff belongs with the actions, not in the row: the row's
                                  cell is a fixed track shared with the reason chip, and a
                                  third control there overran it. Opening the job is the
                                  look before the click anyway. */}
                              {lead.board_stage === "ready" && <Link className="btn btn--sm btn--go" href={`/ops/leads/${lead.id}#finish-close`}>Close job</Link>}
                              <Link className="btn btn--sm btn--edge" href={`/ops/leads/${lead.id}`}>Open job</Link>
                              {phone && <TrackedCallButton leadId={lead.id} phone={phone} label="Call" compact />}
                              {phone && lead.text_ready && <Link className="btn btn--sm btn--edge" href={`/ops/leads/${lead.id}?replyChannel=text#job-reply`}>Text</Link>}
                              {phone && !lead.text_ready && chrome.owner && <Link className="btn btn--sm btn--edge" href={`/ops/leads/${lead.id}#text-permission`}>Enable texting</Link>}
                            </span>
                          </div>
                        </div>
                        <div>
                          <h5>What is in it</h5>
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
                        </div>
                      </div>
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
      </main>
    </div>
  )
}
