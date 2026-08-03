import Link from "next/link"
import { notFound } from "next/navigation"
import { dbConfigured } from "@/lib/db"
import { LEAD_STATUSES } from "@/lib/leads"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getLead, getLeadEvents } from "@/lib/ops-data"
import { OpsLoginForm } from "../../login-form"
import {
  deleteTestLead,
  markFirstResponse,
  markReviewRequested,
  saveEstimate,
  saveNotes,
  saveOutcome,
  updateLeadStatus,
} from "../../actions"

export const dynamic = "force-dynamic"

function formatCentral(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function centsToDollars(cents: number | null) {
  return cents === null ? "" : String(Math.round(cents / 100))
}

type Params = Promise<{ id: string }>

export default async function LeadDetailPage({ params }: { params: Params }) {
  const { id } = await params
  const leadId = Number(id)
  if (!Number.isInteger(leadId) || leadId <= 0) notFound()

  if (!dbConfigured()) {
    return (
      <main className="ops-login">
        <h1>Shop operations</h1>
        <p className="ops-alert">The operations database is not configured.</p>
      </main>
    )
  }

  const operator = await getAuthenticatedOperator()
  if (!operator) return <OpsLoginForm linkError={false} />

  const [lead, events] = await Promise.all([getLead(leadId), getLeadEvents(leadId)])
  if (!lead) notFound()

  const responseMinutes = lead.first_response_at
    ? Math.round(
        (new Date(lead.first_response_at).getTime() - new Date(lead.created_at).getTime()) / 60000
      )
    : null

  return (
    <main className="ops-main ops-detail">
      <header className="ops-header">
        <div>
          <span className="ops-kicker">
            <Link href="/ops">← All leads</Link>
          </span>
          <h1>
            {lead.first_name} {lead.last_name}
            {lead.is_test && <em className="ops-test-flag"> INTERNAL TEST</em>}
          </h1>
          <p className="ops-sub">
            {lead.public_id} · received {formatCentral(lead.created_at)} ·{" "}
            <span className={`ops-status is-${lead.status}`}>{lead.status}</span>
          </p>
        </div>
      </header>

      <div className="ops-columns">
        <section className="ops-card" aria-label="Lead details">
          <h2>The job</h2>
          <dl>
            <div><dt>Phone</dt><dd><a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>{lead.phone}</a></dd></div>
            <div><dt>Email</dt><dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : "—"}</dd></div>
            <div><dt>Service</dt><dd>{lead.service}</dd></div>
            <div><dt>Preferred contact</dt><dd>{lead.preferred_contact || "—"}</dd></div>
            <div><dt>Photos</dt><dd>{lead.photo_count > 0 ? `${lead.photo_count} attached to the quote email` : "none"}</dd></div>
            <div className="ops-span"><dt>Details</dt><dd>{lead.message || "—"}</dd></div>
          </dl>
          <h2>Where it came from</h2>
          <dl>
            <div><dt>Source</dt><dd>{lead.source}</dd></div>
            {lead.gclid && <div><dt>gclid</dt><dd className="ops-mono">{lead.gclid.slice(0, 24)}…</dd></div>}
            {lead.utm_campaign && <div><dt>Campaign</dt><dd>{lead.utm_campaign}</dd></div>}
            <div className="ops-span"><dt>Landing page</dt><dd>{lead.landing_page || "—"}</dd></div>
            <div className="ops-span"><dt>Referrer</dt><dd>{lead.referrer || "—"}</dd></div>
            <div>
              <dt>Owner email</dt>
              <dd className={lead.email_delivery_status === "failed" ? "is-bad" : ""}>
                {lead.email_delivery_status}
                {lead.email_delivery_error ? ` — ${lead.email_delivery_error}` : ""}
              </dd>
            </div>
            <div>
              <dt>First response</dt>
              <dd>
                {lead.first_response_at
                  ? `${formatCentral(lead.first_response_at)} (${responseMinutes}m, ${lead.first_response_channel || "unrecorded"})`
                  : "not yet"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="ops-card" aria-label="Work the lead">
          <h2>Work it</h2>

          {!lead.first_response_at && (
            <form action={markFirstResponse} className="ops-inline-form">
              <input type="hidden" name="leadId" value={lead.id} />
              <label htmlFor="response-channel">Responded via</label>
              <select id="response-channel" name="channel" defaultValue="phone">
                <option value="phone">phone</option>
                <option value="text">text</option>
                <option value="email">email</option>
                <option value="in-person">in person</option>
              </select>
              <button type="submit">Mark first response</button>
            </form>
          )}

          <form action={updateLeadStatus} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-status">Status</label>
            <select id="lead-status" name="status" defaultValue={lead.status}>
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <input name="reason" placeholder="Reason (required for lost/spam)" defaultValue={lead.status_reason} />
            <button type="submit">Save status</button>
          </form>

          <form action={saveEstimate} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-estimate">Estimate ($)</label>
            <input
              id="lead-estimate"
              name="estimate"
              inputMode="decimal"
              defaultValue={centsToDollars(lead.estimate_value_cents)}
              placeholder="e.g. 1200"
            />
            <button type="submit">Save estimate</button>
          </form>

          <form action={saveOutcome} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-revenue">Final revenue ($)</label>
            <input
              id="lead-revenue"
              name="revenue"
              inputMode="decimal"
              defaultValue={centsToDollars(lead.revenue_cents)}
              placeholder="marks the job won"
            />
            <label className="ops-check">
              <input type="checkbox" name="completed" defaultChecked={Boolean(lead.completed_at)} />
              job completed
            </label>
            <button type="submit">Save outcome</button>
          </form>

          <form action={markReviewRequested} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label className="ops-check">
              <input type="checkbox" name="received" defaultChecked={lead.review_received} />
              review received
            </label>
            <button type="submit">
              {lead.review_requested_at ? "Update review tracking" : "Mark review requested"}
            </button>
          </form>

          <form action={saveNotes} className="ops-notes-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-notes">Notes</label>
            <textarea id="lead-notes" name="notes" rows={5} defaultValue={lead.notes} />
            <button type="submit">Save notes</button>
          </form>

          {lead.is_test && (
            <form action={deleteTestLead} className="ops-inline-form">
              <input type="hidden" name="leadId" value={lead.id} />
              <button type="submit" className="ops-danger">Delete this internal test lead</button>
            </form>
          )}
        </section>
      </div>

      <section className="ops-card" aria-label="History">
        <h2>History</h2>
        <ol className="ops-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <span>{formatCentral(event.created_at)}</span>
              <strong>{event.type}</strong>
              <em>{event.actor}</em>
              {event.detail && <code>{JSON.stringify(event.detail)}</code>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
