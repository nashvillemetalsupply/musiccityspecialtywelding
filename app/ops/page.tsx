import Link from "next/link"
import { dbConfigured } from "@/lib/db"
import { LEAD_STATUSES } from "@/lib/leads"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getOpsStats, getStatusCounts, listLeads, PAGE_SIZE, type LeadFilter } from "@/lib/ops-data"
import { createManualLead } from "./actions"
import { OpsLoginForm } from "./login-form"

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

function ageInWords(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (60 * 24))}d`
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
  const [stats, leads, counts] = await Promise.all([
    getOpsStats(),
    listLeads({ status: statusFilter, includeTests, query: searchQuery, page }),
    getStatusCounts(includeTests),
  ])

  const baseQuery = `status=${statusFilter}${includeTests ? "&tests=1" : ""}${
    searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""
  }`

  const filters: { key: string; label: string }[] = [
    { key: "open", label: "Open" },
    { key: "all", label: "All" },
    ...LEAD_STATUSES.map((status) => ({ key: status, label: status })),
  ]

  return (
    <main className="ops-main">
      <header className="ops-header">
        <div>
          <span className="ops-kicker">Music City Specialty Welding</span>
          <h1>Lead operations</h1>
        </div>
        <form action="/api/ops/logout" method="post">
          <button className="ops-ghost" type="submit">Sign out</button>
        </form>
      </header>

      <section className="ops-stats" aria-label="Pipeline summary">
        <div className={stats.newLeads > 0 ? "is-hot" : ""}>
          <strong>{stats.newLeads}</strong><span>new leads</span>
        </div>
        <div className={stats.awaitingFirstResponse > 0 ? "is-hot" : ""}>
          <strong>{stats.awaitingFirstResponse}</strong><span>awaiting response</span>
        </div>
        <div><strong>{stats.leadsLast30Days}</strong><span>last 30 days</span></div>
        <div>
          <strong>
            {stats.medianFirstResponseMinutes === null
              ? "—"
              : `${Math.round(stats.medianFirstResponseMinutes)}m`}
          </strong>
          <span>median response</span>
        </div>
        <div className={stats.followUpsDue > 0 ? "is-hot" : ""}>
          <strong>{stats.followUpsDue}</strong><span>follow-ups due</span>
        </div>
        <div><strong>{stats.wonJobs}</strong><span>won jobs</span></div>
        <div className="is-money">
          <strong>{formatMoney(stats.totalRevenueCents)}</strong><span>revenue recorded</span>
        </div>
        <div className="is-money">
          <strong>{formatMoney(stats.openEstimateValueCents)}</strong><span>open quote value</span>
        </div>
        <div className={stats.failedDeliveries > 0 ? "is-bad" : ""}>
          <strong>{stats.failedDeliveries}</strong><span>failed email deliveries</span>
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
        <summary>+ Add a phone or walk-in lead</summary>
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
          <button type="submit">Add lead</button>
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

      <section className="ops-table-wrap" aria-label="Leads">
        {leads.length === 0 ? (
          <p className="ops-empty">No leads match this view.</p>
        ) : (
          <table className="ops-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Contact</th>
                <th>Job</th>
                <th>Source</th>
                <th>Status</th>
                <th>Next step</th>
                <th>Age</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className={lead.is_test ? "is-test" : ""}>
                  <td>
                    <Link href={`/ops/leads/${lead.id}`}>
                      {lead.first_name} {lead.last_name}
                    </Link>
                    <small>{lead.public_id}{lead.is_test ? " · TEST" : ""}</small>
                  </td>
                  <td>
                    <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>{lead.phone}</a>
                    {lead.email && <small>{lead.email}</small>}
                  </td>
                  <td>
                    {lead.service}
                    {lead.photo_count > 0 && <small>{lead.photo_count} photo(s)</small>}
                  </td>
                  <td>{lead.source}</td>
                  <td>
                    <span className={`ops-status is-${lead.status}`}>{lead.status}</span>
                    {lead.email_delivery_status === "failed" && (
                      <small className="is-bad">email failed</small>
                    )}
                  </td>
                  <td>
                    {lead.next_follow_up_at ? (
                      <span className={isOverdue(lead.next_follow_up_at) ? "is-bad" : ""}>
                        {formatCentral(lead.next_follow_up_at)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td title={formatCentral(lead.created_at)}>{ageInWords(lead.created_at)}</td>
                  <td>
                    {lead.status === "won"
                      ? formatMoney(lead.revenue_cents)
                      : formatMoney(lead.estimate_value_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
