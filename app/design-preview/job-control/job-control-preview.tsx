"use client"

import { useEffect } from "react"
import { BOARD_SIGNAL_LABELS, BOARD_WEIGHTS } from "@/lib/shop-brain-invariants.mjs"
import type { BoardSignalKind } from "@/lib/shop-brain-invariants.mjs"
import type { PromiseSummary } from "@/lib/commitments"
import type { JobBoardStage, OutTheDoorWeek } from "@/lib/ops-data"
import { shopEventLabel } from "@/lib/shop-language"

type TodayTrailItem = {
  id: number
  occurredAt: string
  kind: string
  body: string
}

export type BoardPaneData = {
  counts: Record<JobBoardStage, number>
  signalCounts: Record<BoardSignalKind, number>
  promises: PromiseSummary
  outTheDoor: OutTheDoorWeek
  medianFirstResponseMinutes: number | null
  todayTrail: TodayTrailItem[]
}

// What a signed-out viewer sees: the whole board, real zeros, no names.
export const EMPTY_BOARD: BoardPaneData = {
  counts: { board: 0, attention: 0, shop: 0, waiting: 0, ready: 0 },
  signalCounts: { waiting: 0, noreply: 0, promise: 0, followup: 0, bounced: 0 },
  promises: { kept: 0, open: 0, broken: 0, overdue: null },
  outTheDoor: { jobs: 0, paidJobs: 0, revenueCents: null, stillOutCents: null },
  medianFirstResponseMinutes: null,
  todayTrail: [],
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

function sinceInWords(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? "day" : "days"} ago`
}

export function JobControlPreview({ board }: { board: BoardPaneData }) {
  const needsYou = board.counts.attention
  const promises = board.promises
  const outTheDoor = board.outTheDoor
  const median = board.medianFirstResponseMinutes
  useEffect(() => {
    const root = document.documentElement
    const key = "mcsw-theme"
    let saved: string | null = null

    try {
      saved = window.localStorage.getItem(key)
    } catch {}

    if (saved) root.setAttribute("data-theme", saved)

    const themeButton = document.getElementById("theme")
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"))

    function toggleTheme() {
      const dark = root.getAttribute("data-theme") === "dark"
        || (!root.hasAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches)
      const next = dark ? "light" : "dark"
      root.setAttribute("data-theme", next)
      try {
        window.localStorage.setItem(key, next)
      } catch {}
    }

    function pressTab(event: MouseEvent) {
      tabs.forEach((tab) => tab.setAttribute("aria-pressed", "false"))
      ;(event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", "true")
    }

    themeButton?.addEventListener("click", toggleTheme)
    tabs.forEach((tab) => tab.addEventListener("click", pressTab))

    return () => {
      themeButton?.removeEventListener("click", toggleTheme)
      tabs.forEach((tab) => tab.removeEventListener("click", pressTab))
    }
  }, [])

  return (
    <div className="app">
    
      <header className="top">
        <img className="logo" alt="MCS Welding" src="data:image/webp;base64,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" />
        <span className="when">Monday, Aug 19</span>
        <div className="find">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input placeholder="Customer, job number, or what it is" aria-label="Search jobs" />
        </div>
        <div className="top-end">
          <button className="btn btn--go" type="button">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M8 3.5v9M3.5 8h9"/></svg>New job</button>
          <button className="icon" id="theme" type="button" aria-label="Switch between the light and dark board">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8A4.4 4.4 0 0 1 8 2.2z"/></svg></button>
          <span className="who-dot">P</span>
        </div>
      </header>
    
      <nav className="rail" aria-label="Sections">
        <button className="rl" type="button" aria-label="Board" aria-current="page"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/></svg></button>
        <button className="rl" type="button" aria-label="Leads"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2.5 4.5h11v8h-11z"/><path d="m2.5 5.5 5.5 4 5.5-4"/></svg></button>
        <button className="rl" type="button" aria-label="Customers"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="6" r="2.4"/><path d="M3.2 13c.6-2.3 2.5-3.5 4.8-3.5S12.2 10.7 12.8 13"/></svg></button>
        <button className="rl" type="button" aria-label="Quotes"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 6h5M5.5 9h3"/></svg></button>
        <button className="rl" type="button" aria-label="Promises"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8.5 6.5 12 13 4.5"/></svg></button>
        <button className="rl" type="button" aria-label="Money"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="4" width="12" height="8" rx="1.5"/><path d="M2 7h12"/></svg></button>
        <span className="rl-gap"></span>
        <button className="rl" type="button" aria-label="Help"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="6"/><path d="M6.4 6.2a1.7 1.7 0 1 1 2.2 1.9v1"/><path d="M8 11.4h.01"/></svg></button>
      </nav>
    
      <aside className="pane">
        <div className="pane-body">
          <div className="head"><h3 className="t-sub">Why {needsYou} need you</h3><span className="t-label end">now</span></div>
          <div className="signals">
            {SIGNAL_ORDER.map((kind) => {
              const count = board.signalCounts[kind]
              return <button className={`signal${count === 0 ? " none" : ""}`} type="button" key={kind}>
                <i style={{ "background": markFor(kind, count) }}></i>
                <span>{BOARD_SIGNAL_LABELS[kind]}</span><b>{count}</b><em>{BOARD_WEIGHTS.signal[kind]}</em>
              </button>
            })}
          </div>
          <p className="t-caption" style={{ "marginTop": "var(--s3)" }}>How many jobs, then how bad it is — one job can carry more than one. {WORST_WEIGHT} is the worst it gets.</p>
    
          <div className="rule"></div>
    
          <div className="head"><h3 className="t-sub">Promises</h3></div>
          <div className="keep">
            <div className="keep-row"><span className="chip chip--good"><i></i>Kept</span><b>{promises.kept}</b></div>
            <div className="keep-row"><span className="chip chip--info"><i></i>Open</span><b>{promises.open}</b></div>
            <div className="keep-row"><span className="chip chip--warn"><i></i>Broken</span><b>{promises.broken}</b></div>
          </div>
          <p className="t-caption" style={{ "marginTop": "var(--s3)" }}>Open is right now. Kept and broken are this month.</p>
          {promises.overdue && <div className="due">
            <p>{promises.overdue.summary}</p>
            <span>Due {sinceInWords(promises.overdue.dueAt)}{promises.overdue.customerName && ` · ${promises.overdue.customerName}`}{promises.overdue.service && `, ${promises.overdue.service}`}</span>
          </div>}
          <div className="rule"></div>

          <div className="head"><h3 className="t-sub">Today</h3></div>
          <ul className="trail">
            {board.todayTrail.map((event) => <li key={event.id}>
              <i className={trailMark(event.kind)}></i>
              <time dateTime={event.occurredAt}>{TRAIL_TIME.format(new Date(event.occurredAt))}</time>
              <b>{shopEventLabel(event.kind)}{event.body && ` — ${event.body}`}</b>
            </li>)}
          </ul>
        </div>
    
        <div className="pane-foot">
          <button className="btn btn--go" type="button">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8.5 6.5 12 13 4.5"/></svg>Work the {needsYou} that {needsYou === 1 ? "needs" : "need"} you</button>
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
            <h4>Out the door</h4>
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
            <span className="sub">Ray Colter &middot; phone call, ended 13:01 &middot; 51m ago</span>
            <span className="end">
              <span className="t-label">1 more call not sketched</span>
              <button className="btn btn--sm btn--edge" type="button">Open the job</button>
            </span>
          </div>
    
          <div className="call-cols">
            <div>
              <figure className="tile">
                <svg viewBox="0 0 244 172" role="img"
                     aria-label="Rough call sketch of a gate. Width, height, stock size, rail count, hinge side and latch side are all still unstated, marked with question marks.">
                  <rect width="244" height="172" fill="var(--sketch-ground)"></rect>
                  <g stroke="var(--sketch-grid)" strokeWidth="1">
                    <path d="M0 24h244M0 48h244M0 72h244M0 96h244M0 120h244M0 144h244"></path>
                    <path d="M24 0v172M48 0v172M72 0v172M96 0v172M120 0v172M144 0v172M168 0v172M192 0v172M216 0v172"></path>
                  </g>
                  <rect x="52" y="40" width="144" height="92" fill="none" stroke="var(--sketch-line)" strokeWidth="3"></rect>
                  <g stroke="var(--sketch-line)" strokeWidth="1.6" strokeDasharray="4 4" opacity=".45">
                    <path d="M52 70h144M52 102h144"></path>
                  </g>
                  <g stroke="var(--sketch-dim)" strokeWidth="1">
                    <path d="M52 150h144M52 142v16M196 142v16"></path>
                    <path d="M34 40v92M26 40h16M26 132h16"></path>
                  </g>
                  <g fontFamily="Instrument Sans" fontSize="12" fontWeight="600" fill="var(--sketch-line)">
                    <text x="124" y="166" textAnchor="middle">?</text>
                    <text x="12" y="90">?</text>
                    <text x="206" y="90">?</text>
                  </g>
                </svg>
                <figcaption>ROUGH CALL SKETCH &middot;<br />NOT A FABRICATION DRAWING</figcaption>
              </figure>
              <p className="t-caption" style={{ "marginTop": "var(--s3)" }}>Redrawn four times while he talked. Every answer that comes back edits it.</p>
            </div>
    
            <div>
              <p className="ask">Ask next</p>
              <p>How wide does it need to finish, post to post?</p>
              <div className="slots">
                <span className="slot"><span className="k">Kind</span><span className="v said">Gate</span></span>
                <span className="slot"><span className="k">Width</span><span className="v ambig">Opening or finished?</span></span>
                <span className="slot"><span className="k">Height</span><span className="v none">Not stated</span></span>
                <span className="slot"><span className="k">Stock size</span><span className="v none">Not stated</span></span>
                <span className="slot"><span className="k">Rails</span><span className="v none">Not stated</span></span>
                <span className="slot"><span className="k">Hinge side</span><span className="v none">Not stated</span></span>
                <span className="slot"><span className="k">Latch side</span><span className="v none">Not stated</span></span>
              </div>
              <div className="call-end">
                <span>1 of 7 answered &middot; it needs kind, width, height and stock before it can be priced</span>
                <span className="end"><button className="btn btn--sm btn--go" type="button">Text him the three</button></span>
              </div>
            </div>
    
            <div>
              <p className="t-label" style={{ "marginBottom": "var(--s2)" }}>Recent call language</p>
              <p className="spoke"><b>Shop</b><span>Alright. That&rsquo;ll work.</span></p>
              <p className="spoke them"><b>Customer</b><span>Yeah. I got a picture. Yeah.</span></p>
              <p className="spoke"><b>Shop</b><span>Yeah. No problem. Bye.</span></p>
              <p className="t-caption" style={{ "marginTop": "var(--s3)" }}>The picture never arrived. The text asking for it is written and waiting on you.</p>
            </div>
          </div>
        </section>
    
        <section className="card">
          <div className="track-top">
            <h2 className="t-title">Job tracker</h2>
            <span className="count">Showing 5 of 21</span>
            <span className="end">
              <button className="btn btn--sm" type="button">All customers
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 6.5 8 10.5l4-4"/></svg></button>
              <button className="btn btn--sm btn--edge" type="button">Longest waiting first</button>
            </span>
          </div>
    
          <div className="tabs">
            <button className="tab" type="button" aria-pressed="true">All jobs <b>21</b></button>
            <button className="tab" type="button" aria-pressed="false">Attention <b className="hot">5</b></button>
            <button className="tab" type="button" aria-pressed="false">In the shop <b>3</b></button>
            <button className="tab" type="button" aria-pressed="false">Waiting <b>6</b></button>
            <button className="tab" type="button" aria-pressed="false">Ready <b>5</b></button>
          </div>
    
          <div className="cols colhead">
            <span>Part</span>
            <span>Customer</span>
            <span className="right c-wait">Waiting</span>
            <span className="right c-money">Money</span>
            <span className="c-state">Why it needs you</span>
            <span className="c-do"></span>
          </div>
    
          <article className="job" data-open>
            <div className="cols job-row">
              <span className="part">
                <svg viewBox="0 0 46 34" role="img" aria-label="Sketch: stair stringer, five steps">
                  <path d="M7 28V23h8v-5h8v-5h8V8h6v5L7 28z" fill="none" stroke="var(--draw-line)" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
              </span>
              <span className="cust">
                <b>Phil Lloyd</b>
                <span>18 stair stringers, 10 ga galvanized</span>
              </span>
              <span className="val right c-wait">6d 04h <em>Aug 12</em></span>
              <span className="val right c-money">$4,180 <em>estimated</em></span>
              <span className="c-state"><span className="chip chip--warn"><i></i>Promise overdue</span></span>
              <span className="doing c-do">
                <button className="btn btn--sm btn--go" type="button">Send it</button>
                <button className="icon" style={{ "width": "28px", "height": "28px" }} type="button" aria-label="Collapse this job"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 10 8 6l4 4"/></svg></button>
              </span>
            </div>
    
            <div className="detail">
              <div className="drawing">
                <div className="drawing-top">
                  <span className="t-sub">The part</span>
                  <span className="end">From Phil's two photos, Aug 13</span>
                </div>
                <svg className="plan" viewBox="0 0 380 244" role="img"
                     aria-label="One stair stringer: five risers at seven and a half inches, five treads at ten and a half inches, a four foot four and a half inch run and a three foot one and a half inch rise, cut from 10 gauge galvanized, eighteen pieces.">
                  <g stroke="var(--draw-thin)" strokeWidth="1">
                    <path d="M70 178v32M272 84v126"/>
                    <path d="M70 204h202"/>
                    <path d="M42 174h24M42 52h216"/>
                    <path d="M50 52v122"/>
                  </g>
                  <g fill="var(--draw-thin)">
                    <path d="M70 204l8-3.5v7zM272 204l-8-3.5v7z"/>
                    <path d="M50 52l-3.5 8h7zM50 174l-3.5-8h7z"/>
                  </g>
                  <path d="M70 174V150h45v-24h45v-25h45v-24h45v-25h22v25z"
                        fill="var(--surface-raised)" stroke="var(--draw-line)" strokeWidth="2" strokeLinejoin="round"/>
                  <g fontFamily="Instrument Sans" fontSize="11.5" fill="var(--text-secondary)">
                    <text x="171" y="222" textAnchor="middle">4' 4-1/2" run</text>
                  </g>
                  <g fontFamily="Instrument Sans" fontSize="11.5" fill="var(--text-secondary)" transform="rotate(-90 30 113)">
                    <text x="30" y="117" textAnchor="middle">3' 1-1/2" rise</text>
                  </g>
                  <g fontFamily="Instrument Sans" fontSize="11.5" fill="var(--text-muted)">
                    <text x="288" y="48">10 ga galv</text>
                    <text x="288" y="66">&times;18 pieces</text>
                  </g>
                </svg>
                <div className="spec">
                  <span>Riser <b>7-1/2"</b></span>
                  <span>Tread <b>10-1/2"</b></span>
                  <span>Clear <b>71-1/2"</b></span>
                  <span>Stock <b>10 ga galv</b></span>
                  <span>Count <b>18</b></span>
                </div>
                <p className="t-caption">Every dimension on this one is stated. Nothing here is still open.</p>
              </div>
    
              <div>
                <div className="stages">
                  <div className="stage">
                    <div className="stage-top"><span className="knot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M3.5 8.5 6.5 11.5 12.5 5"/></svg></span><span className="wire"></span></div>
                    <div className="stage-body"><h5>Asked</h5>
                      <p><span>Aug 12</span><b>Call</b></p>
                      <p><span>First reply</span><b>9 min</b></p></div>
                  </div>
                  <div className="stage">
                    <div className="stage-top"><span className="knot"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M3.5 8.5 6.5 11.5 12.5 5"/></svg></span><span className="wire"></span></div>
                    <div className="stage-body"><h5>Measured</h5>
                      <p><span>Aug 13</span><b>Photos</b></p>
                      <p><span>Claims</span><b>5 of 5</b></p></div>
                  </div>
                  <div className="stage">
                    <div className="stage-top"><span className="knot now"><svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="4.5"/></svg></span><span className="wire off"></span></div>
                    <div className="stage-body"><h5>Priced</h5>
                      <p><span>Aug 13</span><b>$4,180</b></p>
                      <p><span>Sitting</span><b style={{ "color": "var(--status-warn-ink)" }}>6 days</b></p></div>
                  </div>
                  <div className="stage off">
                    <div className="stage-top"><span className="knot off"></span><span className="wire off"></span></div>
                    <div className="stage-body"><h5>Booked</h5>
                      <p><span>Promised</span><b>by Friday</b></p>
                      <p><span>Status</span><b>Not booked</b></p></div>
                  </div>
                  <div className="stage off">
                    <div className="stage-top"><span className="knot off"></span></div>
                    <div className="stage-body"><h5>Paid</h5>
                      <p><span>Terms</span><b>On pickup</b></p>
                      <p><span>Prior jobs</span><b>2</b></p></div>
                  </div>
                </div>
    
                <div className="why">
                  <div>
                    <h5>How the shop got to $4,180</h5>
                    <p>Off the <b>Cedar Ridge</b> job last March — same stock, same finish, 16 pieces at $3,720. Two more pieces and this year's steel put it at <b>$4,180</b>. Nothing has gone to him yet.</p>
                    <div className="why-end">
                      <span>You promised him a price by Friday. That promise is 3 days broken.</span>
                      <span className="end">
                        <button className="btn btn--sm btn--edge" type="button">Change the price</button>
                        <button className="btn btn--sm btn--edge" type="button">Call him</button>
                      </span>
                    </div>
                  </div>
                  <div>
                    <h5>What is in it</h5>
                    <table className="sum">
                      <tbody>
                        <tr><td>Steel <span className="q">10 ga galv, 18 pcs</span></td><td>$1,860</td></tr>
                        <tr><td>Cut and form <span className="q">6.5 hrs</span></td><td>$780</td></tr>
                        <tr><td>Weld and fit <span className="q">9 hrs</span></td><td>$1,080</td></tr>
                        <tr><td>Galv touch-up</td><td>$180</td></tr>
                        <tr><td>Delivery <span className="q">Gallatin</span></td><td>$280</td></tr>
                        <tr className="total"><td>Quoted</td><td>$4,180</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </article>
    
          <article className="job">
            <div className="cols job-row">
              <span className="part">
                <svg viewBox="0 0 46 34" role="img" aria-label="Sketch: handrail with three posts">
                  <g fill="none" stroke="var(--draw-line)" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M6 11h34"/><path d="M9 11v15M23 11v15M37 11v15"/><path d="M6 26h34"/>
                  </g>
                </svg>
              </span>
              <span className="cust"><b>Hendersonville Fab</b><span>Dock handrail, 34 ft</span></span>
              <span className="val right c-wait">3d 06h <em>Aug 15</em></span>
              <span className="val right c-money">$6,950 <em>quoted</em></span>
              <span className="c-state"><span className="chip chip--warn"><i></i>Email did not deliver</span></span>
              <span className="doing c-do">
                <button className="btn btn--sm btn--go" type="button">Text instead</button>
                <button className="icon" style={{ "width": "28px", "height": "28px" }} type="button" aria-label="Expand this job"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 6 8 10l4-4"/></svg></button>
              </span>
            </div>
          </article>
    
          <article className="job">
            <div className="cols job-row">
              <span className="part">
                <svg viewBox="0 0 46 34" role="img" aria-label="Sketch: cross beam with two end plates">
                  <g fill="none" stroke="var(--draw-line)" strokeWidth="1.5" strokeLinejoin="round">
                    <path d="M10 14h26v6H10z"/><path d="M7 9h3v16H7zM36 9h3v16h-3z"/>
                  </g>
                </svg>
              </span>
              <span className="cust"><b>Wendy Cauthen</b><span>Cross beam, 2005 GMC Yukon frame</span></span>
              <span className="val right c-wait">2d 11h <em>Aug 16</em></span>
              <span className="val right c-money">$395 <em>unpaid</em></span>
              <span className="c-state"><span className="chip chip--good"><i></i>Ready for customer</span></span>
              <span className="doing c-do">
                <button className="btn btn--sm btn--go" type="button">Text her</button>
                <button className="icon" style={{ "width": "28px", "height": "28px" }} type="button" aria-label="Expand this job"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 6 8 10l4-4"/></svg></button>
              </span>
            </div>
          </article>
    
          <article className="job">
            <div className="cols job-row">
              <span className="part">
                <svg viewBox="0 0 46 34" role="img" aria-label="Sketch: support post on a base plate with a cracked weld">
                  <g fill="none" stroke="var(--draw-line)" strokeWidth="1.5" strokeLinejoin="round">
                    <path d="M19 7h8v18h-8z"/><path d="M11 25h24v3H11z"/>
                  </g>
                  <path d="M19 16l4 2-4 2" fill="none" stroke="var(--status-stop-mark)" strokeWidth="1.5"/>
                </svg>
              </span>
              <span className="cust"><b>Dock Repair</b><span>Broken post, cracked weld on the support</span></span>
              <span className="val right c-wait">1d 22h <em>Aug 17</em></span>
              <span className="val right c-money">$1,240 <em>booked</em></span>
              <span className="c-state"><span className="chip chip--stop"><i></i>Customer text waiting</span></span>
              <span className="doing c-do">
                <button className="btn btn--sm btn--go" type="button">Read it</button>
                <button className="icon" style={{ "width": "28px", "height": "28px" }} type="button" aria-label="Expand this job"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 6 8 10l4-4"/></svg></button>
              </span>
            </div>
          </article>
    
          <article className="job">
            <div className="cols job-row">
              <span className="part">
                <svg viewBox="0 0 46 34" role="img" aria-label="Sketch: gate frame, three dimensions still unknown">
                  <g fill="none" stroke="var(--draw-line)" strokeWidth="1.5"><path d="M9 9h29v18H9z"/></g>
                  <g fill="none" stroke="var(--draw-thin)" strokeWidth="1.5" strokeDasharray="3 2.5">
                    <path d="M17 9v18M24 9v18M31 9v18"/>
                  </g>
                </svg>
              </span>
              <span className="cust"><b>Ray Colter</b><span>Driveway gate &middot; on the call sketch above</span></span>
              <span className="val right c-wait">51m <em>13:01</em></span>
              <span className="val right c-money">&mdash; <em>no price</em></span>
              <span className="c-state"><span className="chip chip--stop"><i></i>Needs a call</span></span>
              <span className="doing c-do">
                <button className="btn btn--sm btn--go" type="button">Ask the three</button>
                <button className="icon" style={{ "width": "28px", "height": "28px" }} type="button" aria-label="Expand this job"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 6 8 10l4-4"/></svg></button>
              </span>
            </div>
          </article>
    
        </section>
      </main>
    </div>
  )
}
