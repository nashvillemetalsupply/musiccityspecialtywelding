import Link from "next/link"
import { notFound } from "next/navigation"
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
  return <main className="ops-main ops-account-page">
    <header className="ops-account-heading"><div><Link href="/ops">Back to Jobs</Link><span>Regular Customer</span><h1>{label}</h1><p>Jobs and contact information.</p></div><div className="ops-header-actions">{mainPhone && callLeadId && <TrackedCallButton leadId={callLeadId} phone={mainPhone} />}{canText(mainPhone) && callLeadId && <Link className="ops-ghost" href={`/ops/leads/${callLeadId}?replyTo=${activeContact.id}&replyChannel=text#spike`}>Text</Link>}{mainEmail && callLeadId && <Link className="ops-ghost" href={`/ops/leads/${callLeadId}?replyTo=${activeContact.id}&replyChannel=email#spike`}>Email</Link>}</div></header>
    <section className="ops-account-clipboard ops-card">
      <div className="ops-account-facts"><h2>Contact</h2><dl><div><dt>Company</dt><dd>{label}</dd></div><div><dt>Phone</dt><dd>{mainPhone || "Not added yet"}</dd></div><div><dt>Email</dt><dd>{mainEmail || "Not added yet"}</dd></div><div><dt>Status</dt><dd>{account.person.status === "departed" ? "No longer active" : "Active"}</dd></div></dl></div>
      {operator.role === "owner" && <aside><span>This year</span><strong>{money(account.yearTotal)}</strong><small>{account.openInvoices} open invoice{account.openInvoices === 1 ? "" : "s"}</small>{account.openInvoiceRows.map((invoice) => <Link className="ops-account-invoice" href={`/ops/leads/${invoice.id}`} key={invoice.id}><b>#{invoice.invoice_number}</b><span>{invoice.amount_cents ? money(Number(invoice.amount_cents)) : "Amount not caught"}</span><em>{invoice.invoice_due_at ? `due ${new Date(invoice.invoice_due_at).toLocaleDateString("en-US")}` : "due date not caught"}{invoice.invoiced_at && invoice.invoice_due_at ? `, NET ${Math.max(0, Math.round((new Date(invoice.invoice_due_at).getTime() - new Date(invoice.invoiced_at).getTime()) / 86400000))}` : ""}</em></Link>)}</aside>}
    </section>
    <section className="ops-account-people ops-card"><header><h2>Contacts</h2>{operator.role === "owner" && !account.people.some((person) => person.is_regular) && <form action={markAccountRegular}><input type="hidden" name="personId" value={personId} /><button type="submit">Add as regular</button></form>}</header><div>{account.people.map((person) => <article className={person.status === "departed" ? "is-departed" : ""} key={person.id}><strong>{person.display_name || person.emails?.[0] || "Contact"}</strong>{person.company && <span>{person.company}</span>}<small>{person.status === "departed" ? "No longer active" : person.emails?.[0] || person.phones?.[0] || "Contact details still forming"}</small><nav>{person.phones?.[0] && callLeadId && <TrackedCallButton leadId={callLeadId} phone={person.phones[0]} />}{person.phones?.[0] && canText(person.phones[0]) && callLeadId && <Link href={`/ops/leads/${callLeadId}?replyTo=${person.id}&replyChannel=text#spike`}>Text</Link>}{person.emails?.[0] && callLeadId && <Link href={`/ops/leads/${callLeadId}?replyTo=${person.id}&replyChannel=email#spike`}>Email</Link>}</nav></article>)}</div></section>
    <section className="ops-account-tools"><form action={sendUsualPaperwork} className="ops-paperwork-card"><input type="hidden" name="personId" value={paperworkContact?.id ?? ""} /><input type="hidden" name="idempotencyKey" value={paperworkContact ? `manual-paperwork:${paperworkContact.id}:${shopDocuments.map((item) => item.id).join("-")}` : ""} /><h2>Send W-9 &amp; Insurance</h2><p>To {paperworkContact?.display_name || paperworkContact?.emails?.[0] || "an active email contact"}. W-9 {shopDocuments.some((item) => item.kind === "w9" && item.status === "ready") ? "ready" : "not on file"}. Insurance {shopDocuments.some((item) => item.kind === "coi" && item.status === "ready") ? "ready" : "not on file"}{shopDocuments.find((item) => item.kind === "coi")?.expires_at ? `, expires ${new Date(shopDocuments.find((item) => item.kind === "coi")!.expires_at!).toLocaleDateString("en-US")}` : ""}.</p>{paperworkContact ? <PaperworkSubmit /> : <button type="button" disabled>Add an active email first</button>}</form>
      <div className="ops-card"><h2>Saved Details</h2>{account.claims.filter((claim) => claim.predicate !== "quoted_price_cents").length ? <dl>{account.claims.filter((claim) => claim.predicate !== "quoted_price_cents").map((claim) => <div key={claim.id}><dt>{shopClaimLabel(claim.predicate)}</dt><dd>{shopClaimText(claim.value)}</dd></div>)}</dl> : <p>No saved details yet.</p>}</div></section>
    {account.commitments.length > 0 && <section className="ops-job-promises"><header><h2>Open Promises</h2><span>{account.commitments.length} open</span></header><div>{account.commitments.map((item) => <Link className="ops-promise-tag" href={item.lead_id ? `/ops/leads/${item.lead_id}` : "/ops"} key={item.id}><span>Customer promise</span><strong>{item.summary}</strong><time>{item.due_at ? new Date(item.due_at).toLocaleDateString("en-US") : "No date caught"}</time></Link>)}</div></section>}
    <section className="ops-account-jobs"><header className="ops-ticket-rail-head"><div><span>{account.totalJobs} total</span><h2>Jobs</h2></div><form action={`/ops/accounts/${personId}`} method="get" className="ops-account-search"><input name="q" defaultValue={query} placeholder="Search jobs" aria-label="Search jobs" /><select name="year" defaultValue={year ?? ""} aria-label="Filter jobs by year"><option value="">All years</option>{account.years.map((item) => <option value={item} key={item}>{item}</option>)}</select><button type="submit">Search</button></form></header><div className="ops-tickets">{account.leads.map((lead) => <article className="ops-ticket" key={lead.id}><div className="ops-ticket-id"><span>Job #{lead.id}</span><em>{new Date(lead.created_at).toLocaleDateString("en-US")}</em></div><div className="ops-ticket-who"><Link href={`/ops/leads/${lead.id}`}>{lead.service}</Link><span>{lead.first_name} {lead.last_name}</span></div><div className={`ops-stamp-ink is-${lead.status}`}>{shopJobStatusLabel(lead.status)}</div><div className="ops-ticket-actions">{lead.phone && <TrackedCallButton leadId={lead.id} phone={lead.phone} />}<Link href={`/ops/leads/${lead.id}`}>Open</Link></div></article>)}</div>{(page > 1 || account.hasOlder) && <nav className="ops-filters ops-pages">{page > 1 && <Link href={`/ops/accounts/${personId}?page=${page - 1}${query ? `&q=${encodeURIComponent(query)}` : ""}${year ? `&year=${year}` : ""}`}>Newer</Link>}<span>Page {page}</span>{account.hasOlder && <Link href={`/ops/accounts/${personId}?page=${page + 1}${query ? `&q=${encodeURIComponent(query)}` : ""}${year ? `&year=${year}` : ""}`}>Older</Link>}</nav>}</section>
  </main>
}
