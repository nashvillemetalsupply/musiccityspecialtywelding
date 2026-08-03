import Link from "next/link"
import { notFound } from "next/navigation"
import { dbConfigured } from "@/lib/db"
import { LEAD_STATUSES, type LeadEventRow } from "@/lib/leads"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getLead, getLeadEvents } from "@/lib/ops-data"
import { OpsLoginForm } from "../../login-form"
import {
  acknowledgeDeliveryFailure,
  deleteTestLead,
  logInteraction,
  markFirstResponse,
  markReviewRequested,
  recordInvoice,
  saveEstimate,
  saveNotes,
  saveOutcome,
  setFollowUp,
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

function money(cents: unknown) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return ""
  return `$${(n / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function digits(phone: string) {
  return phone.replace(/[^\d+]/g, "")
}

/* Plain-English history lines — no raw JSON on the shop floor. */
function describeEvent(event: LeadEventRow): string {
  const d = (event.detail ?? {}) as Record<string, unknown>
  switch (event.type) {
    case "created":
      return `Job hit the board (source: ${d.source ?? "unknown"})`
    case "email_sent":
      return "Owner email delivered"
    case "email_failed":
      return `Owner email FAILED${d.error ? ` — ${d.error}` : ""}`
    case "first_response":
      return `First call-back made (${d.channel ?? "unrecorded"})`
    case "interaction":
      return `Touch logged: ${d.channel ?? "contact"}${d.note ? ` — “${d.note}”` : ""}`
    case "follow_up_set":
      return `Reminder set for ${formatCentral(typeof d.at === "string" ? d.at : null)}`
    case "follow_up_cleared":
      return "Reminder cleared"
    case "status_changed":
      return `Stamped ${String(d.status ?? "").toUpperCase()}${d.reason ? ` — ${d.reason}` : ""}`
    case "estimate_saved":
      return d.cents == null ? "Estimate cleared" : `Estimate saved: ${money(d.cents)}`
    case "outcome_saved":
      return d.revenueCents == null
        ? "Outcome updated"
        : `Job WON — ${money(d.revenueCents)}${d.completed ? " · completed" : ""}`
    case "notes_saved":
      return "Notes updated"
    case "review_tracked":
      return d.received ? "Review received" : "Review requested"
    case "invoice_recorded":
      return `Invoice #${d.invoiceNumber ?? "?"} recorded (${d.dueDays === 0 ? "due on receipt" : `net ${d.dueDays}`})`
    case "invoice_cleared":
      return "Invoice tracking cleared"
    case "estimate_emailed":
      return d.sent
        ? `Estimate emailed to the customer (${money(d.cents)})`
        : "Estimate email FAILED to send"
    case "thankyou_emailed":
      return d.sent ? "Thank-you email sent to the customer" : "Thank-you email FAILED to send"
    case "delivery_acknowledged":
      return "Email failure marked handled"
    default:
      return event.type.replace(/_/g, " ")
  }
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
            <Link href="/ops">← Back to the board</Link>
          </span>
          <h1 className="ops-neon">
            {lead.first_name} {lead.last_name}
            {lead.is_test && <em className="ops-test-flag"> INTERNAL TEST</em>}
          </h1>
          <p className="ops-sub">
            Job <strong>#{lead.id}</strong> · in {formatCentral(lead.created_at)}
          </p>
        </div>
        <div className={`ops-stamp-ink is-${lead.status} ops-stamp-hero`}>{lead.status}</div>
      </header>

      <div className="ops-phone-row">
        <div>
          <span>Customer line</span>
          <strong>{lead.phone}</strong>
        </div>
        <a className="ops-act-call" href={`tel:${digits(lead.phone)}`}>Call now</a>
        <a className="ops-act-text" href={`sms:${digits(lead.phone)}`}>Text</a>
        {lead.email && <a className="ops-act-mail" href={`mailto:${lead.email}`}>Email</a>}
      </div>

      <div className="ops-columns">
        <section className="ops-card ops-order" aria-label="Work order">
          <h2>The job</h2>
          <p className="ops-order-service">{lead.service}</p>
          {lead.message && <p className="ops-order-details">“{lead.message}”</p>}

          {Array.isArray(lead.photos) && lead.photos.length > 0 && (
            <>
              <h2>Job photos</h2>
              <div className="ops-photos">
                {lead.photos.map((photo) => (
                  <a
                    key={photo.pathname}
                    href={`/api/ops/photo?path=${encodeURIComponent(photo.pathname)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {/* Private blob photos stream through an authenticated route. */}
                    <img
                      src={`/api/ops/photo?path=${encodeURIComponent(photo.pathname)}`}
                      alt={`Job photo ${photo.name}`}
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            </>
          )}

          <h2>The customer</h2>
          <dl>
            <div>
              <dt>Email</dt>
              <dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : "not given"}</dd>
            </div>
            <div><dt>Prefers</dt><dd>{lead.preferred_contact || "—"}</dd></div>
            <div>
              <dt>First call-back</dt>
              <dd>
                {lead.first_response_at
                  ? `${formatCentral(lead.first_response_at)} — ${responseMinutes} min (${lead.first_response_channel || "unrecorded"})`
                  : "not yet"}
              </dd>
            </div>
            {lead.next_follow_up_at && (
              <div>
                <dt>Next reminder</dt>
                <dd>{formatCentral(lead.next_follow_up_at)}</dd>
              </div>
            )}
          </dl>

          <h2>Where it came from</h2>
          <dl>
            <div><dt>Source</dt><dd>{lead.source}</dd></div>
            {lead.utm_campaign && <div><dt>Campaign</dt><dd>{lead.utm_campaign}</dd></div>}
            {lead.gclid && <div className="ops-span"><dt>Ad click ID</dt><dd className="ops-mono">{lead.gclid}</dd></div>}
            {lead.landing_page && (
              <div className="ops-span"><dt>Landed on</dt><dd className="ops-mono">{lead.landing_page}</dd></div>
            )}
            {lead.referrer && <div className="ops-span"><dt>Referred by</dt><dd className="ops-mono">{lead.referrer}</dd></div>}
            <div>
              <dt>Owner email</dt>
              <dd className={lead.email_delivery_status === "failed" ? "is-bad" : ""}>
                {lead.email_delivery_status}
                {lead.email_delivery_error ? ` — ${lead.email_delivery_error}` : ""}
                {lead.email_delivery_status === "failed" && (
                  <form action={acknowledgeDeliveryFailure} className="ops-inline-ack">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <button type="submit" className="ops-ghost">Mark handled</button>
                  </form>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="ops-card ops-tools" aria-label="Work the lead">
          <h2>Respond</h2>

          {!lead.first_response_at && (
            <form action={markFirstResponse} className="ops-inline-form">
              <input type="hidden" name="leadId" value={lead.id} />
              <label htmlFor="response-channel">Called them back via</label>
              <select id="response-channel" name="channel" defaultValue="phone">
                <option value="phone">phone</option>
                <option value="text">text</option>
                <option value="email">email</option>
                <option value="in-person">in person</option>
              </select>
              <button type="submit">Mark first response</button>
            </form>
          )}

          <form action={logInteraction} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="interaction-channel">Log a touch</label>
            <select id="interaction-channel" name="channel" defaultValue="phone">
              <option value="phone">called</option>
              <option value="text">texted</option>
              <option value="email">emailed</option>
              <option value="voicemail">left voicemail</option>
              <option value="in-person">met in person</option>
            </select>
            <input name="note" placeholder="What happened? (optional)" />
            <button type="submit">Log it</button>
          </form>

          <form action={setFollowUp} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="follow-up-when">Remind me</label>
            <select id="follow-up-when" name="quick" defaultValue="1d">
              <option value="4h">in 4 hours</option>
              <option value="1d">tomorrow</option>
              <option value="3d">in 3 days</option>
              <option value="1w">next week</option>
            </select>
            <button type="submit">Set reminder</button>
            {lead.next_follow_up_at && (
              <button type="submit" name="clear" value="1" className="ops-ghost">
                Clear reminder
              </button>
            )}
          </form>

          <h2>Money</h2>

          <form action={saveEstimate} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-estimate">Estimate ($) — stamps it QUOTED</label>
            <input
              id="lead-estimate"
              name="estimate"
              inputMode="decimal"
              defaultValue={centsToDollars(lead.estimate_value_cents)}
              placeholder="e.g. 1200"
            />
            {lead.email && (
              <label className="ops-check">
                <input type="checkbox" name="emailEstimate" />
                email this estimate to the customer
              </label>
            )}
            <button type="submit">Save estimate</button>
          </form>

          <form action={saveOutcome} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-revenue">Final revenue ($) — stamps it WON</label>
            <input
              id="lead-revenue"
              name="revenue"
              inputMode="decimal"
              defaultValue={centsToDollars(lead.revenue_cents)}
              placeholder="what it actually paid"
            />
            <label className="ops-check">
              <input type="checkbox" name="completed" defaultChecked={Boolean(lead.completed_at)} />
              job completed
            </label>
            {lead.email && (
              <label className="ops-check">
                <input type="checkbox" name="sendThanks" />
                send the thank-you email
              </label>
            )}
            <button type="submit">Save outcome</button>
          </form>

          <form action={recordInvoice} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="invoice-number">
              QuickBooks invoice — the board chases it until revenue is saved
            </label>
            <input
              id="invoice-number"
              name="invoiceNumber"
              defaultValue={lead.invoice_number}
              placeholder="Invoice # (e.g. 1337)"
            />
            <select name="dueDays" defaultValue="14" aria-label="Due terms">
              <option value="0">due on receipt</option>
              <option value="7">net 7</option>
              <option value="14">net 14</option>
              <option value="30">net 30</option>
            </select>
            <button type="submit">{lead.invoiced_at ? "Update invoice" : "Invoice is out"}</button>
            {lead.invoiced_at && (
              <>
                <span className="ops-followup-current">
                  #{lead.invoice_number} out since {formatCentral(lead.invoiced_at)} · due {formatCentral(lead.invoice_due_at)}
                  {lead.revenue_cents === null && lead.invoice_due_at && new Date(lead.invoice_due_at).getTime() < Date.now()
                    ? " · OVERDUE"
                    : ""}
                </span>
                <button type="submit" name="clear" value="1" className="ops-ghost">Clear</button>
              </>
            )}
          </form>

          <h2>Paper trail</h2>

          <form action={updateLeadStatus} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-status">Re-stamp the ticket</label>
            <select id="lead-status" name="status" defaultValue={lead.status}>
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <input name="reason" placeholder="Reason (required for lost/spam)" defaultValue={lead.status_reason} />
            <button type="submit">Stamp it</button>
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
            <textarea
              id="lead-notes"
              name="notes"
              rows={5}
              defaultValue={lead.notes}
              placeholder="Quote numbers, measurements, gate codes, the dog's name…"
            />
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

      <section className="ops-card ops-history" aria-label="History">
        <h2>The story so far</h2>
        <ol className="ops-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <span>{formatCentral(event.created_at)}</span>
              <strong>{describeEvent(event)}</strong>
              {event.actor !== "system" && <em>by {event.actor}</em>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
