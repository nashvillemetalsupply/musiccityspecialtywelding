import "../../styles/ops-legacy.css"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { after } from "next/server"
import { dbConfigured } from "@/lib/db"
import { getPromiseSummary } from "@/lib/commitments"
import { listTodayEvents } from "@/lib/events"
import { getLatestBoardCallSketch } from "@/lib/call-sketch-store"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { getOwnerVoiceSnapshot } from "@/lib/voice-of-character"
import { normalizePage } from "@/lib/pagination"
import { chivo, golos } from "@/app/fonts"
import { MoreMenu } from "@/app/ops/more-menu"
import { listPendingCallIntakes } from "@/lib/job-intake"
import { RecentCalls } from "./recent-calls"
import { BOARD_SIGNAL_KINDS, getBoardJobDetails, getOpsStats, getOutTheDoorWeek, getWeekAhead, JOB_BOARD_STAGES, listBoardJobs } from "@/lib/ops-data"
import type { JobBoardStage } from "@/lib/ops-data"
import type { BoardSignalKind } from "@/lib/shop-brain-invariants.mjs"
import { JobControl } from "./board"
import type { BoardPaneData } from "./board"
import { runRecoverySweep } from "@/lib/recovery-sweep"
import { wakeGmailIngest } from "@/lib/gmail-wake"
import { requestOriginFromHeaders } from "@/lib/gmail-wake-policy.mjs"
import { canAccessInternalTests } from "@/lib/operators"
import "./board.css"

export const metadata: Metadata = {
  title: "MCS Welding Job Control",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ q?: string; stage?: string; signal?: string; tests?: string; p?: string }>

// The two faces, self-hosted. next/font instances only exist in server modules,
// so the board's client shell is handed the variable class names instead.
const FONT_CLASS = `${golos.variable} ${chivo.variable}`

const BOARD_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "long",
  month: "short",
  day: "numeric",
})

function trailBody(body: string) {
  const oneLine = body.replace(/\s+/g, " ").trim()
  return oneLine.length <= 140 ? oneLine : `${oneLine.slice(0, 137).trimEnd()}...`
}

// This value must stay in the server module. Exporting it from the client
// component turns it into a client reference instead of serializable data.
const EMPTY_BOARD: BoardPaneData = {
  counts: { board: 0, attention: 0, shop: 0, waiting: 0, ready: 0, closed: 0 },
  signalCounts: { waiting: 0, noreply: 0, promise: 0, followup: 0, bounced: 0 },
  promises: { kept: 0, open: 0, broken: 0, overdue: null },
  week: [],
  outTheDoor: { jobs: 0, paidJobs: 0, revenueCents: null, stillOutCents: null },
  medianFirstResponseMinutes: null,
  todayTrail: [],
  callSketch: null,
  voice: null,
  items: [],
  details: new Map(),
  resultTotal: 0,
  pageSize: 8,
  page: 1,
  hasNext: false,
  stage: "board",
  signal: undefined,
  stages: [...JOB_BOARD_STAGES],
}

export default async function BoardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const query = params.q?.trim().slice(0, 80) ?? ""
  const requestedPage = normalizePage(params.p)
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
  // Internal test rows are owner-only. The flag is decided here, on the server,
  // from the role the session resolved to -- a crew member or a signed-out
  // request that hand-types ?tests=1 gets the ordinary board, because the URL
  // never gets a vote. It rides in chrome so the board's own links and its
  // search form can carry the mode forward without the client ever deciding it.
  const includeTests = params.tests === "1" && Boolean(operator && canAccessInternalTests(operator.role))
  const chrome = {
    date: BOARD_DATE.format(new Date()),
    operatorInitial: (operator?.name || operator?.email || "").trim().charAt(0).toLocaleUpperCase("en-US"),
    owner: operator?.role === "owner",
    query,
    includeTests,
  }
  const nowMs = new Date().getTime()
  if (!operator) return <JobControl board={{ ...EMPTY_BOARD, stage, signal, stages: [...JOB_BOARD_STAGES] }} chrome={chrome} nowMs={nowMs} fontClass={FONT_CLASS} />

  const gmailWakeOrigin = operator.role === "owner" ? requestOriginFromHeaders(await headers()) : ""
  if (operator.role === "owner") after(async () => {
    const result = await runRecoverySweep({ trigger: "owner-board" })
    if (!result.ok) console.error("Owner board recovery failed:", result.error)
    if (!result.skipped) {
      const gmailResult = await wakeGmailIngest(gmailWakeOrigin)
      if (!gmailResult.ok) console.error("Owner board Gmail wake failed:", gmailResult.reason)
    }
  })

  const role = operator.role
  // The same menu and dock the /ops pages mount, so #radio and #handset open
  // the Morning Brief and Ask Jobs here too. Signed out there is no menu,
  // which is exactly the /ops layout's own gate.
  const menu = <MoreMenu role={role} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? ""} voiceReady={voiceTranscriptionConfigured()} initialSearch={query} includeTests={includeTests} />
  const [page, promises, week, outTheDoor, stats, todayEvents, callSketch, voice, pendingCalls] = await Promise.all([
    // Newest first is the tracker's own sort (owner's call, 2026-09-03). The
    // pane's counts are aggregates over the same query and do not depend on
    // row order.
    listBoardJobs({ stage, signal, order: "newest", query, includeTests, page: requestedPage }, role),
    getPromiseSummary(role),
    getWeekAhead(role, includeTests),
    getOutTheDoorWeek(role),
    getOpsStats(role),
    listTodayEvents(role),
    getLatestBoardCallSketch(role),
    role === "owner" ? getOwnerVoiceSnapshot() : Promise.resolve(null),
    // The same queue the Calls tab reads, ten at most. Test drafts are already
    // excluded inside the query, the same way the Calls tab excludes them.
    listPendingCallIntakes({ pageSize: 10 }),
  ])
  const calls = <RecentCalls owner={role === "owner"} nowMs={nowMs} total={pendingCalls.total}
    calls={pendingCalls.items.map((draft) => ({
      publicId: draft.public_id,
      name: draft.caller_name,
      phone: draft.phone,
      need: draft.need,
      callStatus: draft.call_status,
      createdAt: draft.created_at,
      summary: draft.summary ?? null,
    }))} />
  const details = await getBoardJobDetails(page.items.map((item) => item.id), role, includeTests)

  return <JobControl chrome={chrome} menu={menu} calls={calls} nowMs={nowMs} fontClass={FONT_CLASS} board={{
    counts: page.counts,
    signalCounts: page.signalCounts,
    promises,
    week,
    outTheDoor,
    medianFirstResponseMinutes: stats.medianFirstResponseMinutes,
    todayTrail: todayEvents.map(({ id, occurred_at: occurredAt, kind, body, customer }) => ({ id, occurredAt, kind, body: trailBody(body), customer })),
    callSketch,
    voice,
    items: page.items,
    details,
    resultTotal: page.resultTotal,
    pageSize: page.pageSize,
    page: page.page,
    hasNext: page.hasNext,
    stage,
    signal,
    stages: [...JOB_BOARD_STAGES],
  }} />
}
