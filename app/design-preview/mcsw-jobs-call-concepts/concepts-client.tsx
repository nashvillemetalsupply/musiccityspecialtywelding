"use client"

import { useRef, useState } from "react"
import { Mic, Phone } from "lucide-react"

type ConceptId = "canvas" | "next" | "shopline"

const conceptChoices: Array<{
  id: ConceptId
  short: string
  name: string
  premise: string
}> = [
  {
    id: "canvas",
    short: "A. Call",
    name: "Call Canvas",
    premise: "The completed call becomes one editable job sentence.",
  },
  {
    id: "next",
    short: "B. Next",
    name: "Next Move",
    premise: "The app presents one decision and keeps everything else quiet.",
  },
  {
    id: "shopline",
    short: "C. Shopline",
    name: "Shopline",
    premise: "The whole shop is arranged by where the work stands.",
  },
]

const attentionJobs = [
  {
    customer: "Brentwood Sign Co.",
    work: "Handrail quote",
    action: "Reply",
    detail: "Waiting 1 hour",
  },
  {
    customer: "Green Hills HOA",
    work: "Pool fence repair",
    action: "Call",
    detail: "Due tomorrow",
  },
]

const activeJobs = [
  {
    customer: "Avery Transport",
    work: "Trailer gate rebuild",
    detail: "In the shop",
  },
  {
    customer: "Dale Hollow Marina",
    work: "Aluminum rail repair",
    detail: "Parts ready",
  },
  {
    customer: "Lebanon Feed Supply",
    work: "Loader bucket crack",
    detail: "Due Friday",
  },
]

function ReviewSwitcher({
  active,
  onChange,
}: {
  active: ConceptId
  onChange: (id: ConceptId) => void
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeChoice = conceptChoices.find((choice) => choice.id === active)!

  function moveFocus(currentIndex: number, direction: number) {
    const nextIndex =
      (currentIndex + direction + conceptChoices.length) % conceptChoices.length
    const next = conceptChoices[nextIndex]
    onChange(next.id)
    tabRefs.current[nextIndex]?.focus({ preventScroll: true })
  }

  return (
    <div className="review-switch">
      <div className="review-tabs" role="tablist" aria-label="Design concepts">
        {conceptChoices.map((choice, index) => (
          <button
            key={choice.id}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            type="button"
            role="tab"
            id={`concept-tab-${choice.id}`}
            aria-selected={active === choice.id}
            aria-controls={`concept-panel-${choice.id}`}
            tabIndex={active === choice.id ? 0 : -1}
            onClick={() => onChange(choice.id)}
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
                onChange(conceptChoices[0].id)
                tabRefs.current[0]?.focus({ preventScroll: true })
              }
              if (event.key === "End") {
                event.preventDefault()
                const lastIndex = conceptChoices.length - 1
                onChange(conceptChoices[lastIndex].id)
                tabRefs.current[lastIndex]?.focus({ preventScroll: true })
              }
            }}
          >
            {choice.short}
          </button>
        ))}
      </div>
      <div className="review-summary" aria-live="polite">
        <strong>{activeChoice.name}</strong>
        <span>{activeChoice.premise}</span>
      </div>
    </div>
  )
}

function AppHeader({ className = "" }: { className?: string }) {
  return (
    <header className={`product-head ${className}`.trim()}>
      <strong>MCSW Jobs</strong>
      <div>
        <span>Philippe</span>
        <button type="button">More</button>
      </div>
    </header>
  )
}

