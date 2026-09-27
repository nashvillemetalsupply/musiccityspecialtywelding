import "../../../styles/ops-legacy.css"
import type { ReactNode } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { dbConfigured, getSql } from "@/lib/db"
import { listRecentDeliveryErrors } from "@/lib/delivery-errors"
import { getReadableEventById } from "@/lib/event-access"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { countUnreadWire, listWire } from "@/lib/notify"
import { normalizePage } from "@/lib/pagination"
import { shopEventLabel } from "@/lib/shop-language"
import { PaidMoment } from "@/app/ops/paid-moment"
import { WireStrip } from "@/app/ops/wire-strip"
import { chivo, golos } from "@/app/fonts"
import { SkipLink } from "../skip-link"
import { ThemeBoot } from "../theme-boot"
import { BoardRouteNav } from "../board-route-nav"
import "../board.css"
import "./updates.css"

export const metadata: Metadata = {
  title: "MCS Welding Updates",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ wire?: string; wirePage?: string; wireQ?: string; receipt?: string }>

function formatCentral(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function ageInWords(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1_440)}d`
}

// Updates is the board's own archive, not a second dashboard. It carries real
// customer names, real money and owner-only call audio, so it is gated the way
// /ops is: signed out goes to the sign-in door, and every role projection stays
// on this server. The board's signed-out zero state is deliberately not
// borrowed here — an empty archive frame would say nothing a login does not.
export default async function BoardUpdatesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  if (!dbConfigured()) return <PageShell><h1 className="t-title">Updates</h1><p>The operations database is not configured.</p></PageShell>
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")

  const wireHistory = params.wire === "past"
  const requestedWirePage = normalizePage(params.wirePage)
  const wireQuery = params.wireQ?.trim() ?? ""
  const wirePageSize = wireHistory ? 50 : 12
  const [wireResult, unreadWireTotal, recentDeliveryErrors] = await Promise.all([
    listWire(operator.id, operator.role, { unreadOnly: !wireHistory, page: requestedWirePage, pageSize: wirePageSize, query: wireQuery }),
    countUnreadWire(operator.id, operator.role),
    operator.role === "owner" ? listRecentDeliveryErrors() : Promise.resolve([]),
  ])
  const wire = wireResult.items
  const wirePage = wireResult.page
  const wireHasOlder = wireResult.hasNext

  // The drawer reads the event itself and projects it for the operator's role
  // before anything renders. A crew member asking for an owner-only receipt by
  // id gets the "not available in your role" card, never the row.
  const receiptId = Number(params.receipt)
  const receiptRequested = Number.isInteger(receiptId) && receiptId > 0
  const receipt = receiptRequested ? await getReadableEventById(receiptId, operator.role) : null
  const receiptCall = receipt && typeof receipt.detail?.callSid === "string"
    ? (await getSql()`SELECT id FROM calls WHERE twilio_sid = ${receipt.detail.callSid}::text LIMIT 1`) as { id: number }[]
    : []

  const paidSlip = wire.find((slip) => slip.source_kind === "invoice.paid")

  return <PageShell nav={<BoardRouteNav role={operator.role} current="updates" />}>
    {paidSlip && <PaidMoment slipId={paidSlip.id} title={paidSlip.title} body={paidSlip.body} />}

    <header className="updates-head">
      <div>
        <p className="t-label">Job Control</p>
        <h1 className="t-title">Updates</h1>
      </div>
      <Link className="btn btn--edge" href="/board">Back to the board</Link>
    </header>

    <WireStrip
      history={wireHistory}
      unreadTotal={unreadWireTotal}
      page={wirePage}
      hasOlder={wireHasOlder}
      query={wireQuery}
      slips={wire.map((slip) => ({
        id: slip.id,
        stock: slip.stock,
        title: slip.title,
        body: slip.body,
        url: slip.url,
        age: ageInWords(slip.created_at),
        actionKind: slip.action_kind,
        actionDetail: slip.action_detail,
      }))}
    />

    {operator.role === "owner" && <section className="updates-delivery" aria-labelledby="updates-delivery-title">
      <header>
        <div>
          <p className="t-label">Delivery</p>
          <h2 className="t-title" id="updates-delivery-title">Recent failures</h2>
        </div>
        <span className="t-caption">Last 24 hours</span>
      </header>
      {recentDeliveryErrors.length ? <ul>
        {recentDeliveryErrors.map((error) => <li key={`${error.at}:${error.title}`}>
          <div><strong>{error.title}</strong><time dateTime={error.at}>{formatCentral(error.at)}</time></div>
          <p>{error.error}</p>
        </li>)}
      </ul> : <p className="updates-delivery-empty">No delivery failures in the last 24 hours.</p>}
    </section>}

    {receiptRequested && <section className="updates-receipt" id="receipt">
      <header>
        <div>
          <span className="t-label">Source</span>
          <h2 className="t-title">{receipt ? shopEventLabel(receipt.kind) : "Owner-only update"}</h2>
        </div>
        <Link className="btn btn--sm btn--edge" href="/board/updates">Close</Link>
      </header>
      {receipt ? <>
        <time className="t-caption">{formatCentral(receipt.occurred_at)}</time>
        <p>{receipt.body}</p>
        {receiptCall[0] && operator.role === "owner" && <audio controls preload="none" src={`/api/ops/call/${receiptCall[0].id}`} />}
        {receipt.lead_id && <Link className="btn btn--sm btn--edge" href={`/ops/leads/${receipt.lead_id}`}>Open job</Link>}
      </> : <p>This update is not available in your role.</p>}
    </section>}
    </PageShell>
}

// Keep the landmark and skip target identical for normal and unavailable states.
function PageShell({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  return <div className={`${golos.variable} ${chivo.variable}`}>
    <SkipLink />
    <ThemeBoot />
    <main id="main" tabIndex={-1} className="updates-page">{children}</main>
    {nav}
  </div>
}
