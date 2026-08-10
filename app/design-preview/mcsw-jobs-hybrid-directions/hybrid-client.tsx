"use client"

import Image from "next/image"
import { useMemo, useRef, useState } from "react"

type DirectionId = "signal" | "night" | "pine" | "brand"
type JobState = "attention" | "shop" | "waiting" | "ready"
type JobFilter = "all" | JobState

type Job = {
  id: string
  customer: string
  work: string
  state: JobState
  stateLabel: string
  detail: string
  action: "Call" | "Open" | "Reply"
}

const directions: Array<{
  id: DirectionId
  tab: string
  name: string
  premise: string
}> = [
  {
    id: "signal",
    tab: "Red",
    name: "Signal Red",
    premise: "Cold white, charcoal, and a restrained oxide-red action color.",
  },
  {
    id: "night",
    tab: "Amber",
    name: "Signal Amber",
    premise: "Graphite, soft white, and a warm amber action color.",
  },
  {
    id: "pine",
    tab: "Green",
    name: "Signal Green",
    premise: "Mineral white, charcoal, and a deep green action color.",
  },
  {
    id: "brand",
    tab: "Brand",
    name: "MCSW Brand",
    premise: "The current MCS logo and coal header over a crisp workspace with arc-orange actions.",
  },
]

const jobs: Job[] = [
  {
    id: "brentwood-sign",
    customer: "Brentwood Sign Co.",
    work: "Handrail quote",
    state: "attention",
    stateLabel: "Needs Attention",
    detail: "Waiting 1 hour",
    action: "Reply",
  },
  {
    id: "green-hills",
    customer: "Green Hills HOA",
    work: "Pool fence repair",
    state: "attention",
    stateLabel: "Needs Attention",
    detail: "Due tomorrow",
    action: "Call",
  },
  {
    id: "mike-henderson",
    customer: "Mike Henderson",
    work: "Utility trailer fender repair",
    state: "attention",
    stateLabel: "Needs Attention",
    detail: "Added now",
    action: "Open",
  },
  {
    id: "avery-transport",
    customer: "Avery Transport",
    work: "Trailer gate rebuild",
    state: "shop",
    stateLabel: "In Shop",
    detail: "Welding today",
    action: "Open",
  },
  {
    id: "dale-hollow",
    customer: "Dale Hollow Marina",
    work: "Aluminum rail repair",
    state: "shop",
    stateLabel: "In Shop",
    detail: "Parts ready",
    action: "Open",
  },
  {
    id: "lebanon-feed",
    customer: "Lebanon Feed Supply",
    work: "Loader bucket crack",
    state: "shop",
    stateLabel: "In Shop",
    detail: "Due Friday",
    action: "Open",
  },
  {
    id: "hendersonville-glass",
    customer: "Hendersonville Glass",
    work: "Door frame repair",
    state: "shop",
    stateLabel: "In Shop",
    detail: "Started yesterday",
    action: "Open",
  },
  {
    id: "nashville-awning",
    customer: "Nashville Awning",
    work: "Canopy bracket",
    state: "waiting",
    stateLabel: "Waiting",
    detail: "Need dimensions",
    action: "Call",
  },
  {
    id: "wilson-schools",
    customer: "Wilson County Schools",
    work: "Gate repair",
    state: "waiting",
    stateLabel: "Waiting",
    detail: "Need approval",
    action: "Open",
  },
  {
    id: "cumberland-electric",
    customer: "Cumberland Electric",
    work: "Generator frame",
    state: "waiting",
    stateLabel: "Waiting",
    detail: "Need parts",
    action: "Open",
  },
  {
    id: "baxter-construction",
    customer: "Baxter Construction",
    work: "Stair rail",
    state: "ready",
    stateLabel: "Ready",
    detail: "Pickup today",
    action: "Call",
  },
  {
    id: "franklin-auto",
    customer: "Franklin Auto Mall",
    work: "Display frame",
    state: "ready",
    stateLabel: "Ready",
    detail: "Ready to deliver",
    action: "Open",
  },
]

const filters: Array<{ id: JobFilter; label: string; shortLabel: string }> = [
  { id: "all", label: "All Jobs", shortLabel: "All jobs" },
  { id: "attention", label: "Needs Attention", shortLabel: "Attention" },
  { id: "shop", label: "In Shop", shortLabel: "In shop" },
  { id: "waiting", label: "Waiting", shortLabel: "Waiting" },
  { id: "ready", label: "Ready", shortLabel: "Ready" },
]

