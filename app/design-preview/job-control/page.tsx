import type { Metadata } from "next"
import { dbConfigured } from "@/lib/db"
import { getPromiseSummary } from "@/lib/commitments"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getOpsStats, getOutTheDoorWeek, JOB_BOARD_STAGES, listBoardJobs } from "@/lib/ops-data"
import type { JobBoardStage } from "@/lib/ops-data"
import { JobControlPreview } from "./job-control-preview"
import type { BoardPaneData } from "./job-control-preview"
import "./job-control.css"

export const metadata: Metadata = {
  title: "MCS Welding Job Control",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ stage?: string }>

// This value must stay in the server module. Exporting it from the client
// component turns it into a client reference instead of serializable data.
const EMPTY_BOARD: BoardPaneData = {
  counts: { board: 0, attention: 0, shop: 0, waiting: 0, ready: 0 },
  signalCounts: { waiting: 0, noreply: 0, promise: 0, followup: 0, bounced: 0 },
  promises: { kept: 0, open: 0, broken: 0, overdue: null },
  outTheDoor: { jobs: 0, paidJobs: 0, revenueCents: null, stillOutCents: null },
  medianFirstResponseMinutes: null,
  items: [],
  resultTotal: 0,
  pageSize: 5,
  stage: "board",
  stages: [...JOB_BOARD_STAGES],
}

export default async function JobControlPreviewPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  // The stage tab is the only query input. It is validated strictly against
  // JOB_BOARD_STAGES — anything else falls back to the full board, so a
  // hand-typed ?stage= value can never manufacture a view that does not exist.
  const requested = params.stage ?? "board"
  const stage: JobBoardStage = JOB_BOARD_STAGES.includes(requested as JobBoardStage)
    ? (requested as JobBoardStage)
    : "board"

  // This route carries real customer names and real money, so it is gated the
  // way /ops is. Signed out, the board renders its structural zero state —
  // every frame, label and weight, with real zeros and no rows. The mockup's
  // fixtures are never a fallback: a hand-typed number that survives onto a
  // wired page is exactly the failure this redesign exists to kill.
  const operator = dbConfigured() ? await getAuthenticatedOperator() : null
  if (!operator) return <JobControlPreview board={{ ...EMPTY_BOARD, stage, stages: [...JOB_BOARD_STAGES] }} />

  const role = operator.role
  const [page, promises, outTheDoor, stats] = await Promise.all([
    listBoardJobs({ stage, order: "oldest" }, role),
    getPromiseSummary(),
    getOutTheDoorWeek(role),
    getOpsStats(role),
  ])

  return <JobControlPreview board={{
    counts: page.counts,
    signalCounts: page.signalCounts,
    promises,
    outTheDoor,
    medianFirstResponseMinutes: stats.medianFirstResponseMinutes,
    items: page.items,
    resultTotal: page.resultTotal,
    pageSize: page.pageSize,
    stage,
    stages: [...JOB_BOARD_STAGES],
  }} />
}
