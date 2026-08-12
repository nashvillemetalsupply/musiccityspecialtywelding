import { ArrowUpRight, ChevronRight, Clock3, MoreHorizontal, Phone } from "lucide-react"
import "./directions.css"

type Direction = {
  id: string
  name: string
  note: string
  className: string
  structure?: "queue-first" | "split-rail" | "command-grid" | "call-path"
}

const directions: Direction[] = [
  {
    id: "01",
    name: "Comp Dark",
    note: "Closest to the CRM you sent",
    className: "jobs-direction--comp",
  },
  {
    id: "02",
    name: "MCSW Light",
    note: "Cool white · graphite · red signal",
    className: "jobs-direction--light",
  },
  {
    id: "03",
    name: "Quiet Hybrid",
    note: "Dark intake · cool work surface",
    className: "jobs-direction--hybrid",
  },
  {
    id: "04",
    name: "Humanist",
    note: "Open forms · effortless at phone size",
    className: "jobs-direction--light jobs-direction--type-humanist",
  },
  {
    id: "05",
    name: "Engineered",
    note: "Distinctive · precise · never condensed",
    className: "jobs-direction--comp jobs-direction--type-engineered",
  },
  {
    id: "06",
    name: "Editorial Utility",
    note: "Character headings · plain working text",
    className: "jobs-direction--hybrid jobs-direction--type-editorial",
  },
  {
    id: "07",
    name: "Signal Slab",
    note: "Crisp white · slab authority · MCSW orange",
    className: "jobs-direction--signal-slab jobs-direction--type-slab",
  },
  {
    id: "08",
    name: "Ultramarine",
    note: "Saturated blue · custom flared sans",
    className: "jobs-direction--ultramarine jobs-direction--type-flared",
  },
  {
    id: "09",
    name: "Carbon Signal",
    note: "Charcoal · highlighter yellow · variable type",
    className: "jobs-direction--carbon jobs-direction--type-recursive",
  },
  {
    id: "10",
    name: "Redline Ledger",
    note: "Square geometry · mono headings · signal red",
    className: "jobs-direction--redline jobs-direction--type-ledger",
  },
  {
    id: "11",
    name: "Bordeaux",
    note: "Wine ink · ice blue · editorial character",
    className: "jobs-direction--bordeaux jobs-direction--type-bordeaux",
  },
  {
    id: "12",
    name: "Daymark",
    note: "Citrus paper · deep green · blunt utility",
    className: "jobs-direction--daymark jobs-direction--type-daymark",
  },
  {
    id: "13",
    name: "Sidecar",
    note: "Vertical source rail · compact one-hand scan",
    className: "jobs-direction--sidecar jobs-direction--type-sidecar",
  },
  {
    id: "14",
    name: "Caller First",
    note: "Identity hero · quiet form · centered action",
    className: "jobs-direction--caller-first jobs-direction--type-caller-first",
  },
  {
    id: "15",
    name: "Signal Bands",
    note: "Full-bleed sections · strong order · no cards",
    className: "jobs-direction--bands jobs-direction--type-bands",
  },
  {
    id: "16",
    name: "Inbox First",
    note: "Attention before intake · zero hunting",
    className: "jobs-direction--inbox jobs-direction--type-inbox",
    structure: "queue-first",
  },
  {
    id: "17",
    name: "Twin Pane",
    note: "Work rail left · call capture right",
    className: "jobs-direction--twin-pane jobs-direction--type-twin-pane",
    structure: "split-rail",
  },
  {
    id: "18",
    name: "Command Grid",
    note: "Source and attention share the top deck",
    className: "jobs-direction--command jobs-direction--type-command",
    structure: "command-grid",
  },
  {
    id: "19",
    name: "Plainspoken",
    note: "Ranked list · almost no chrome",
    className: "jobs-direction--plainspoken jobs-direction--type-plainspoken",
  },
  {
    id: "20",
    name: "Attention Strip",
    note: "Urgent work stays visible without taking over",
    className: "jobs-direction--attention-strip jobs-direction--type-attention-strip",
    structure: "queue-first",
  },
  {
    id: "21",
    name: "Worklist",
    note: "Checklist first · familiar ranked work",
    className: "jobs-direction--worklist jobs-direction--type-worklist",
    structure: "queue-first",
  },
  {
    id: "22",
    name: "Focus Capture",
    note: "One call dominates · attention becomes a tray",
    className: "jobs-direction--focus-capture jobs-direction--type-focus-capture",
    structure: "command-grid",
  },
  {
    id: "23",
    name: "Call Path",
    note: "A guided line from source to saved job",
    className: "jobs-direction--call-path jobs-direction--type-call-path",
    structure: "call-path",
  },
  {
    id: "24",
    name: "Open Sheet",
    note: "Worklist behind · Add Job already open",
    className: "jobs-direction--open-sheet jobs-direction--type-open-sheet",
    structure: "queue-first",
  },
]

