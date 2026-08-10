"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  DoorOpen,
  Mic,
  MoreHorizontal,
  Phone,
  Play,
} from "lucide-react"
import "./preview.css"

type CaptureMode = "phone" | "walk-in"

type Job = {
  name: string
  work: string
  state: string
  age: string
  attention?: boolean
}

const recentCall = {
  name: "Mike Henderson",
  phone: "(615) 555-0189",
  need: "Utility trailer fender repair",
  ended: "10:42 am",
  duration: "6:42",
}

const appointments = [
  { time: "8:30", name: "Riverside Machine", work: "Cracked loader bucket" },
  { time: "11:00", name: "Eli Turner", work: "Trailer jack repair" },
  { time: "2:30", name: "Red Cedar Farm", work: "On-site gate install" },
]

const attentionJobs: Job[] = [
  {
    name: "Mike Henderson",
    work: "Utility trailer fender repair",
    state: "Needs a call",
    age: "18 min",
    attention: true,
  },
  {
    name: "Wilson Ironworks",
    work: "Drive gate install",
    state: "Customer replied",
    age: "42 min",
    attention: true,
  },
]

const activeJobs: Job[] = [
  { name: "Powell Farms", work: "Equipment bracket repair", state: "Price the job", age: "1 hr" },
  { name: "Lebanon Fence Co.", work: "12 ft steel gate", state: "Waiting on material", age: "3 hr" },
  { name: "Tammy Cole", work: "Pontoon rail repair", state: "Scheduled today", age: "Yesterday" },
  { name: "Ridgeview Logistics", work: "Trailer crossmember repair", state: "Quote sent", age: "2 days" },
]

function JobRow({ job }: { job: Job }) {
  return (
    <article className="mjp2-job-row">
      <div className="mjp2-job-main">
        <strong>{job.name}</strong>
        <span>{job.work}</span>
      </div>
      <div className="mjp2-job-status">
        <span className={job.attention ? "is-attention" : ""} aria-hidden="true" />
        <div>
          <strong>{job.state}</strong>
          <span>{job.age}</span>
        </div>
      </div>
      <div className="mjp2-job-actions" aria-label={`Actions for ${job.name}`}>
        <button type="button" className="mjp2-icon-action" aria-label={`Call ${job.name}`}>
          <Phone aria-hidden="true" size={18} strokeWidth={1.8} />
        </button>
        <button type="button" className="mjp2-open-action">
          Open
          <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
      </div>
    </article>
  )
}

