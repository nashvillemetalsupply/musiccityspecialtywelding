import type { Metadata } from "next"
import { dbConfigured } from "@/lib/db"
import { getPromiseSummary } from "@/lib/commitments"
import { listTodayEvents } from "@/lib/events"
import { getLatestBoardCallSketch } from "@/lib/call-sketch-store"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { BOARD_SIGNAL_KINDS, getBoardJobDetails, getOpsStats, getOutTheDoorWeek, JOB_BOARD_STAGES, listBoardJobs } from "@/lib/ops-data"
import type { JobBoardStage } from "@/lib/ops-data"
import type { BoardSignalKind } from "@/lib/shop-brain-invariants.mjs"
import { JobControl } from "./board"
import type { BoardPaneData } from "./board"
import "./board.css"

export const metadata: Metadata = {
  title: "MCS Welding Job Control",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ q?: string; stage?: string; signal?: string }>

const BOARD_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "long",
  month: "short",
  day: "numeric",
})

// This value must stay in the server module. Exporting it from the client
// component turns it into a client reference instead of serializable data.
const EMPTY_BOARD: BoardPaneData = {
  counts: { board: 0, attention: 0, shop: 0, waiting: 0, ready: 0 },
  signalCounts: { waiting: 0, noreply: 0, promise: 0, followup: 0, bounced: 0 },
  promises: { kept: 0, open: 0, broken: 0, overdue: null },
  outTheDoor: { jobs: 0, paidJobs: 0, revenueCents: null, stillOutCents: null },
  medianFirstResponseMinutes: null,
  todayTrail: [],
  callSketch: null,
  items: [],
  details: new Map(),
  resultTotal: 0,
  pageSize: 5,
  stage: "board",
  signal: undefined,
  stages: [...JOB_BOARD_STAGES],
}

export default async function BoardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const query = params.q?.trim().slice(0, 80) ?? ""
  // The stage tab is validated strictly against
  // JOB_BOARD_STAGES — anything else falls back to the full board, so a
  // hand-typed ?stage= value can never manufacture a view that does not exist.
  const requested = params.stage ?? "board"
  const stage: JobBoardStage = JOB_BOARD_STAGES.includes(requested as JobBoardStage)
    ? (requested as JobBoardStage)
    : "board"
  const requestedSignal = params.signal ?? ""
  const signal: BoardSignalKind | undefined = BOARD_SIGNAL_KINDS.includes(requestedSignal as BoardSignalKind)
    ? (requestedSignal as BoardSignalKind)
    : undefined

  // This route carries real customer names and real money, so it is gated the
  // way /ops is. Signed out, the board renders its structural zero state —
  // every frame, label and weight, with real zeros and no rows. The mockup's
  // fixtures are never a fallback: a hand-typed number that survives onto a
  // wired page is exactly the failure this redesign exists to kill.
  const operator = dbConfigured() ? await getAuthenticatedOperator() : null
  const chrome = {
    date: BOARD_DATE.format(new Date()),
    operatorInitial: (operator?.name || operator?.email || "").trim().charAt(0).toLocaleUpperCase("en-US"),
    owner: operator?.role === "owner",
    query,
  }
  if (!operator) return <JobControl board={{ ...EMPTY_BOARD, stage, signal, stages: [...JOB_BOARD_STAGES] }} chrome={chrome} />

  const role = operator.role
  const [page, promises, outTheDoor, stats, todayEvents, callSketch] = await Promise.all([
    // Oldest first is the tracker's own sort. The pane's counts are
    // aggregates over the same query and do not depend on row order.
    listBoardJobs({ stage, signal, order: "oldest", query }, role),
    getPromiseSummary(),
    getOutTheDoorWeek(role),
    getOpsStats(role),
    listTodayEvents(role),
    getLatestBoardCallSketch(),
  ])
  const details = await getBoardJobDetails(page.items.map((item) => item.id), role)

  return <JobControl chrome={chrome} board={{
    counts: page.counts,
    signalCounts: page.signalCounts,
    promises,
    outTheDoor,
    medianFirstResponseMinutes: stats.medianFirstResponseMinutes,
    todayTrail: todayEvents.map(({ id, occurred_at: occurredAt, kind, body }) => ({ id, occurredAt, kind, body })),
    callSketch,
    items: page.items,
    details,
    resultTotal: page.resultTotal,
    pageSize: page.pageSize,
    stage,
    signal,
    stages: [...JOB_BOARD_STAGES],
  }} />
}
