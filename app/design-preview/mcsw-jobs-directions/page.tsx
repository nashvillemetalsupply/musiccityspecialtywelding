import { ArrowUpRight, ChevronRight, Clock3, MoreHorizontal, Phone } from "lucide-react"
import {
  Alegreya,
  Alegreya_Sans,
  Atkinson_Hyperlegible_Next,
  Azeret_Mono,
  Barlow,
  Bitter,
  Chivo,
  Commissioner,
  Familjen_Grotesk,
  Fraunces,
  Funnel_Display,
  Funnel_Sans,
  Geologica,
  Karla,
  Lexend,
  Newsreader,
  Radio_Canada,
  Recursive,
  Sometype_Mono,
  SUSE,
} from "next/font/google"
import "./directions.css"

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-atkinson",
  display: "swap",
  adjustFontFallback: false,
  preload: false,
})

const familjen = Familjen_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-direction-familjen",
  display: "swap",
  preload: false,
})

const geologica = Geologica({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-geologica",
  display: "swap",
  preload: false,
})

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-newsreader",
  display: "swap",
  preload: false,
})

const bitter = Bitter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-bitter",
  display: "swap",
  preload: false,
})

const radioCanada = Radio_Canada({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-radio",
  display: "swap",
  preload: false,
})

const commissioner = Commissioner({
  subsets: ["latin"],
  weight: "variable",
  axes: ["FLAR", "VOLM"],
  variable: "--font-direction-commissioner",
  display: "swap",
  preload: false,
})

const recursive = Recursive({
  subsets: ["latin"],
  weight: "variable",
  axes: ["CASL", "CRSV", "MONO"],
  variable: "--font-direction-recursive",
  display: "swap",
  preload: false,
})

const azeretMono = Azeret_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-azeret",
  display: "swap",
  preload: false,
})

const alegreya = Alegreya({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-direction-alegreya",
  display: "swap",
  preload: false,
})

const alegreyaSans = Alegreya_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-direction-alegreya-sans",
  display: "swap",
  preload: false,
})

const chivo = Chivo({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-direction-chivo",
  display: "swap",
  preload: false,
})

const karla = Karla({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-karla",
  display: "swap",
  preload: false,
})

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-barlow",
  display: "swap",
  preload: false,
})

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-direction-fraunces",
  display: "swap",
  preload: false,
})

const suse = SUSE({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-suse",
  display: "swap",
  preload: false,
})

const lexend = Lexend({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-lexend",
  display: "swap",
  preload: false,
})

const sometypeMono = Sometype_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-sometype",
  display: "swap",
  preload: false,
})

const funnelDisplay = Funnel_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-direction-funnel-display",
  display: "swap",
  preload: false,
})

const funnelSans = Funnel_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-direction-funnel-sans",
  display: "swap",
  preload: false,
})

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
      className={`${atkinson.variable} ${familjen.variable} ${geologica.variable} ${newsreader.variable} ${bitter.variable} ${radioCanada.variable} ${commissioner.variable} ${recursive.variable} ${azeretMono.variable} ${alegreya.variable} ${alegreyaSans.variable} ${chivo.variable} ${karla.variable} ${barlow.variable} ${fraunces.variable} ${suse.variable} ${lexend.variable} ${sometypeMono.variable} ${funnelDisplay.variable} ${funnelSans.variable} jobs-directions-page${capturedDirection ? " jobs-directions-page--capture" : ""}`}
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