function countJobs(filter: JobFilter) {
  return filter === "all" ? jobs.length : jobs.filter((job) => job.state === filter).length
}

function DirectionSwitcher({
  active,
  onChange,
}: {
  active: DirectionId
  onChange: (direction: DirectionId) => void
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = directions.find((direction) => direction.id === active)!

  function moveFocus(current: number, offset: number) {
    const next = (current + offset + directions.length) % directions.length
    onChange(directions[next].id)
    tabRefs.current[next]?.focus({ preventScroll: true })
  }

  return (
    <div className="hybrid-switcher">
      <div className="hybrid-tabs" role="tablist" aria-label="Visual directions">
        {directions.map((direction, index) => (
          <button
            key={direction.id}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            type="button"
            role="tab"
            id={`hybrid-tab-${direction.id}`}
            aria-selected={active === direction.id}
            aria-controls={`hybrid-panel-${direction.id}`}
            tabIndex={active === direction.id ? 0 : -1}
            onClick={() => onChange(direction.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault()
                moveFocus(index, 1)
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault()
                moveFocus(index, -1)
              }
              if (event.key === "Home") {
                event.preventDefault()
                onChange(directions[0].id)
                tabRefs.current[0]?.focus({ preventScroll: true })
              }
              if (event.key === "End") {
                event.preventDefault()
                const last = directions.length - 1
                onChange(directions[last].id)
                tabRefs.current[last]?.focus({ preventScroll: true })
              }
            }}
          >
            {direction.tab}
          </button>
        ))}
      </div>
      <p className="hybrid-direction-copy" aria-live="polite">
        <strong>{selected.name}</strong>
        <span>{selected.premise}</span>
      </p>
    </div>
  )
}

function ProductHeader({ branded }: { branded: boolean }) {
  return (
    <header className="hybrid-product-head">
      {branded ? (
        <div className="hybrid-brand-lockup">
          <Image
            className="hybrid-brand-logo"
            src="/images/optimized/mcs_welding_logo.webp"
            alt="MCS Welding"
            width={240}
            height={160}
            sizes="72px"
            unoptimized
          />
          <strong>Jobs</strong>
        </div>
      ) : (
        <strong>MCSW Jobs</strong>
      )}
      <div>
        <span>Philippe</span>
        <button type="button" className="hybrid-text-button">
          More
        </button>
      </div>
    </header>
  )
}

