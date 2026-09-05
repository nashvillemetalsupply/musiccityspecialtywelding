import "../../../styles/ops-legacy.css"
import type { ReactNode } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { dbConfigured } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { normalizePage } from "@/lib/pagination"
import { listRegularAccounts } from "@/lib/wall-data"
import { chivo, golos } from "@/app/fonts"
import { SkipLink } from "../skip-link"
import { ThemeBoot } from "../theme-boot"
import { BoardRouteNav } from "../board-route-nav"
import "./customers.css"

export const metadata: Metadata = {
  title: "Regular Customers",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ accountQ?: string; accountPage?: string }>

const PAGE_SIZE = 30

// The query params are the ones the old regulars index used, so a
// bookmarked search still lands on the same page of the same list.
function href(page: number, query: string) {
  const params = new URLSearchParams()
  if (page > 1) params.set("accountPage", String(page))
  if (query) params.set("accountQ", query)
  const search = params.toString()
  return search ? `/board/customers?${search}` : "/board/customers"
}

export default async function BoardCustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  // This list is real customer names, so it is gated the way /ops is. Signed
  // out there is nothing to show and nowhere to sign in but the door itself.
  if (!dbConfigured()) return <PageShell><h1 className="t-title">Regular Customers</h1><p>The operations database is not configured.</p></PageShell>
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")

  const query = params.accountQ?.trim() ?? ""
  const result = await listRegularAccounts({ page: normalizePage(params.accountPage), pageSize: PAGE_SIZE, query })
  // The page is whatever the query settled on, not what was asked for: an
  // over-run page number clamps back into range inside listRegularAccounts.
  const page = result.page

  return <PageShell nav={<BoardRouteNav role={operator.role} current="customers" />}>
      <header className="cust-top">
        <Link className="btn btn--edge" href="/board">Board</Link>
        <h1 className="t-title">Regular Customers</h1>
        <span className="cust-count t-label">{result.total} on the books</span>
      </header>

      <form className="cust-find" action="/board/customers" method="get">
        <label className="t-label" htmlFor="account-q">Search customers</label>
        <div className="find">
          <input id="account-q" name="accountQ" type="search" autoComplete="off" defaultValue={query} placeholder="Name, company or account" />
        </div>
        <button className="btn btn--go" type="submit">Search</button>
      </form>

      {result.items.length === 0 ? (
        <p className="cust-empty t-data">No customers found.</p>
      ) : (
        <ul className="cust-list">
          {result.items.map((account) => (
            <li key={account.person_id}>
              <Link className="cust-row" href={`/ops/accounts/${account.person_id}`}>
                <strong className="cust-name t-data">{account.label}</strong>
                <span className={`chip ${account.live_count ? "chip--warn" : "chip--info"}`}>
                  <i />
                  {account.live_count ? `${account.live_count} active` : `${account.job_count} jobs`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || result.hasNext) && (
        <nav className="cust-pages" aria-label="Customer pages">
          {page > 1 ? <Link className="btn btn--edge" href={href(page - 1, query)}>Newer</Link> : <span />}
          <span className="t-label">Page {page}</span>
          {result.hasNext ? <Link className="btn btn--edge" href={href(page + 1, query)}>Older</Link> : <span />}
        </nav>
      )}
      </PageShell>
}

// Keep the landmark and skip target identical for normal and unavailable states.
function PageShell({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  return <div className={`${golos.variable} ${chivo.variable}`}>
    <SkipLink />
    <ThemeBoot />
    <main id="main" tabIndex={-1} className="cust">{children}</main>
    {nav}
  </div>
}
