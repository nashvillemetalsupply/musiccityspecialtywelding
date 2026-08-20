import Link from "next/link"
import { notFound } from "next/navigation"
import "../../../../styles/control.css"
import "./account.css"
import { getAccount } from "@/lib/accounts"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { OpsLoginForm } from "../../login-form"
import { markAccountRegular, sendUsualPaperwork } from "./actions"
import { TrackedCallButton } from "../../tracked-call-button"
import { listShopDocuments } from "@/lib/shop"
import { PaperworkSubmit } from "./paperwork-submit"
import { getMessagingConsentState } from "@/lib/messaging-consent"
import { twilioSmsConfigured } from "@/lib/twilio"
import { normalizePage } from "@/lib/pagination"
import { shopClaimLabel, shopClaimText, shopJobStatusLabel } from "@/lib/shop-language"

export const dynamic = "force-dynamic"
function money(cents: number) { const decimals = Math.abs(cents) % 100 === 0 ? 0 : 2; return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: 2 }) }

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; q?: string; year?: string }> }) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return <OpsLoginForm linkError={false} />
  const personId = Number((await params).id)
  if (!Number.isInteger(personId) || personId <= 0) notFound()
  const filters = await searchParams
  const requestedPage = normalizePage(filters.page)
  const query = filters.q?.trim().slice(0, 100) ?? ""
  const year = filters.year ? Number(filters.year) : null
  const [account, shopDocuments] = await Promise.all([getAccount(personId, operator.role, { page: requestedPage, query, year }), listShopDocuments()])
  if (!account) notFound()
  const page = account.page
  const label = account.person.company || account.person.display_name || "Regular account"
  const activeContact = account.people.find((person) => person.status === "active") ?? account.person
  const paperworkContact = account.people.find((person) => person.status === "active" && person.emails?.[0])
  const mainPhone = activeContact.phones?.[0] || account.leads[0]?.phone || ""
  const mainEmail = activeContact.emails?.[0] || account.leads[0]?.email || ""
  const callLeadId = account.leads[0]?.id
  const smsReady = twilioSmsConfigured()
  const accountPhones = [...new Set([mainPhone, ...account.people.map((person) => person.phones?.[0] || "")].filter(Boolean))]
  const consentPairs = await Promise.all(accountPhones.map(async (phone) => [phone, await getMessagingConsentState(phone)] as const))
  const canText = (phone: string) => smsReady && new Map(consentPairs).get(phone) === "granted"
  return <main className="account-page">
    <header className="card account-head"><div><Link className="account-back t-caption" href="/ops">Back to Jobs</Link><span className="t-label">Regular Customer</span><h1 className="t-title">{label}</h1><p className="t-caption">Jobs and contact information.</p></div><div className="account-head-actions">{mainPhone && callLeadId && <TrackedCallButton leadId={callLeadId} phone={mainPhone} />}{canText(mainPhone) && callLeadId && <Link className="btn btn--sm btn--edge" href={`/ops/leads/${callLeadId}?replyTo=${activeContact.id}&replyChannel=text#spike`}>Text</Link>}{mainEmail && callLeadId && <Link className="btn btn--sm btn--edge" href={`/ops/leads/${callLeadId}?replyTo=${activeContact.id}&replyChannel=email#spike`}>Email</Link>}</div></header>
    <section className="card account-clipboard" aria-label="Account contact">
      <div className="account-facts"><h2 className="t-sub">Contact</h2><dl><div><dt>Company</dt><dd>{label}</dd></div><div><dt>Phone</dt><dd>{mainPhone || "Not added yet"}</dd></div><div><dt>Email</dt><dd>{mainEmail || "Not added yet"}</dd></div><div><dt>Status</dt><dd>{account.person.status === "departed" ? "No longer active" : "Active"}</dd></div></dl></div>
      {operator.role === "owner" && <aside className="account-money"><span className="t-label">This year</span><strong className="t-display">{money(account.yearTotal)}</strong><small className="t-caption">{account.openInvoices} open invoice{account.openInvoices === 1 ? "" : "s"}</small>{account.openInvoiceRows.map((invoice) => <Link className="account-invoice" href={`/ops/leads/${invoice.id}`} key={invoice.id}><b>#{invoice.invoice_number}</b><span>{invoice.amount_cents ? money(Number(invoice.amount_cents)) : "Amount not caught"}</span><em>{invoice.invoice_due_at ? `due ${new Date(invoice.invoice_due_at).toLocaleDateString("en-US")}` : "due date not caught"}{invoice.invoiced_at && invoice.invoice_due_at ? `, NET ${Math.max(0, Math.round((new Date(invoice.invoice_due_at).getTime() - new Date(invoice.invoiced_at).getTime()) / 86400000))}` : ""}</em></Link>)}</aside>}
    </section>
    <section className="card account-people" aria-label="Account contacts"><header><h2 className="t-sub">Contacts</h2>{operator.role === "owner" && !account.people.some((person) => person.is_regular) && <form action={markAccountRegular}><input type="hidden" name="personId" value={personId} /><button className="btn btn--sm btn--edge" type="submit">Add as regular</button></form>}</header><div>{account.people.map((person) => <article className={person.status === "departed" ? "is-departed" : ""} key={person.id}><strong>{person.display_name || person.emails?.[0] || "Contact"}</strong>{person.company && <span className="t-caption">{person.company}</span>}<small className="t-caption">{person.status === "departed" ? "No longer active" : person.emails?.[0] || person.phones?.[0] || "Contact details still forming"}</small><nav>{person.phones?.[0] && callLeadId && <TrackedCallButton leadId={callLeadId} phone={person.phones[0]} />}{person.phones?.[0] && canText(person.phones[0]) && callLeadId && <Link className="btn btn--sm btn--edge" href={`/ops/leads/${callLeadId}?replyTo=${person.id}&replyChannel=text#spike`}>Text</Link>}{person.emails?.[0] && callLeadId && <Link className="btn btn--sm btn--edge" href={`/ops/leads/${callLeadId}?replyTo=${person.id}&replyChannel=email#spike`}>Email</Link>}</nav></article>)}</div></section>
    <section className="account-tools" aria-label="Account paperwork"><form action={sendUsualPaperwork} className="card account-paperwork"><input type="hidden" name="personId" value={paperworkContact?.id ?? ""} /><input type="hidden" name="idempotencyKey" value={paperworkContact ? `manual-paperwork:${paperworkContact.id}:${shopDocuments.map((item) => item.id).join("-")}` : ""} /><h2 className="t-sub">Send W-9 &amp; Insurance</h2><p>To {paperworkContact?.display_name || paperworkContact?.emails?.[0] || "an active email contact"}. W-9 {shopDocuments.some((item) => item.kind === "w9" && item.status === "ready") ? "ready" : "not on file"}. Insurance {shopDocuments.some((item) => item.kind === "coi" && item.status === "ready") ? "ready" : "not on file"}{shopDocuments.find((item) => item.kind === "coi")?.expires_at ? `, expires ${new Date(shopDocuments.find((item) => item.kind === "coi")!.expires_at!).toLocaleDateString("en-US")}` : ""}.</p>{paperworkContact ? <PaperworkSubmit /> : <button className="btn btn--sm btn--edge" type="button" disabled>Add an active email first</button>}</form>
      <div className="card account-saved"><h2 className="t-sub">Saved Details</h2>{account.claims.filter((claim) => claim.predicate !== "quoted_price_cents").length ? <dl>{account.claims.filter((claim) => claim.predicate !== "quoted_price_cents").map((claim) => <div key={claim.id}><dt>{shopClaimLabel(claim.predicate)}</dt><dd>{shopClaimText(claim.value)}</dd></div>)}</dl> : <p className="account-empty t-caption">No saved details yet.</p>}</div></section>
    {account.commitments.length > 0 && <section className="card account-promises" aria-label="Open promises"><header><h2 className="t-sub">Open Promises</h2><span className="t-caption">{account.commitments.length} open</span></header><div>{account.commitments.map((item) => <Link className="account-promise" href={item.lead_id ? `/ops/leads/${item.lead_id}` : "/ops"} key={item.id}><span className="t-caption">Customer promise</span><strong>{item.summary}</strong><time className="t-caption">{item.due_at ? new Date(item.due_at).toLocaleDateString("en-US") : "No date caught"}</time></Link>)}</div></section>}
    <section className="card account-jobs" aria-label="Job history"><header className="account-jobs-head"><div><span className="t-label">{account.totalJobs} total</span><h2 className="t-sub">Jobs</h2></div><form action={`/ops/accounts/${personId}`} method="get" className="account-search"><input name="q" defaultValue={query} placeholder="Search jobs" aria-label="Search jobs" /><select name="year" defaultValue={year ?? ""} aria-label="Filter jobs by year"><option value="">All years</option>{account.years.map((item) => <option value={item} key={item}>{item}</option>)}</select><button className="btn btn--sm btn--edge" type="submit">Search</button></form></header><div className="account-rows">{account.leads.map((lead) => <article className="account-row" key={lead.id}><div className="account-row-id"><span>Job #{lead.id}</span><em className="t-caption">{new Date(lead.created_at).toLocaleDateString("en-US")}</em></div><div className="account-row-who"><Link href={`/ops/leads/${lead.id}`}>{lead.service}</Link><span className="t-caption">{lead.first_name} {lead.last_name}</span></div><div className={`chip account-stamp is-${lead.status}`}><i />{shopJobStatusLabel(lead.status)}</div><div className="account-row-actions">{lead.phone && <TrackedCallButton leadId={lead.id} phone={lead.phone} />}<Link className="btn btn--sm btn--edge" href={`/ops/leads/${lead.id}`}>Open</Link></div></article>)}</div>{(page > 1 || account.hasOlder) && <nav className="account-pages" aria-label="Job history pages">{page > 1 && <Link className="btn btn--sm btn--edge" href={`/ops/accounts/${personId}?page=${page - 1}${query ? `&q=${encodeURIComponent(query)}` : ""}${year ? `&year=${year}` : ""}`}>Newer</Link>}<span className="t-caption">Page {page}</span>{account.hasOlder && <Link className="btn btn--sm btn--edge" href={`/ops/accounts/${personId}?page=${page + 1}${query ? `&q=${encodeURIComponent(query)}` : ""}${year ? `&year=${year}` : ""}`}>Older</Link>}</nav>}</section>
  </main>
}
