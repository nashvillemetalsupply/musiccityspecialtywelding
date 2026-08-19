import type { Metadata } from "next"
import { dbConfigured } from "@/lib/db"
import { getPromiseSummary } from "@/lib/commitments"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getOpsStats, getOutTheDoorWeek, listBoardJobs } from "@/lib/ops-data"
import { JobControlPreview, EMPTY_BOARD } from "./job-control-preview"
import "./job-control.css"

export const metadata: Metadata = {
  title: "MCS Welding Job Control",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function JobControlPreviewPage() {
  // This route carries real customer names and real money, so it is gated the
  // way /ops is. Signed out, the board renders its structural zero state —
  // every frame, label and weight, with real zeros. The mockup's fixtures are
  // never a fallback: a hand-typed number that survives onto a wired page is
  // exactly the failure this redesign exists to kill.
  const operator = dbConfigured() ? await getAuthenticatedOperator() : null
  if (!operator) return <JobControlPreview board={EMPTY_BOARD} />

  const role = operator.role
  const [page, promises, outTheDoor, stats] = await Promise.all([
    listBoardJobs({ order: "weight" }, role),
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
  }} />
}
