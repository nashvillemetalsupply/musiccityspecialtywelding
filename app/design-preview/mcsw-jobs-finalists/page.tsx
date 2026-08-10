import type { Metadata } from "next"
import { Mic, Phone } from "lucide-react"
import {
  Atkinson_Hyperlegible_Next,
  Bitter,
  Commissioner,
} from "next/font/google"
import "./finalists.css"

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-finalist-body",
  display: "swap",
  adjustFontFallback: false,
  preload: false,
})

const bitter = Bitter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-finalist-serif",
  display: "swap",
  preload: false,
})

const commissioner = Commissioner({
  subsets: ["latin"],
  weight: "variable",
  axes: ["FLAR", "VOLM"],
  variable: "--font-finalist-sans",
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  title: "MCSW Jobs · Refined Finalists",
  robots: { index: false, follow: false },
}

type FinalistVariant =
  | "plainspoken"
  | "attention"
  | "worklist"
  | "focus"
  | "path"
  | "sheet"
  | "winner"

type Finalist = {
  id: string
  name: string
  premise: string
  adjustments: string
  variant: FinalistVariant
}

const finalists: Finalist[] = [
  {
    id: "19R",
    name: "Plainspoken",
    premise: "The cleanest reading order with almost no interface chrome.",
    adjustments: "Shorter copy · flat rows · controls use the body face",
    variant: "plainspoken",
  },
  {
    id: "20R",
    name: "Attention Strip",
    premise: "Urgent work remains obvious, but saving the current call comes first.",
    adjustments: "Capture first · quieter signal band · no alarm-red save button",
    variant: "attention",
  },
  {
    id: "21R",
    name: "Worklist",
    premise: "A compact ledger for crews who scan names and work, not dashboards.",
    adjustments: "False checkbox removed · mono removed · dense rows kept",
    variant: "worklist",
  },
  {
    id: "22R",
    name: "Focus Capture",
    premise: "The call owns the moment while the queues stay nearby, not squeezed beside it.",
    adjustments: "Full-width mobile form · side queue only on desktop · calmer contrast",
    variant: "focus",
  },
  {
    id: "23R",
    name: "Call Path",
    premise: "A clear visual flow without turning a simple save into a numbered procedure.",
    adjustments: "Step numbers removed · one quiet guide rule · fewer labels",
    variant: "path",
  },
  {
    id: "24R",
    name: "Open Sheet",
    premise: "The active job list stays behind a call form that is already ready.",
    adjustments: "One true overlay · nested cards removed · lighter background context",
    variant: "sheet",
  },
]

const winner: Finalist = {
  id: "W",
  name: "Call-first Add Job",
  premise:
    "Plainspoken clarity, Open Sheet readiness, and a restrained attention signal—without inheriting their clutter.",
  adjustments:
    "Call summary proposed · manual Phone / Walk-in · voice or touch correction",
  variant: "winner",
}

function SourceControl() {
  return (
    <div className="crm-source" aria-label="How the customer reached the shop">
      <button type="button" className="is-selected" aria-pressed="true">
        <Phone aria-hidden="true" size={17} strokeWidth={1.9} />
        Phone
      </button>
      <button type="button" aria-pressed="false">
        Walk-in
      </button>
    </div>
  )
}

function CaptureForm({
  idBase,
  mode,
}: {
  idBase: string
  mode: "post-call" | "manual"
}) {
  const isPostCall = mode === "post-call"

  return (
    <section className="crm-capture" aria-labelledby={`${idBase}-capture-title`}>
      <header className="crm-capture-head">
        <div>
          <h3 id={`${idBase}-capture-title`}>Add Job</h3>
          <p>{isPostCall ? "Phone · Ended 10:42 AM · 6m 42s" : "Phone is selected"}</p>
        </div>
      </header>

      {isPostCall ? null : <SourceControl />}

      {isPostCall ? (
        <div className="crm-caller">
          <div>
            <strong>Mike Henderson</strong>
            <span>(615) 555-0189</span>
          </div>
          <button type="button">Edit</button>
        </div>
      ) : (
        <div className="crm-manual-contact">
          <label>
            <span>Name or company</span>
            <input defaultValue="Mike Henderson" />
          </label>
          <label>
            <span>Phone</span>
            <input inputMode="tel" defaultValue="(615) 555-0189" />
          </label>
        </div>
      )}

      <div className="crm-need-stack">
        <div className="crm-need-heading">
          <label htmlFor={`${idBase}-need`}>What do they need?</label>
          {isPostCall ? <span>From call</span> : null}
        </div>
        <div className="crm-need-control">
          <textarea
            id={`${idBase}-need`}
            rows={1}
            defaultValue="Utility trailer fender repair"
          />
          <button type="button" aria-label="Change job need by voice">
            <Mic aria-hidden="true" size={17} strokeWidth={1.9} />
            Speak
          </button>
        </div>
        <button
          type="button"
          className="crm-more-details"
          aria-expanded="false"
          aria-controls={`${idBase}-more-details`}
        >
          More details
        </button>
        <div id={`${idBase}-more-details`} hidden />
      </div>

      <div className="crm-save-lane">
        <button type="button" className="crm-save">
          Save Job
        </button>
      </div>
    </section>
  )
}

function WorkRow({
  customer,
  work,
  detail,
}: {
  customer: string
  work: string
  detail: string
}) {
  return (
    <div className="crm-row">
      <div className="crm-row-copy">
        <strong>{customer}</strong>
        <span>{work}</span>
      </div>
      <span className="crm-row-detail">{detail}</span>
      <button type="button" aria-label={`Open ${customer}`}>
        Open
      </button>
    </div>
  )
}

function QueueSection({
  idBase,
  kind,
  title,
  count,
  subdued = false,
}: {
  idBase: string
  kind: "attention" | "active"
  title: string
  count: number
  subdued?: boolean
}) {
  const rows =
    kind === "attention"
      ? [
          {
            customer: "Mike Henderson",
            work: "Utility trailer fender repair",
            detail: "Call back · 12m",
          },
          {
            customer: "Brentwood Sign Co.",
            work: "Handrail quote",
            detail: "Reply needed · 1h",
          },
        ]
      : [
          {
            customer: "Avery Transport",
            work: "Trailer gate rebuild",
            detail: "In the shop",
          },
          {
            customer: "Green Hills HOA",
            work: "Pool fence repair",
            detail: "Due tomorrow",
          },
        ]

  const summary =
    kind === "attention" ? `${count} waiting on you` : `${count} in progress`

  return (
    <section
      className={`crm-queue crm-queue--${kind}`}
      aria-labelledby={`${idBase}-${kind}-title`}
      aria-hidden={subdued || undefined}
      inert={subdued || undefined}
    >
      <header>
        <div className="crm-queue-heading">
          <h3 id={`${idBase}-${kind}-title`}>{title}</h3>
          <p>{summary}</p>
        </div>
        <button type="button">View all</button>
      </header>
      <div className="crm-rows">
        {rows.map((row) => (
          <WorkRow key={row.customer} {...row} />
        ))}
      </div>
    </section>
  )
}

function ProductPreview({
  variant,
  viewport,
  mode = "post-call",
}: {
  variant: FinalistVariant
  viewport: "phone" | "desktop"
  mode?: "post-call" | "manual"
}) {
  const idBase = `${variant}-${viewport}-${mode}`

  return (
    <div
      className={`crm-preview crm-preview--${variant} crm-preview--${viewport} crm-preview--${mode}`}
      data-viewport={viewport}
    >
      <header className="crm-topbar">
        <strong>MCSW Jobs</strong>
        <div>
          <span>Philippe</span>
          <button type="button">More</button>
        </div>
      </header>

      <div className="crm-work">
        <CaptureForm idBase={idBase} mode={mode} />
        <QueueSection
          idBase={idBase}
          kind="attention"
          title="Needs Attention"
          count={2}
          subdued={variant === "sheet"}
        />
        <QueueSection
          idBase={idBase}
          kind="active"
          title="Active Jobs"
          count={8}
          subdued={variant === "sheet"}
        />
      </div>
    </div>
  )
}

function FinalistSection({
  finalist,
  recommended = false,
}: {
  finalist: Finalist
  recommended?: boolean
}) {
  return (
    <section
      className={`finalist${recommended ? " finalist--winner" : ""}`}
      id={recommended ? "winner" : `finalist-${finalist.id.toLowerCase()}`}
    >
      <header className="finalist-heading">
        <div>
          <p className="finalist-number">
            {recommended ? "Recommended winner" : `Revised ${finalist.id}`}
          </p>
          <h2>{finalist.name}</h2>
          <p>{finalist.premise}</p>
        </div>
        <p className="finalist-adjustments">{finalist.adjustments}</p>
      </header>

      <div className="finalist-previews">
        <figure className="finalist-figure finalist-figure--phone">
          <figcaption>
            Phone · 360 px{recommended ? " · after a call" : ""}
          </figcaption>
          <ProductPreview variant={finalist.variant} viewport="phone" />
        </figure>
        {recommended ? (
          <figure className="finalist-figure finalist-figure--phone finalist-figure--manual">
            <figcaption>Phone · manual Add Job</figcaption>
            <ProductPreview variant={finalist.variant} viewport="phone" mode="manual" />
          </figure>
        ) : null}
        <figure className="finalist-figure finalist-figure--desktop">
          <figcaption>Desktop · same hierarchy</figcaption>
          <ProductPreview variant={finalist.variant} viewport="desktop" />
        </figure>
      </div>
    </section>
  )
}

export default function MCSWJobsFinalistsPage() {
  return (
    <main
      className={`${atkinson.variable} ${bitter.variable} ${commissioner.variable} finalists-page`}
    >
      <nav className="finalists-nav" aria-label="Design review">
        <a href="/design-preview/mcsw-jobs-directions" aria-label="Previous MCSW Jobs design review">
          MCSW Jobs
        </a>
        <a href="#winner">Jump to winner</a>
      </nav>

      <header className="finalists-intro">
        <h1>Six refinements. One winner.</h1>
        <p>
          Independently disputed, corrected, and shown with the same real call,
          customer, and job. Only hierarchy, typography, spacing, and structure
          change.
        </p>
      </header>

      <div className="finalists-list">
        {finalists.map((finalist) => (
          <FinalistSection key={finalist.id} finalist={finalist} />
        ))}
      </div>

      <FinalistSection finalist={winner} recommended />

      <footer className="finalists-footer">
        <span>MCSW Jobs · refined design review</span>
        <span>Six candidates · one recommendation</span>
      </footer>
    </main>
  )
}
