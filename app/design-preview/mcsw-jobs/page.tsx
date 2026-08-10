"use client"

import { useState } from "react"
import { ArrowUpRight, DoorOpen, Phone } from "lucide-react"
import "./preview.css"

type IntakeSource = "phone" | "walk-in"

const appointments = [
  { time: "8:30", name: "Riverside Machine", work: "Cracked loader bucket" },
  { time: "11:00", name: "Eli Turner", work: "Trailer jack repair" },
  { time: "2:30", name: "Red Cedar Farm", work: "On-site gate install" },
]

const attentionJobs = [
  { name: "Mike Henderson", work: "Utility trailer fender repair", state: "Needs a call", age: "18m" },
  { name: "Wilson Ironworks", work: "Drive gate install", state: "Customer replied", age: "42m" },
]

const activeJobs = [
  { name: "Powell Farms", work: "Equipment bracket repair", state: "Price the job", age: "1h" },
  { name: "Lebanon Fence Co.", work: "12 ft steel gate", state: "Waiting on material", age: "3h" },
  { name: "Tammy Cole", work: "Pontoon rail repair", state: "Scheduled today", age: "Yesterday" },
  { name: "Ridgeview Logistics", work: "Trailer crossmember repair", state: "Quote sent", age: "2d" },
]

function JobRow({
  name,
  work,
  state,
  age,
  attention = false,
}: {
  name: string
  work: string
  state: string
  age: string
  attention?: boolean
}) {
  return (
    <article className={`mjp-job-row${attention ? " is-attention" : ""}`}>
      <div className="mjp-job-customer">
        <strong>{name}</strong>
        <span>{work}</span>
      </div>
      <div className="mjp-job-state">
        <strong>{state}</strong>
        <span>{age} ago</span>
      </div>
      <div className="mjp-job-actions" aria-label={`Actions for ${name}`}>
        <button type="button" className="mjp-row-action">
          <Phone aria-hidden="true" size={17} strokeWidth={1.8} />
          Call
        </button>
        <button type="button" className="mjp-row-action is-open">
          Open
          <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
    </article>
  )
}

export default function MCSWJobsDesignPreview() {
  const [source, setSource] = useState<IntakeSource>("phone")
  const [saved, setSaved] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  function savePreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="mjp-preview">
      <header className="mjp-topbar">
        <div className="mjp-topbar-inner">
          <a className="mjp-brand" href="#new-job" aria-label="MCSW Jobs home">
            <span className="mjp-brand-mark" aria-hidden="true">M</span>
            <span>MCSW Jobs</span>
          </a>
          <div className="mjp-account">
            <span>Philippe</span>
            <div className="mjp-more-wrap">
              <button
                type="button"
                className="mjp-more-button"
                aria-expanded={moreOpen}
                aria-controls="mjp-more-menu"
                onClick={() => setMoreOpen((current) => !current)}
              >
                More
              </button>
              {moreOpen && (
                <nav className="mjp-more-menu" id="mjp-more-menu" aria-label="More sections">
                  <button type="button">Updates</button>
                  <button type="button">Promises</button>
                  <button type="button">Customers</button>
                  <button type="button">Search Jobs</button>
                  <button type="button">Settings</button>
                </nav>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mjp-workbench">
        <section className="mjp-intake" id="new-job" aria-labelledby="mjp-new-job-title">
          <div className="mjp-intake-head">
            <div>
              <h1 id="mjp-new-job-title">New Job</h1>
            </div>
            <div className="mjp-source-switch" aria-label="How the customer reached the shop">
              <button
                type="button"
                className={source === "phone" ? "is-active" : ""}
                aria-pressed={source === "phone"}
                onClick={() => setSource("phone")}
              >
                <Phone aria-hidden="true" size={17} strokeWidth={1.8} />
                Phone call
              </button>
              <button
                type="button"
                className={source === "walk-in" ? "is-active" : ""}
                aria-pressed={source === "walk-in"}
                onClick={() => setSource("walk-in")}
              >
                <DoorOpen aria-hidden="true" size={17} strokeWidth={1.8} />
                Walk-in
              </button>
            </div>
          </div>

          <form className="mjp-intake-form" onSubmit={savePreview}>
            <label>
              <span>Name or company</span>
              <input autoComplete="name" placeholder={source === "phone" ? "Caller name" : "Who is here?"} />
            </label>
            <label>
              <span>Phone</span>
              <input autoComplete="tel" inputMode="tel" type="tel" placeholder="(615) 555-0123" />
            </label>
            <label className="mjp-need-field">
              <span>What do they need?</span>
              <input placeholder={source === "phone" ? "Gate, trailer, repair, fabrication" : "What did they bring in?"} />
            </label>
            <button className="mjp-save-job" type="submit" disabled={saved}>
              {saved ? "Saved" : "Save Job"}
            </button>
          </form>

          <details className="mjp-more-details">
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
          <p className="mjp-save-status" aria-live="polite">{saved ? "Saved for this preview." : ""}</p>
        </section>

        <section className="mjp-today" aria-labelledby="mjp-today-title">
          <header className="mjp-section-head">
            <div>
              <h2 id="mjp-today-title">Today</h2>
              <span>{appointments.length} scheduled</span>
            </div>
          </header>
          <div className="mjp-today-rail">
            {appointments.map((appointment) => (
              <article className="mjp-appointment" key={`${appointment.time}-${appointment.name}`}>
                <time>{appointment.time}</time>
                <div>
                  <strong>{appointment.name}</strong>
                  <span>{appointment.work}</span>
                </div>
                <button type="button" aria-label={`Open ${appointment.name}`}>
                  <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.8} />
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="mjp-queue" aria-labelledby="mjp-attention-title">
          <header className="mjp-section-head">
            <div>
              <h2 id="mjp-attention-title">Needs Attention</h2>
              <span>Oldest first</span>
            </div>
            <div className="mjp-section-tools">
              <strong aria-label={`${attentionJobs.length} jobs`}>{attentionJobs.length}</strong>
              <button type="button">View all</button>
            </div>
          </header>
          <div className="mjp-ledger">
            {attentionJobs.map((job) => <JobRow {...job} attention key={job.name} />)}
          </div>
        </section>

        <section className="mjp-queue" aria-labelledby="mjp-active-title">
          <header className="mjp-section-head">
            <div>
              <h2 id="mjp-active-title">Active Jobs</h2>
              <span>Current work</span>
            </div>
            <div className="mjp-section-tools">
              <strong aria-label={`${activeJobs.length} jobs`}>{activeJobs.length}</strong>
              <button type="button">View all</button>
            </div>
          </header>
          <div className="mjp-ledger">
            {activeJobs.map((job) => <JobRow {...job} key={job.name} />)}
          </div>
        </section>
      </main>
    </div>
  )
}