export default function MCSWJobsV2Preview() {
  const [mode, setMode] = useState<CaptureMode>("phone")
  const [name, setName] = useState(recentCall.name)
  const [phone, setPhone] = useState(recentCall.phone)
  const [need, setNeed] = useState(recentCall.need)
  const [editingContact, setEditingContact] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    }
  }, [])

  function chooseMode(nextMode: CaptureMode) {
    setMode(nextMode)
    setSaved(false)
    setSaving(false)
    setError("")
    setListening(false)
    setPlaying(false)
    setEditingContact(nextMode === "walk-in")

    if (nextMode === "phone") {
      setName(recentCall.name)
      setPhone(recentCall.phone)
      setNeed(recentCall.need)
    } else {
      setName("")
      setPhone("")
      setNeed("")
    }
  }

  function toggleVoiceCapture() {
    const next = !listening
    setListening(next)
    if (next && mode === "walk-in" && !need.trim()) {
      setNeed("Repair cracked aluminum pontoon rail")
    }
  }

  function saveJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !need.trim()) {
      setError("Add the customer and what they need.")
      return
    }

    setError("")
    setListening(false)
    setSaving(true)
    setSaved(false)
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      setSaving(false)
      setSaved(true)
    }, 650)
  }

  return (
    <div className="mjp2-shell">
      <aside className="mjp2-capture" aria-labelledby="mjp2-capture-title">
        <header className="mjp2-capture-bar">
          <a className="mjp2-wordmark" href="#capture" aria-label="MCSW Jobs home">
            <span>MCSW</span>
            <i aria-hidden="true" />
            <small>Jobs</small>
          </a>
          <div className="mjp2-account">
            <span>Philippe</span>
            <div className="mjp2-more-wrap">
              <button
                type="button"
                className="mjp2-more"
                aria-label="More"
                aria-expanded={moreOpen}
                aria-controls="mjp2-more-menu"
                onClick={() => setMoreOpen((current) => !current)}
              >
                <MoreHorizontal aria-hidden="true" size={21} />
              </button>
              {moreOpen && (
                <nav id="mjp2-more-menu" className="mjp2-more-menu" aria-label="More sections">
                  <button type="button">Updates</button>
                  <button type="button">Promises</button>
                  <button type="button">Customers</button>
                  <button type="button">Search Jobs</button>
                  <button type="button">Settings</button>
                </nav>
              )}
            </div>
          </div>
        </header>

        <div className="mjp2-capture-body" id="capture">
          <div className="mjp2-source-switch" aria-label="How the customer reached the shop">
            <button
              type="button"
              aria-pressed={mode === "phone"}
              className={mode === "phone" ? "is-active" : ""}
              onClick={() => chooseMode("phone")}
            >
              <Phone aria-hidden="true" size={18} strokeWidth={1.8} />
              Phone call
            </button>
            <button
              type="button"
              aria-pressed={mode === "walk-in"}
              className={mode === "walk-in" ? "is-active" : ""}
              onClick={() => chooseMode("walk-in")}
            >
              <DoorOpen aria-hidden="true" size={18} strokeWidth={1.8} />
              Walk-in
            </button>
          </div>

          <form className="mjp2-capture-form" onSubmit={saveJob} noValidate>
            <div className="mjp2-capture-heading">
              <div className="mjp2-call-meta">
                <span className="mjp2-live-mark" aria-hidden="true" />
                <span>{mode === "phone" ? `Call ended ${recentCall.ended}` : "At the shop now"}</span>
              </div>
              <h1 id="mjp2-capture-title">{mode === "phone" ? "Save the last call" : "Save a walk-in"}</h1>
            </div>

            {mode === "phone" && !editingContact ? (
              <div className="mjp2-caller">
                <div>
                  <strong>{name}</strong>
                  <span>{phone}</span>
                </div>
                <div className="mjp2-call-length">
                  <Clock3 aria-hidden="true" size={17} strokeWidth={1.8} />
                  <span>{recentCall.duration}</span>
                </div>
                <button type="button" onClick={() => setEditingContact(true)}>Edit</button>
              </div>
            ) : (
              <div className="mjp2-contact-fields">
                <label>
                  <span>Customer</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={mode === "phone" ? "Caller name" : "Who is here?"}
                    aria-invalid={Boolean(error && !name.trim())}
                  />
                </label>
                <label>
                  <span>Phone <small>optional</small></span>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="(615) 555-0123"
                  />
                </label>
              </div>
            )}

            <label className="mjp2-need-field">
              <span>What do they need?</span>
              <textarea
                value={need}
                onChange={(event) => setNeed(event.target.value)}
                placeholder="Repair, fabrication, trailer, gate"
                aria-describedby="mjp2-capture-feedback"
                aria-invalid={Boolean(error && !need.trim())}
              />
            </label>

            <div className="mjp2-evidence-row">
              {mode === "phone" ? (
                <>
                  <button
                    type="button"
                    className={playing ? "is-playing" : ""}
                    aria-pressed={playing}
                    onClick={() => setPlaying((current) => !current)}
                  >
                    {playing ? <span className="mjp2-playing-bars" aria-hidden="true"><i /><i /><i /></span> : <Play aria-hidden="true" size={16} fill="currentColor" />}
                    {playing ? "Playing" : "Hear 0:18"}
                  </button>
                  <span>Filled from the call</span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={listening ? "is-listening" : ""}
                    aria-pressed={listening}
                    onClick={toggleVoiceCapture}
                  >
                    <Mic aria-hidden="true" size={17} />
                    {listening ? "Listening" : "Speak"}
                  </button>
                  <span>{listening ? "Tap again when finished" : "Say it instead of typing"}</span>
                </>
              )}
            </div>

            <p className={`mjp2-feedback${error ? " is-error" : saved ? " is-success" : ""}`} id="mjp2-capture-feedback" aria-live="polite">
              {error || (saved ? `Job saved for ${name}.` : "")}
            </p>

            <button
              type="submit"
              className={`mjp2-save${saved ? " is-saved" : ""}`}
              disabled={saving || saved}
            >
              {saving ? (
                <><span className="mjp2-spinner" aria-hidden="true" />Saving job</>
              ) : saved ? (
                <><Check aria-hidden="true" size={20} />Job saved</>
              ) : (
                <>Save Job<ChevronRight aria-hidden="true" size={20} /></>
              )}
            </button>

            <details className="mjp2-details">
              <summary>More details</summary>
              <div>
                <label>
                  <span>Service</span>
                  <select defaultValue="">
                    <option value="">Not sure yet</option>
                    <option>Mobile welding</option>
                    <option>Trailer or truck repair</option>
                    <option>Equipment repair</option>
                    <option>Custom fabrication</option>
                  </select>
                </label>
                <label>
                  <span>Referral</span>
                  <input placeholder="Who sent them?" />
                </label>
              </div>
            </details>
          </form>
        </div>
      </aside>

      <main className="mjp2-board">
        <header className="mjp2-board-bar">
          <div>
            <span>Sunday</span>
            <strong>Aug 9</strong>
          </div>
          <dl>
            <div><dt>Attention</dt><dd>{attentionJobs.length}</dd></div>
            <div><dt>Active</dt><dd>{activeJobs.length}</dd></div>
          </dl>
        </header>

        <div className="mjp2-board-content">
          <section className="mjp2-today" aria-labelledby="mjp2-today-title">
            <header className="mjp2-section-head">
              <div>
                <h2 id="mjp2-today-title">Today</h2>
                <span>{appointments.length} scheduled</span>
              </div>
            </header>
            <div className="mjp2-schedule">
              {appointments.map((appointment) => (
                <article className="mjp2-appointment" key={`${appointment.time}-${appointment.name}`}>
                  <time>{appointment.time}</time>
                  <span className="mjp2-time-mark" aria-hidden="true" />
                  <div>
                    <strong>{appointment.name}</strong>
                    <span>{appointment.work}</span>
                  </div>
                  <button type="button" aria-label={`Open ${appointment.name}`}>
                    <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.8} />
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="mjp2-queue" aria-labelledby="mjp2-attention-title">
            <header className="mjp2-section-head">
              <div>
                <h2 id="mjp2-attention-title">Needs Attention</h2>
                <span>Oldest first</span>
              </div>
              <button type="button">View all</button>
            </header>
            <div className="mjp2-ledger">
              {attentionJobs.map((job) => <JobRow job={job} key={job.name} />)}
            </div>
          </section>

          <section className="mjp2-queue" aria-labelledby="mjp2-active-title">
            <header className="mjp2-section-head">
              <div>
                <h2 id="mjp2-active-title">Active Jobs</h2>
                <span>Current work</span>
              </div>
              <button type="button">View all</button>
            </header>
            <div className="mjp2-ledger">
              {activeJobs.map((job) => <JobRow job={job} key={job.name} />)}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
