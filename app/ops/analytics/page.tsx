import Link from "next/link"
import { redirect } from "next/navigation"
import "../../../styles/control.css"
import "./analytics.css"
import { dbConfigured } from "@/lib/db"
import {
  getOwnerAnalytics,
  normalizeOwnerAnalyticsRange,
  OWNER_ANALYTICS_RANGES,
  type OwnerAnalyticsPeriod,
} from "@/lib/owner-analytics"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ range?: string }>
type MetricKind = "count" | "money" | "rate" | "response"

const centralDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  year: "numeric",
})

function money(cents: number) {
  const decimals = Math.abs(cents) % 100 === 0 ? 0 : 2
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: 2,
  })
}

function percent(value: number | null) {
  if (value === null) return "Not yet"
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`
}

function responseTime(minutes: number | null) {
  if (minutes === null) return "Not yet"
  if (minutes < 1) return "Under 1 min"
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const remainder = Math.round(minutes % 60)
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function metricValue(value: number | null, kind: MetricKind) {
  if (kind === "money") return money(value ?? 0)
  if (kind === "rate") return percent(value)
  if (kind === "response") return responseTime(value)
  return (value ?? 0).toLocaleString("en-US")
}

function changeLabel(current: number | null, prior: number | null, kind: MetricKind) {
  if (current === null || prior === null) return "No comparison yet"
  if (kind === "rate") {
    const points = current - prior
    if (Math.abs(points) < 0.05) return "No change"
    return `${Math.abs(points).toLocaleString("en-US", { maximumFractionDigits: 1 })} points ${points > 0 ? "up" : "down"}`
  }
  if (kind === "response") {
    const difference = current - prior
    if (Math.abs(difference) < 0.5) return "About the same"
    return `${responseTime(Math.abs(difference))} ${difference < 0 ? "faster" : "slower"}`
  }
  if (prior === 0) return current === 0 ? "No change" : "New this period"
  const change = ((current - prior) / Math.abs(prior)) * 100
  if (Math.abs(change) < 0.05) return "No change"
  return `${Math.abs(change).toLocaleString("en-US", { maximumFractionDigits: 1 })}% ${change > 0 ? "up" : "down"}`
}

function periodLabel(period: OwnerAnalyticsPeriod) {
  const end = new Date(new Date(period.endAt).getTime() - 1)
  return `${centralDate.format(new Date(period.startAt))} to ${centralDate.format(end)}`
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    "phone-in": "Phone call",
    "sms-in": "Text message",
    "email-in": "Email",
    "walk-in": "Walk-in",
    web: "Website",
    "google ads": "Google Ads",
    other: "Other sources",
    unknown: "Unknown",
  }
  return labels[source] ?? source.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default async function OwnerAnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  if (!dbConfigured()) {
    return <main className="analytics-page analytics-state-page"><section className="card analytics-state"><h1 className="t-title">Shop Analytics</h1><p>The operations database is not configured.</p></section></main>
  }

  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")
  if (operator.role !== "owner") redirect("/ops")

  const filters = await searchParams
  const days = normalizeOwnerAnalyticsRange(filters.range)
  const analytics = await getOwnerAnalytics(operator.role, days)
  const metricRows: Array<{
    label: string
    current: number | null
    prior: number | null
    kind: MetricKind
  }> = [
    { label: "Leads received", current: analytics.current.leads, prior: analytics.prior.leads, kind: "count" },
    { label: "Booked jobs", current: analytics.current.bookedJobs, prior: analytics.prior.bookedJobs, kind: "count" },
    { label: "Conversion", current: analytics.current.conversionRate, prior: analytics.prior.conversionRate, kind: "rate" },
    { label: "Known revenue", current: analytics.current.revenueCents, prior: analytics.prior.revenueCents, kind: "money" },
    { label: "Paid", current: analytics.current.paidCents, prior: analytics.prior.paidCents, kind: "money" },
    { label: "Unpaid invoice balance", current: analytics.current.unpaidCents, prior: analytics.prior.unpaidCents, kind: "money" },
    { label: "Median first response", current: analytics.current.medianFirstResponseMinutes, prior: analytics.prior.medianFirstResponseMinutes, kind: "response" },
  ]

  return <main className="analytics-page">
    <header className="card analytics-head">
      <div><Link className="analytics-back t-caption" href="/ops">Back to Jobs</Link><span className="t-label">Owner only</span><h1 className="t-title">Shop Analytics</h1><p className="t-caption">Business totals without crew rankings.</p></div>
    </header>

    <nav className="analytics-ranges" aria-label="Analytics period">
      {OWNER_ANALYTICS_RANGES.map((range) => <Link
        aria-current={range === days ? "page" : undefined}
        className={`btn btn--sm btn--edge${range === days ? " is-active" : ""}`}
        href={`/ops/analytics?range=${range}`}
        key={range}
      >{range} days</Link>)}
    </nav>

    <section className="card analytics-card" aria-labelledby="period-totals-heading">
      <header><div><span className="t-label">{periodLabel(analytics.current)}</span><h2 className="t-sub" id="period-totals-heading">Current vs prior period</h2></div><p className="t-caption">Compared with {periodLabel(analytics.prior)}</p></header>
      <div className="analytics-table-wrap">
        <table className="analytics-table">
          <caption className="t-caption">Shop totals for equal lead-arrival periods</caption>
          <thead><tr><th scope="col">Measure</th><th scope="col">Current</th><th scope="col">Prior</th><th scope="col">Change</th></tr></thead>
          <tbody>{metricRows.map((metric) => <tr key={metric.label}>
            <th scope="row">{metric.label}</th>
            <td data-label="Current">{metricValue(metric.current, metric.kind)}</td>
            <td data-label="Prior">{metricValue(metric.prior, metric.kind)}</td>
            <td data-label="Change">{changeLabel(metric.current, metric.prior, metric.kind)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="card analytics-card" aria-labelledby="lead-sources-heading">
      <header><div><span className="t-label">Top seven plus other</span><h2 className="t-sub" id="lead-sources-heading">Lead sources</h2></div></header>
      {analytics.sources.length === 0 ? <p className="analytics-empty t-caption">No leads arrived in either period.</p> : <div className="analytics-table-wrap">
        <table className="analytics-table">
          <caption className="t-caption">Lead source and booking results</caption>
          <thead><tr><th scope="col">Source</th><th scope="col">Current leads</th><th scope="col">Current booked</th><th scope="col">Conversion</th><th scope="col">Prior leads</th></tr></thead>
          <tbody>{analytics.sources.map((source) => <tr key={source.source}>
            <th scope="row">{sourceLabel(source.source)}</th>
            <td data-label="Current leads">{source.currentLeads.toLocaleString("en-US")}</td>
            <td data-label="Current booked">{source.currentBookedJobs.toLocaleString("en-US")}</td>
            <td data-label="Conversion">{percent(source.currentLeads > 0 ? (source.currentBookedJobs / source.currentLeads) * 100 : null)}</td>
            <td data-label="Prior leads">{source.priorLeads.toLocaleString("en-US")}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>

    <aside className="card analytics-method" aria-label="How these numbers are calculated">
      <h2 className="t-sub">How this is counted</h2>
      <p>Each window groups non-test, non-spam jobs by when the lead arrived. Booked means that lead has since reached booked status. Revenue uses recorded revenue only, never estimates. Paid is the amount recorded as paid; unpaid is the remaining recorded invoice balance. Response time excludes leads with no human response yet.</p>
    </aside>
  </main>
}