function CallCanvas() {
  const [saved, setSaved] = useState(false)

  return (
    <section
      className="prototype prototype--canvas"
      id="concept-panel-canvas"
      role="tabpanel"
      aria-labelledby="concept-tab-canvas"
    >
      <AppHeader className="canvas-head" />
      {saved ? (
        <div className="canvas-saved" aria-live="polite">
          <div className="canvas-saved-copy">
            <span>Job saved</span>
            <h2>Mike Henderson</h2>
            <p>Utility trailer fender repair</p>
            <a href="tel:+16155550189">(615) 555-0189</a>
          </div>
          <div className="canvas-saved-actions">
            <button type="button" className="button-main">
              Call Mike
            </button>
            <button type="button" className="button-quiet">
              Open Job
            </button>
            <button type="button" className="button-link" onClick={() => setSaved(false)}>
              Undo
            </button>
          </div>
        </div>
      ) : (
        <div className="canvas-layout">
          <section className="canvas-call" aria-labelledby="canvas-title">
            <div className="canvas-call-meta">
              <span>Call ended</span>
              <time dateTime="10:42">10:42 AM</time>
              <span>6 minutes</span>
            </div>
            <h2 id="canvas-title" className="sr-only">
              Add this call as a job
            </h2>
            <div className="canvas-sentence">
              <label className="canvas-name">
                <span className="sr-only">Customer name</span>
                <input defaultValue="Mike Henderson" />
              </label>
              <div className="canvas-called">
                <span>called from</span>
                <label>
                  <span className="sr-only">Phone number</span>
                  <input inputMode="tel" defaultValue="(615) 555-0189" />
                </label>
              </div>
            </div>
            <label className="canvas-need">
              <span>He needs</span>
              <textarea rows={2} defaultValue="Utility trailer fender repair" />
            </label>
            <div className="canvas-transcript">
              <span>Suggested from the call</span>
              <button type="button">
                <Mic aria-hidden="true" size={18} strokeWidth={1.8} />
                Speak instead
              </button>
            </div>
            <div className="canvas-actions">
              <button type="button" className="button-quiet">
                Not a job
              </button>
              <button type="button" className="button-main" onClick={() => setSaved(true)}>
                Save Job
              </button>
            </div>
          </section>

          <aside className="canvas-after" aria-label="What follows this call">
            <header>
              <h3>After you save</h3>
              <span>2 need attention</span>
            </header>
            {attentionJobs.map((job) => (
              <div className="canvas-after-row" key={job.customer}>
                <div>
                  <strong>{job.customer}</strong>
                  <span>{job.work}</span>
                </div>
                <button type="button">{job.action}</button>
              </div>
            ))}
            <button type="button" className="canvas-view-all">
              View all active jobs
            </button>
          </aside>
        </div>
      )}
    </section>
  )
}

function NextMove() {
  const [moved, setMoved] = useState(false)

  return (
    <section
      className="prototype prototype--next"
      id="concept-panel-next"
      role="tabpanel"
      aria-labelledby="concept-tab-next"
    >
      <AppHeader className="next-head" />
      <div className="next-layout">
        <section className="next-primary" aria-live="polite">
          <div className="next-position">
            <span>{moved ? "Needs Attention" : "Call ready"}</span>
            <span>{moved ? "3 waiting" : "Just now"}</span>
          </div>
          {moved ? (
            <>
              <h2>Brentwood Sign Co. needs a price.</h2>
              <p>Handrail quote requested one hour ago.</p>
              <div className="next-actions">
                <button type="button" className="next-main">
                  Reply
                </button>
                <button type="button" className="next-secondary">
                  Open Job
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>Mike’s call is ready to save.</h2>
              <div className="next-call-summary">
                <strong>Mike Henderson</strong>
                <a href="tel:+16155550189">(615) 555-0189</a>
                <p>Utility trailer fender repair</p>
              </div>
              <div className="next-actions">
                <button type="button" className="next-main" onClick={() => setMoved(true)}>
                  Save Job
                </button>
                <button type="button" className="next-secondary">
                  Edit
                </button>
              </div>
            </>
          )}
        </section>

        <aside className="next-queue" aria-label="Upcoming work">
          <header>
            <h3>After this</h3>
            <button type="button">View all</button>
          </header>
          <div className="next-queue-list">
            {attentionJobs.map((job) => (
              <button type="button" className="next-queue-row" key={job.customer}>
                <span>{job.customer}</span>
                <strong>{job.work}</strong>
                <small>{job.action}</small>
              </button>
            ))}
          </div>
          <div className="next-active-summary">
            <span>8 active jobs</span>
            <button type="button">Open list</button>
          </div>
        </aside>
      </div>
    </section>
  )
}