function DirectionSample({ direction }: { direction: Direction }) {
  const source = (
    <div className="jobs-direction-tabs" aria-label="Customer source">
      <button type="button" className="is-active">
        <Phone aria-hidden="true" size={17} strokeWidth={1.8} />
        Phone call
      </button>
      <button type="button">Walk-in</button>
    </div>
  )

  const heading = (
    <div className="jobs-direction-heading">
      <span>Call ended 10:42 am</span>
      <h3>Save the last call</h3>
    </div>
  )

  const caller = (
    <div className="jobs-direction-caller">
      <div>
        <strong>Mike Henderson</strong>
        <span>(615) 555-0189</span>
      </div>
      <span className="jobs-direction-time">
        <Clock3 aria-hidden="true" size={16} strokeWidth={1.8} />
        6:42
      </span>
      <button type="button">Edit</button>
    </div>
  )

  const need = (
    <label className="jobs-direction-need">
      <span>What do they need?</span>
      <span className="jobs-direction-field">Utility trailer fender repair</span>
    </label>
  )

  const save = (
    <button type="button" className="jobs-direction-save">
      Save Job
      <ChevronRight aria-hidden="true" size={19} strokeWidth={1.8} />
    </button>
  )

  const queue = (
    <div className="jobs-direction-queue">
      <header>
        <strong>Needs Attention</strong>
        <span>2</span>
      </header>
      <div className="jobs-direction-row">
        <div>
          <strong>Mike Henderson</strong>
          <span>Utility trailer fender repair</span>
        </div>
        <button type="button" aria-label="Open Mike Henderson">
          <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )

  const intake = (
    <div className="jobs-direction-intake">
      {source}
      {heading}
      {caller}
      {need}
      {save}
    </div>
  )

  return (
    <article className="jobs-direction-choice" id={`direction-${direction.id}`}>
      <header className="jobs-direction-label">
        <div>
          <h2><span>{direction.id}</span>{direction.name}</h2>
          <p>{direction.note}</p>
        </div>
      </header>

      <section className={`jobs-direction ${direction.className}`} aria-label={`${direction.name} preview`}>
        <header className="jobs-direction-bar">
          <strong>MCSW Jobs</strong>
          <div>
            <span>Philippe</span>
            <button type="button" aria-label="More">
              <MoreHorizontal aria-hidden="true" size={19} strokeWidth={1.8} />
            </button>
          </div>
        </header>

        {direction.structure === "command-grid" ? (
          <div className="jobs-direction-intake jobs-direction-command-grid">
            {source}
            {queue}
            {heading}
            {caller}
            {need}
            {save}
          </div>
        ) : direction.structure === "call-path" ? (
          <>
            <div className="jobs-direction-intake jobs-direction-call-path">
              {source}
              {heading}
              {caller}
              {need}
              {save}
            </div>
            {queue}
          </>
        ) : direction.structure ? (
          <>
            {queue}
            {intake}
          </>
        ) : (
          <>
            {intake}
            {queue}
          </>
        )}
      </section>
    </article>
  )
}

export default async function MCSWJobsDirectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ capture?: string }>
}) {
  const { capture } = await searchParams
  const capturedDirection = capture ? directions.find((direction) => direction.id === capture) : undefined
  const visibleDirections = capturedDirection ? [capturedDirection] : directions

  return (
    <main
      className={`jobs-directions-page${capturedDirection ? " jobs-directions-page--capture" : ""}`}
    >
      {!capturedDirection ? (
        <header className="jobs-directions-intro">
          <p>Design checkpoint</p>
          <h1>Pick a direction.</h1>
          <span>01–18 stay for comparison. 19–24 test six behavior-first workflows.</span>
        </header>
      ) : null}

      <div className="jobs-directions-grid">
        {visibleDirections.map((direction) => (
          <DirectionSample direction={direction} key={direction.id} />
        ))}
      </div>
    </main>
  )
}
