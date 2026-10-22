import Link from "next/link"
import { randomUUID } from "node:crypto"
import type { Operator } from "@/lib/operators"
import { listBusinessEntries } from "@/lib/business-entries"
import { S81_BUSINESS_KEYS } from "@/lib/sms-operator-commands"
import { recordBusinessEntryAction } from "./business-actions"

export function businessName(key: string) {
  const labels: Record<string, string> = {
    "grease-patrol": "Grease Patrol",
    ld2r: "LD2R",
    railing: "Railing",
    builderbox: "BuilderBox",
  }
  return labels[key] ?? key
}

export function BusinessSwitcher({ active }: { active?: string }) {
  return <nav className="business-switcher" aria-label="Business">
    <Link className={!active ? "active" : ""} aria-current={!active ? "page" : undefined} href="/board">MCSW Jobs</Link>
    {S81_BUSINESS_KEYS.map((key) => <Link key={key} className={active === key ? "active" : ""}
      aria-current={active === key ? "page" : undefined} href={`/board?business=${encodeURIComponent(key)}`}>
      {businessName(key)}
    </Link>)}
  </nav>
}

function formatDollars(cents: unknown) {
  const value = typeof cents === "number" ? cents : Number(cents)
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100)
}

export async function BusinessWorkspace({ business, operator, saved }: {
  business: string
  operator: Operator
  saved: boolean
}) {
  const entries = await listBusinessEntries({ business, operator })
  const requestId = randomUUID()
  return <main className="business-workspace">
    <header>
      <p className="business-kicker">MCSW CRM · {operator.role === "owner" ? "Owner" : "Crew"}</p>
      <h1>{businessName(business)}</h1>
      <p>Booked and paid facts use the selected S81 business tag.</p>
    </header>

    <section className="business-entry-panel" aria-labelledby="business-entry-heading">
      <h2 id="business-entry-heading">Record a fact</h2>
      <form action={recordBusinessEntryAction}>
        <input type="hidden" name="business" value={business} />
        <input type="hidden" name="requestId" value={requestId} />
        <label>Entry
          <select name="verb" defaultValue="booked">
            <option value="booked">Booked</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <label>Count or amount in dollars
          <input name="value" inputMode="decimal" autoComplete="off" required
            placeholder="Booked: 2 · Paid: 450.00" />
        </label>
        <button type="submit">Save to {businessName(business)}</button>
      </form>
      {saved && <p role="status">Recorded for {businessName(business)}.</p>}
    </section>

    <section className="business-entry-list" aria-labelledby="business-entry-list-heading">
      <h2 id="business-entry-list-heading">Recent entries</h2>
      {entries.length === 0 ? <p>No entries yet for this business.</p> : <ol>
        {entries.map((entry) => {
          const detail = entry.detail ?? {}
          const verb = detail.verb === "paid" ? "Paid" : "Booked"
          const result = detail.verb === "paid"
            ? formatDollars(detail.amountCents)
            : `${Number(detail.count ?? 0)} ${Number(detail.count) === 1 ? "job" : "jobs"}`
          return <li key={entry.id}>
            <span><strong>{verb}: {result}</strong><small>{new Date(entry.occurred_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</small></span>
          </li>
        })}
      </ol>}
    </section>
  </main>
}
