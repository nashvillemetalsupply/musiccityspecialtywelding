import Link from "next/link"
import { randomUUID } from "node:crypto"
import type { Operator } from "@/lib/operators"
import { listBusinessEntries } from "@/lib/business-entries"
import { GREASE_BUSINESS_KEY, listRoofJobs } from "@/lib/roof-jobs"
import { S81_BUSINESS_KEYS } from "@/lib/sms-operator-commands"
import { addRoofJobAction, markRoofJobPaidAction } from "./business-actions"

// Grease Patrol runs its own job board in the Grease app (O1, 2026-10-23).
export const GREASE_PATROL_OPS_URL = "https://musiccitygreasepatrol.com/ops"

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
  if (cents === null || cents === undefined || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100)
}

const when = (value: string) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })

function Header({ business, operator, line }: { business: string; operator: Operator; line: string }) {
  return <header>
    <p className="business-kicker">MCSW CRM · {operator.role === "owner" ? "Owner" : "Crew"}</p>
    <h1>{businessName(business)}</h1>
    <p>{line}</p>
  </header>
}

async function GreaseWorkspace({ operator }: { operator: Operator }) {
  const entries = await listBusinessEntries({ business: GREASE_BUSINESS_KEY, operator })
  return <main className="business-workspace">
    <Header business={GREASE_BUSINESS_KEY} operator={operator} line="Grease Patrol jobs are booked and paid on the Grease Patrol ops board." />
    <section className="business-entry-panel">
      <a className="business-ops-link" href={GREASE_PATROL_OPS_URL} target="_blank" rel="noopener noreferrer">Grease Patrol ops</a>
    </section>
    <section className="business-entry-list" aria-labelledby="business-entry-list-heading">
      <h2 id="business-entry-list-heading">Text log</h2>
      {entries.length === 0 ? <p>No Grease Patrol texts yet.</p> : <ol>
        {entries.map((entry) => {
          const detail = entry.detail ?? {}
          const result = detail.verb === "paid"
            ? `Paid: ${formatDollars(detail.amountCents)}`
            : `Booked: ${Number(detail.count ?? 0)} ${Number(detail.count) === 1 ? "job" : "jobs"}`
          return <li key={entry.id}><span><strong>{result}</strong><small>{when(entry.occurred_at)}</small></span></li>
        })}
      </ol>}
    </section>
  </main>
}

export async function BusinessWorkspace({ business, operator, saved }: {
  business: string
  operator: Operator
  saved?: string
}) {
  if (business === GREASE_BUSINESS_KEY) return <GreaseWorkspace operator={operator} />
  const jobs = await listRoofJobs({ business, operator })
  const requestId = randomUUID()
  const name = businessName(business)
  return <main className="business-workspace">
    <Header business={business} operator={operator} line="One row per job. Add it when it is booked, mark it paid when the money is in." />

    <section className="business-entry-panel" aria-labelledby="business-entry-heading">
      <h2 id="business-entry-heading">Add a job</h2>
      <form action={addRoofJobAction} className="roof-job-form">
        <input type="hidden" name="business" value={business} />
        <input type="hidden" name="requestId" value={requestId} />
        <label>Customer name
          <input name="customerName" autoComplete="off" maxLength={120} />
        </label>
        <label>Phone
          <input name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </label>
        <label>Job date
          <input name="jobDate" type="date" />
        </label>
        <label>Amount in dollars
          <input name="amount" inputMode="decimal" autoComplete="off" placeholder="450.00" />
        </label>
        <label className="roof-job-note">Note
          <input name="note" autoComplete="off" maxLength={500} />
        </label>
        {operator.role === "owner" && <label className="roof-job-test">
          <input name="isTest" type="checkbox" /> Test entry (kept out of the numbers)
        </label>}
        <button type="submit">Add booked job</button>
      </form>
      {saved === "added" && <p role="status">Job added to {name}.</p>}
      {saved === "paid" && <p role="status">Job marked paid.</p>}
    </section>

    <section className="business-entry-list" aria-labelledby="business-entry-list-heading">
      <h2 id="business-entry-list-heading">Jobs</h2>
      {jobs.length === 0 ? <p>No jobs yet for {name}.</p> : <ol>
        {jobs.map((job) => <li key={job.id}>
          <span>
            <strong>{job.customer_name || "No name"} · {job.status === "paid" ? `Paid ${formatDollars(job.amount_cents)}` : "Booked"}{job.is_test ? " · TEST" : ""}</strong>
            <small>
              {[job.phone, job.job_date && `Job ${job.job_date}`, job.status === "booked" && job.amount_cents !== null && formatDollars(job.amount_cents), job.note]
                .filter(Boolean).join(" · ")}
            </small>
            <small>Added {when(job.created_at)}{job.paid_at ? ` · paid ${when(job.paid_at)}` : ""}</small>
          </span>
          {job.status === "booked" && <form action={markRoofJobPaidAction} className="roof-job-pay">
            <input type="hidden" name="business" value={business} />
            <input type="hidden" name="jobId" value={job.id} />
            {job.amount_cents === null && <input name="amount" inputMode="decimal" autoComplete="off" required
              placeholder="Amount" aria-label={`Amount paid for job ${job.id}`} />}
            <button type="submit">Mark paid</button>
          </form>}
        </li>)}
      </ol>}
    </section>
  </main>
}
