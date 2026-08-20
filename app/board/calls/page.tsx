import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { dbConfigured } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { normalizePage } from "@/lib/pagination"
import { listPendingCallIntakes, type CallIntakeDraft } from "@/lib/job-intake"
import "./calls.css"

export const metadata: Metadata = {
  title: "Calls to Save",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ callsPage?: string }>

const PAGE_SIZE = 20

// The three statuses are the ones the call row has always said. A draft whose
// call never connected is a missed call, a draft whose call is still up is on
// the phone now, and anything else is a finished call waiting to be written
// down. Nothing here invents a fourth state the calls table cannot hold.
const MISSED = ["no-answer", "busy", "failed", "canceled"]

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
  if (digits.length !== 10) return phone || "Number unavailable"
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  })
}

// Both sides of the "is this today" comparison format in America/Chicago, so
// the answer is the shop's, not whatever timezone happened to render the page.
const CENTRAL_DAY: Intl.DateTimeFormatOptions = {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "short",
  day: "numeric",
}

function formatDay(iso: string, now: Date) {
  const day = new Date(iso).toLocaleDateString("en-US", CENTRAL_DAY)
  return day === now.toLocaleDateString("en-US", CENTRAL_DAY) ? "" : day
}

function CallDraftRow({ draft, now }: { draft: CallIntakeDraft; now: Date }) {
  const missed = MISSED.includes(draft.call_status)
  const ringing = draft.call_status === "ringing"
  const day = formatDay(draft.created_at, now)
  const need = draft.need.trim()
  return <article className="calls-row">
    <div className="calls-copy">
      <span className={`chip ${missed ? "chip--warn" : ringing ? "chip--info" : "chip--good"}`}>
        <i />
        {missed ? "Missed call" : ringing ? "On the phone now" : "Call ready"}
      </span>
      <span className="t-caption">{day ? `${day} · ${formatTime(draft.created_at)}` : formatTime(draft.created_at)}</span>
      <strong className="calls-who t-data">{draft.caller_name || formatPhone(draft.phone)}</strong>
      <p className="t-caption">{formatPhone(draft.phone)}</p>
      {need && <p className="calls-need t-caption">{need}</p>}
    </div>
    <Link className="btn btn--go" href={`/ops/intake/${draft.public_id}`}>Finish</Link>
  </article>
}

export default async function BoardCallsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  // A pending call carries a real caller's name and number, so it is gated the
  // way the rest of /ops is: signed out there is nothing to show and nowhere to
  // sign in but the door itself.
  if (!dbConfigured()) return <main><h1>Calls to save</h1><p>The operations database is not configured.</p></main>
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")

  const calls = await listPendingCallIntakes({ page: normalizePage(params.callsPage), pageSize: PAGE_SIZE })
  // The rendered page is whatever the query settled on: an over-run page
  // number clamps back into range inside listPendingCallIntakes.
  const page = calls.page
  // One clock reading for the whole page, so every row agrees on what today is.
  const now = new Date()

  return (
    <main className="calls">
      <header className="calls-top">
        <Link className="btn btn--edge" href="/board">Board</Link>
        <h1 className="t-title">Calls to save</h1>
        <span className="calls-count t-label">{calls.total} total</span>
      </header>

      {calls.items.length === 0 ? (
        <p className="calls-empty t-data">No calls are waiting to be saved.</p>
      ) : (
        <div className="calls-list">
          {calls.items.map((draft) => <CallDraftRow draft={draft} now={now} key={draft.id} />)}
        </div>
      )}

      {calls.total > calls.pageSize && (
        <nav className="calls-pages" aria-label="Calls to save pages">
          {page > 1 ? <Link className="btn btn--edge" href={`/board/calls?callsPage=${page - 1}`}>Newer</Link> : <span />}
          <span className="t-label">Page {page} of {Math.ceil(calls.total / calls.pageSize)}</span>
          {page * calls.pageSize < calls.total ? <Link className="btn btn--edge" href={`/board/calls?callsPage=${page + 1}`}>Older</Link> : <span />}
        </nav>
      )}
    </main>
  )
}