function CallReady() {
  const [savedJob, setSavedJob] = useState<{
    customer: string
    phone: string
    need: string
  } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [listening, setListening] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [intakeSource, setIntakeSource] = useState<"call" | "walkin">("call")
  const [customer, setCustomer] = useState("Mike Henderson")
  const [phone, setPhone] = useState("(615) 555-0189")
  const [need, setNeed] = useState("Utility trailer fender repair")
  const canSave = customer.trim().length > 0 && need.trim().length > 0

  function changeSource(next: "call" | "walkin") {
    setIntakeSource(next)
    setCustomer(next === "call" ? "Mike Henderson" : "")
    setPhone(next === "call" ? "(615) 555-0189" : "")
    setNeed(next === "call" ? "Utility trailer fender repair" : "")
    setListening(false)
  }

  if (savedJob) {
    const firstName = savedJob.customer.trim().split(/\s+/)[0]
    return (
      <section
        className="hybrid-card hybrid-capture hybrid-capture-result hybrid-capture-saved"
        aria-live="polite"
      >
        <div>
          <span className="hybrid-kicker">Job saved</span>
          <h2>{savedJob.customer}</h2>
          <p>{savedJob.need}</p>
        </div>
        <div className={`hybrid-action-row${savedJob.phone ? "" : " is-single"}`}>
          {savedJob.phone ? (
            <button type="button" className="hybrid-primary">
              Call {firstName}
            </button>
          ) : null}
          <button type="button" className="hybrid-secondary">
            Open Job
          </button>
          <button type="button" className="hybrid-link-button" onClick={() => setSavedJob(null)}>
            Undo
          </button>
        </div>
      </section>
    )
  }

  if (dismissed) {
    return (
      <section
        className="hybrid-card hybrid-capture hybrid-capture-result hybrid-capture-dismissed"
        aria-live="polite"
      >
        <div>
          <span className="hybrid-kicker">Call cleared</span>
          <h2>No job was created</h2>
        </div>
        <div className="hybrid-action-row">
          <button type="button" className="hybrid-link-button" onClick={() => setDismissed(false)}>
            Undo
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="hybrid-card hybrid-capture" aria-labelledby="hybrid-call-title">
      <header className="hybrid-section-head">
        <div>
          <h2 id="hybrid-call-title">
            {intakeSource === "call" ? "Phone call" : "Walk-in"}
          </h2>
        </div>
        <button
          type="button"
          className="hybrid-text-button"
          onClick={() => changeSource(intakeSource === "call" ? "walkin" : "call")}
        >
          {intakeSource === "call" ? "Walk-in" : "Phone call"}
        </button>
      </header>

      <div className="hybrid-call-sentence">
        <div className="hybrid-call-person">
          <label className="hybrid-call-name">
            <span className="hybrid-sr-only">Customer name</span>
            <input
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
              placeholder="Name or company"
              autoComplete="name"
              required
            />
          </label>
          <div
            className={`hybrid-called-from${intakeSource === "walkin" ? " is-walkin" : ""}`}
          >
            <span>{intakeSource === "call" ? "called from" : "Phone (optional)"}</span>
            <label>
              <span className="hybrid-sr-only">Phone number</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
              />
            </label>
          </div>
        </div>
        <label className="hybrid-call-need">
          <span>Needs</span>
          <textarea
            rows={2}
            value={need}
            onChange={(event) => setNeed(event.target.value)}
            placeholder={intakeSource === "call" ? undefined : "What do they need?"}
            required
          />
        </label>
      </div>

      <div className="hybrid-capture-tools">
        <button
          type="button"
          className="hybrid-secondary"
          aria-pressed={listening}
          onClick={() => setListening((current) => !current)}
        >
          {listening ? "Stop" : "Speak"}
        </button>
        <button
          type="button"
          className="hybrid-secondary"
          aria-expanded={moreOpen}
          aria-controls="hybrid-more-fields"
          onClick={() => setMoreOpen((current) => !current)}
        >
          {moreOpen ? "Close details" : "More details"}
        </button>
      </div>

      {moreOpen ? (
        <div className="hybrid-more-fields" id="hybrid-more-fields">
          <label>
            <span>Service</span>
            <select defaultValue="">
              <option value="">Not set</option>
              <option>Mobile welding</option>
              <option>Repair</option>
              <option>Fabrication</option>
              <option>Railing</option>
              <option>Other</option>
            </select>
          </label>
          <label>
            <span>How they found us</span>
            <select defaultValue="">
              <option value="">Not asked</option>
              <option>Google</option>
              <option>Repeat customer</option>
              <option>Referral</option>
              <option>Other</option>
            </select>
          </label>
        </div>
      ) : null}

      <div className="hybrid-action-row hybrid-action-row-end">
        <button
          type="button"
          className="hybrid-secondary"
          onClick={() => {
            if (intakeSource === "walkin") {
              changeSource("call")
              return
            }
            setDismissed(true)
          }}
        >
          {intakeSource === "call" ? "Not a job" : "Cancel"}
        </button>
        <button
          type="button"
          className="hybrid-primary"
          disabled={!canSave}
          onClick={() =>
            setSavedJob({ customer: customer.trim(), phone: phone.trim(), need: need.trim() })
          }
        >
          Save Job
        </button>
      </div>
    </section>
  )
}

function NextMove() {
  const [replying, setReplying] = useState(false)

  return (
    <section className="hybrid-card hybrid-next" aria-labelledby="hybrid-next-title">
      <header className="hybrid-section-head">
        <div>
          <span className="hybrid-kicker">Needs Attention</span>
          <h2 id="hybrid-next-title">Next move</h2>
        </div>
        <button type="button" className="hybrid-text-button">
          View 3
        </button>
      </header>

      <div className="hybrid-next-body" aria-live="polite">
        <div>
          <strong>
            {replying
              ? "Reply ready for Brentwood Sign Co."
              : "Brentwood Sign Co. needs a price."}
          </strong>
          <p>
            {replying
              ? "The handrail quote is open. Add the price and send it."
              : "Handrail quote requested one hour ago."}
          </p>
        </div>
        <div className="hybrid-action-row">
          <button
            type="button"
            className="hybrid-primary"
            onClick={() => setReplying((current) => !current)}
          >
            {replying ? "Back" : "Reply"}
          </button>
          <button type="button" className="hybrid-secondary">
            Open Job
          </button>
        </div>
      </div>
    </section>
  )
}

function JobIndex() {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<JobFilter>("all")
  const [page, setPage] = useState(0)
  const [openedJob, setOpenedJob] = useState<string | null>(null)
  const pageSize = 5

  const filteredJobs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return jobs.filter((job) => {
      const matchesFilter = filter === "all" || job.state === filter
      const matchesQuery =
        normalized.length === 0 ||
        `${job.customer} ${job.work} ${job.stateLabel}`
          .toLocaleLowerCase()
          .includes(normalized)
      return matchesFilter && matchesQuery
    })
  }, [filter, query])

  const pageCount = Math.max(1, Math.ceil(filteredJobs.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const visibleJobs = filteredJobs.slice(safePage * pageSize, safePage * pageSize + pageSize)

  function changeFilter(next: JobFilter) {
    setFilter(next)
    setPage(0)
  }

  function changeQuery(value: string) {
    setQuery(value)
    setPage(0)
  }

  return (
    <section className="hybrid-card hybrid-index" aria-labelledby="hybrid-jobs-title">
      <header className="hybrid-section-head hybrid-index-head">
        <div>
          <h2 id="hybrid-jobs-title">Active Jobs</h2>
        </div>
        <span>{jobs.length} total</span>
      </header>

      <div className="hybrid-index-tools">
        <label className="hybrid-search">
          <span>Find a job</span>
          <input
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Customer or job"
          />
        </label>

        <label className="hybrid-filter-select">
          <span>Show</span>
          <select
            value={filter}
            onChange={(event) => changeFilter(event.target.value as JobFilter)}
          >
            {filters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} ({countJobs(item.id)})
              </option>
            ))}
          </select>
        </label>

        <div className="hybrid-filters" role="group" aria-label="Filter active jobs">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => changeFilter(item.id)}
            >
              <span>{item.shortLabel}</span>
              <strong>{countJobs(item.id)}</strong>
            </button>
          ))}
        </div>
      </div>

      <p className="hybrid-results-summary" aria-live="polite">
        {filteredJobs.length === 0
          ? "No matching jobs"
          : `Showing ${safePage * pageSize + 1}-${Math.min(
              (safePage + 1) * pageSize,
              filteredJobs.length,
            )} of ${filteredJobs.length}`}
      </p>

      {visibleJobs.length > 0 ? (
        <div className="hybrid-job-list">
          {visibleJobs.map((job) => {
            const isOpened = openedJob === job.id
            return (
              <article
                className={`hybrid-job-row${job.state === "attention" ? " is-attention" : ""}${
                  isOpened ? " is-opened" : ""
                }`}
                key={job.id}
              >
                <div className="hybrid-job-main">
                  <strong>{job.customer}</strong>
                  <span>{job.work}</span>
                </div>
                <div className="hybrid-job-state">
                  <strong>{job.stateLabel}</strong>
                  <span>{job.detail}</span>
                </div>
                <button
                  type="button"
                  className="hybrid-row-action"
                  onClick={() => setOpenedJob(job.id)}
                  aria-label={`${job.action} ${job.customer}`}
                >
                  {isOpened ? "Opened" : job.action}
                </button>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="hybrid-empty">
          <strong>No jobs match that search.</strong>
          <span>Try a customer name or job type.</span>
          <button
            type="button"
            className="hybrid-secondary"
            onClick={() => {
              changeQuery("")
              changeFilter("all")
            }}
          >
            Clear search
          </button>
        </div>
      )}

      <footer className="hybrid-pagination">
        <button
          type="button"
          className="hybrid-secondary"
          disabled={safePage === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
        >
          Previous
        </button>
        <span>
          Page {safePage + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="hybrid-secondary"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
        >
          Next
        </button>
      </footer>
    </section>
  )
}

function HybridSurface({ direction }: { direction: DirectionId }) {
  return (
    <section
      className={`hybrid-product hybrid-product-${direction}`}
      id={`hybrid-panel-${direction}`}
      role="tabpanel"
      aria-labelledby={`hybrid-tab-${direction}`}
    >
      <ProductHeader branded={direction === "brand"} />
      <div className="hybrid-product-grid">
        <div className="hybrid-primary-lane">
          <CallReady />
          <NextMove />
        </div>
        <JobIndex />
      </div>
    </section>
  )
}

export function HybridDirectionsClient() {
  const [active, setActive] = useState<DirectionId>("brand")

  return (
    <>
      <DirectionSwitcher active={active} onChange={setActive} />
      <div className="hybrid-stage">
        <HybridSurface key={active} direction={active} />
      </div>
    </>
  )
}