function ShoplineRow({
  customer,
  work,
  detail,
  action = "Open",
  fresh = false,
}: {
  customer: string
  work: string
  detail: string
  action?: string
  fresh?: boolean
}) {
  return (
    <div className={`shopline-row${fresh ? " is-fresh" : ""}`}>
      <div className="shopline-row-copy">
        <strong>{customer}</strong>
        <span>{work}</span>
      </div>
      <span className="shopline-row-detail">{fresh ? "Added now" : detail}</span>
      <button type="button">{action}</button>
    </div>
  )
}

function Shopline() {
  const [filed, setFiled] = useState(false)

  return (
    <section
      className="prototype prototype--shopline"
      id="concept-panel-shopline"
      role="tabpanel"
      aria-labelledby="concept-tab-shopline"
    >
      <aside className="shopline-rail">
        <strong>MCSW Jobs</strong>
        <nav aria-label="Shopline sections">
          <button type="button" aria-current="page">
            Add Job
          </button>
          <button type="button">Search</button>
          <button type="button">More</button>
        </nav>
        <span>Philippe</span>
      </aside>

      <div className="shopline-main">
        <header className="shopline-mobile-head">
          <strong>MCSW Jobs</strong>
          <div>
            <span>Philippe</span>
            <button type="button">More</button>
          </div>
        </header>

        <section className={`shopline-capture${filed ? " is-filed" : ""}`} aria-live="polite">
          {filed ? (
            <>
              <div>
                <span>Job added</span>
                <strong>Mike Henderson</strong>
                <p>Utility trailer fender repair</p>
              </div>
              <button type="button" className="shopline-undo" onClick={() => setFiled(false)}>
                Undo
              </button>
            </>
          ) : (
            <>
              <div className="shopline-call-mark">
                <Phone aria-hidden="true" size={20} strokeWidth={1.8} />
                <span>Call ended at 10:42 AM</span>
              </div>
              <div className="shopline-capture-copy">
                <strong>Mike Henderson</strong>
                <span>Utility trailer fender repair</span>
              </div>
              <div className="shopline-capture-actions">
                <button type="button" className="shopline-quiet">
                  Edit
                </button>
                <button type="button" className="shopline-main-action" onClick={() => setFiled(true)}>
                  Save Job
                </button>
              </div>
            </>
          )}
        </section>

        <div className="shopline-board">
          <section className="shopline-lane shopline-lane--attention">
            <header>
              <div>
                <h2>Needs Attention</h2>
                <span>{filed ? "3 waiting on you" : "2 waiting on you"}</span>
              </div>
              <button type="button">View all</button>
            </header>
            <div className="shopline-rows">
              {filed ? (
                <ShoplineRow
                  customer="Mike Henderson"
                  work="Utility trailer fender repair"
                  detail="Added now"
                  action="Call"
                  fresh
                />
              ) : null}
              {attentionJobs.map((job) => (
                <ShoplineRow
                  key={job.customer}
                  customer={job.customer}
                  work={job.work}
                  detail={job.detail}
                  action={job.action}
                />
              ))}
            </div>
          </section>

          <section className="shopline-lane shopline-lane--active">
            <header>
              <div>
                <h2>Active Jobs</h2>
                <span>8 in progress</span>
              </div>
              <button type="button">View all</button>
            </header>
            <div className="shopline-rows">
              {activeJobs.map((job) => (
                <ShoplineRow key={job.customer} {...job} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

export function ConceptsClient() {
  const [active, setActive] = useState<ConceptId>("canvas")

  return (
    <>
      <ReviewSwitcher active={active} onChange={setActive} />
      <div className="concept-stage">
        {active === "canvas" ? <CallCanvas /> : null}
        {active === "next" ? <NextMove /> : null}
        {active === "shopline" ? <Shopline /> : null}
      </div>
    </>
  )
}
