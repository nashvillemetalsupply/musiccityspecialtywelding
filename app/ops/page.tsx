import Link from "next/link"
import { dbConfigured } from "@/lib/db"
import { LEAD_STATUSES } from "@/lib/leads"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import {
  getMonthRevenueCents,
  getNeedsNow,
  getOpsStats,
  getStatusCounts,
  listLeads,
  PAGE_SIZE,
  type LeadFilter,
} from "@/lib/ops-data"
import { createManualLead } from "./actions"
import { OpsLoginForm } from "./login-form"
import { PushToggle } from "./push-toggle"

export const dynamic = "force-dynamic"

function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—"
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function formatCentral(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function isOverdue(iso: string) {
  return new Date(iso).getTime() <= Date.now()
}

function ageMinutes(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
}

function ageInWords(iso: string) {
  const minutes = ageMinutes(iso)
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (60 * 24))}d`
}

function heatClass(lead: { created_at: string; first_response_at: string | null; status: string }) {
  if (lead.first_response_at || !["new", "contacted"].includes(lead.status)) return ""
  const minutes = ageMinutes(lead.created_at)
  if (minutes >= 240) return " is-heat-red"
  if (minutes >= 60) return " is-heat-hot"
  return ""
}

function digits(phone: string) {
  return phone.replace(/[^\d+]/g, "")
}

/* Hand-drawn speed-to-lead gauge. Needle sweeps 0–60+ minutes across 180°. */
function SpeedGauge({ minutes }: { minutes: number | null }) {
  const clamped = minutes === null ? null : Math.min(Math.max(minutes, 0), 60)
  const angle = clamped === null ? -90 : -90 + (clamped / 60) * 180
  const zone = minutes === null ? "none" : minutes <= 15 ? "good" : minutes <= 45 ? "warn" : "bad"
  return (
    <div className={`ops-gauge is-${zone}`}>
      <svg viewBox="0 0 200 118" aria-hidden="true" focusable="false">
        <path d="M18 104 A82 82 0 0 1 182 104" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.35" />
        <path d="M18 104 A82 82 0 0 1 63 33" fill="none" stroke="#4c7a3d" strokeWidth="7" strokeLinecap="round" />
        <path d="M63 33 A82 82 0 0 1 137 33" fill="none" stroke="#c99b1c" strokeWidth="7" strokeLinecap="round" />
        <path d="M137 33 A82 82 0 0 1 182 104" fill="none" stroke="#b3402a" strokeWidth="7" strokeLinecap="round" />
        {[0, 15, 30, 45, 60].map((m) => {
          const a = ((-90 + (m / 60) * 180) * Math.PI) / 180
          const x1 = 100 + Math.sin(a) * 68
          const y1 = 104 - Math.cos(a) * 68
          const x2 = 100 + Math.sin(a) * 78
          const y2 = 104 - Math.cos(a) * 78
          return <line key={m} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="3" />
        })}
        <g transform={`rotate(${angle} 100 104)`}>
          <line x1="100" y1="104" x2="100" y2="34" stroke="#241a10" strokeWidth="5" strokeLinecap="round" />
          <circle cx="100" cy="104" r="9" fill="#241a10" />
          <circle cx="100" cy="104" r="3.5" fill="#f3ead8" />
        </g>
      </svg>
      <strong>{minutes === null ? "—" : `${Math.round(minutes)} min`}</strong>
      <span>median first call-back</span>
    </div>
  )
}

type SearchParams = Promise<{
  status?: string
  tests?: string
  error?: string
  q?: string
  page?: string
}>

export default async function OpsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams

  if (!dbConfigured()) {
    return (
      <main className="ops-login">
        <h1>Shop operations</h1>
        <p className="ops-alert">The operations database is not configured.</p>
      </main>
    )
  }

  const operator = await getAuthenticatedOperator()
  if (!operator) {
    return <OpsLoginForm linkError={params.error === "link"} />
  }

  const statusFilter = (params.status ?? "open") as LeadFilter["status"]
  const includeTests = params.tests === "1"
  const searchQuery = params.q?.trim() ?? ""
  const page = Math.max(1, Number(params.page) || 1)
  const [stats, leads, counts, needsNow, monthRevenue] = await Promise.all([
    getOpsStats(),
    listLeads({ status: statusFilter, includeTests, query: searchQuery, page }),
    getStatusCounts(includeTests),
    getNeedsNow(),
    getMonthRevenueCents(),
  ])

  const baseQuery = `status=${statusFilter}${includeTests ? "&tests=1" : ""}${
    searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""
  }`

  const filters: { key: string; label: string }[] = [
    { key: "open", label: "Open" },
    { key: "all", label: "All" },
    ...LEAD_STATUSES.map((status) => ({ key: status, label: status })),
  ]

  const urgent = [
    ...needsNow.due.map((lead) => ({ lead, reason: "follow-up due" })),
    ...needsNow.unanswered
      .filter((lead) => !needsNow.due.some((d) => d.id === lead.id))
      .map((lead) => ({ lead, reason: "no call back yet" })),
  ].slice(0, 8)

  return (
    <main className="ops-main">
      <header className="ops-header">
        <div>
          <span className="ops-kicker">Music City Specialty Welding</span>
          <h1 className="ops-neon">Lead board</h1>
          <p className="ops-board-note">Every job. Every promise. On the wall.</p>
        </div>
        <div className="ops-header-actions">
          <PushToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? ""} />
          <form action="/api/ops/logout" method="post">
            <button className="ops-ghost" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      {urgent.length > 0 && (
        <section className="ops-now" aria-label="Needs you now">
          <h2 className="ops-now-title">Needs you now</h2>
          <div className="ops-now-strip">
            {urgent.map(({ lead, reason }) => (
              <div className="ops-ticket-urgent" key={`${lead.id}-${reason}`}>
                <strong>
                  <Link href={`/ops/leads/${lead.id}`}>
                    {lead.first_name} {lead.last_name}
                  </Link>
                </strong>
                <span>{lead.service}</span>
                <em>{reason} · in {ageInWords(lead.created_at)}</em>
                <div>
                  <a href={`tel:${digits(lead.phone)}`}>Call</a>
                  <a href={`sms:${digits(lead.phone)}`}>Text</a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="ops-deck" aria-label="Shop pulse">
        <SpeedGauge minutes={stats.medianFirstResponseMinutes} />
        <div className="ops-stats">
          <div className={stats.newLeads > 0 ? "is-hot" : ""}>
            <strong>{stats.newLeads}</strong><span>new leads</span>
          </div>
          <div className={stats.awaitingFirstResponse > 0 ? "is-hot" : ""}>
            <strong>{stats.awaitingFirstResponse}</strong><span>awaiting call-back</span>
          </div>
          <div className={stats.followUpsDue > 0 ? "is-hot" : ""}>
            <strong>{stats.followUpsDue}</strong><span>follow-ups due</span>
          </div>
          <div><strong>{stats.leadsLast30Days}</strong><span>last 30 days</span></div>
          <div className="is-money">
            <strong>{formatMoney(monthRevenue)}</strong><span>won this month</span>
          </div>
          <div className="is-money">
            <strong>{formatMoney(stats.totalRevenueCents)}</strong><span>revenue all-time</span>
          </div>
          <div className="is-money">
            <strong>{formatMoney(stats.openEstimateValueCents)}</strong><span>quotes on the street</span>
          </div>
          <div className={stats.failedDeliveries > 0 ? "is-bad" : ""}>
            <strong>{stats.failedDeliveries}</strong><span>failed email deliveries</span>
          </div>
        </div>
      </section>

      {stats.sourceBreakdown.length > 0 && (
        <section className="ops-sources" aria-label="Lead sources">
          {stats.sourceBreakdown.map((row) => (
            <span key={row.source}>
              {row.source}: <strong>{row.count}</strong>
              {row.won > 0 ? ` (${row.won} won)` : ""}
            </span>
          ))}
        </section>
      )}

      <nav className="ops-filters" aria-label="Lead filters">
        {filters.map((filter) => {
          const count = counts[filter.key] ?? 0
          return (
            <Link
              key={filter.key}
              className={statusFilter === filter.key ? "is-active" : ""}
              href={`/ops?status=${filter.key}${includeTests ? "&tests=1" : ""}${
                searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""
              }`}
            >
              {filter.label}
              {count > 0 && <em>{count}</em>}
            </Link>
          )
        })}
        <Link
          className={includeTests ? "is-active" : ""}
          href={`/ops?status=${statusFilter}${includeTests ? "" : "&tests=1"}${
            searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""
          }`}
        >
          {includeTests ? "hide tests" : "show tests"}
        </Link>
        <a href="/api/ops/export" className="ops-ghost">Export CSV</a>
        <a href="/api/ops/export?format=google-oci" className="ops-ghost">Ads conversions</a>
      </nav>

      <details className="ops-add-lead">
        <summary>+ Write up a phone or walk-in lead</summary>
        <form action={createManualLead} className="ops-inline-form">
          <input name="firstName" placeholder="Name *" required aria-label="Name" />
          <input name="phone" type="tel" inputMode="tel" placeholder="Phone *" required aria-label="Phone" />
          <select name="service" defaultValue="" aria-label="Service">
            <option value="">Service (optional)</option>
            <option>Mobile Welding (On-Site)</option>
            <option>Trailer / Truck Welding Repair</option>
            <option>Equipment & Structural Repair</option>
            <option>Architectural Welding & Fabrication</option>
            <option>Specialty Fabrication</option>
            <option>Aluminum / Boat Welding</option>
            <option>Custom Wrought Iron Mailboxes</option>
            <option>Custom Metal Planter Boxes</option>
            <option>Stainless Countertops / Manifolds</option>
            <option>Not Sure / Other</option>
          </select>
          <select name="source" defaultValue="phone-in" aria-label="How it came in">
            <option value="phone-in">called in</option>
            <option value="walk-in">walked in</option>
            <option value="referral-word-of-mouth">referral</option>
            <option value="repeat-customer">repeat customer</option>
          </select>
          <input name="message" placeholder="What do they need?" aria-label="Job details" />
          <button type="submit">Put it on the board</button>
        </form>
      </details>

      <form className="ops-search" action="/ops" method="get">
        <input type="hidden" name="status" value={statusFilter} />
        {includeTests && <input type="hidden" name="tests" value="1" />}
        <input
          type="search"
          name="q"
          defaultValue={searchQuery}
          placeholder="Search name, phone, job, notes…"
          aria-label="Search leads"
        />
        <button type="submit" className="ops-ghost">Search</button>
        {searchQuery && (
          <Link className="ops-ghost" href={`/ops?status=${statusFilter}${includeTests ? "&tests=1" : ""}`}>
            Clear
          </Link>
        )}
      </form>

      <section className="ops-tickets" aria-label="Leads">
        {leads.length === 0 ? (
          <p className="ops-empty">Nothing on the board for this view.</p>
        ) : (
          leads.map((lead) => (
            <article className={`ops-ticket${lead.is_test ? " is-test" : ""}${heatClass(lead)}`} key={lead.id}>
              <div className="ops-ticket-punch" aria-hidden="true" />
              <div className="ops-ticket-id">
                <span>{lead.public_id}</span>
                <em>{formatCentral(lead.created_at)} · {ageInWords(lead.created_at)} ago</em>
              </div>
              <div className="ops-ticket-who">
                <Link href={`/ops/leads/${lead.id}`}>
                  {lead.first_name} {lead.last_name}
                  {lead.is_test ? " · TEST" : ""}
                </Link>
                <span>{lead.service}{lead.photo_count > 0 ? ` · ${lead.photo_count} photo(s)` : ""}</span>
                <em>{lead.source}{lead.email_delivery_status === "failed" ? " · EMAIL FAILED" : ""}</em>
              </div>
              <div className={`ops-stamp-ink is-${lead.status}`}>{lead.status}</div>
              <div className="ops-ticket-value">
                {lead.status === "won"
                  ? formatMoney(lead.revenue_cents)
                  : lead.estimate_value_cents !== null
                    ? formatMoney(lead.estimate_value_cents)
                    : "—"}
                {lead.next_follow_up_at && (
                  <em className={isOverdue(lead.next_follow_up_at) ? "is-bad" : ""}>
                    ↻ {formatCentral(lead.next_follow_up_at)}
                  </em>
                )}
              </div>
              <div className="ops-ticket-actions">
                <a href={`tel:${digits(lead.phone)}`}>Call</a>
                <a href={`sms:${digits(lead.phone)}`}>Text</a>
                <Link href={`/ops/leads/${lead.id}`}>Open</Link>
              </div>
            </article>
          ))
        )}
      </section>

      {(page > 1 || leads.length === PAGE_SIZE) && (
        <nav className="ops-filters" aria-label="Pages">
          {page > 1 && (
            <Link className="ops-ghost" href={`/ops?${baseQuery}&page=${page - 1}`}>
              ← Newer
            </Link>
          )}
          <span className="ops-followup-current">page {page}</span>
          {leads.length === PAGE_SIZE && (
            <Link className="ops-ghost" href={`/ops?${baseQuery}&page=${page + 1}`}>
              Older →
            </Link>
          )}
        </nav>
      )}
    </main>
  )
}
