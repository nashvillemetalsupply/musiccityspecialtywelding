import { projectClaimForRole, projectCommitmentForRole } from "@/lib/visibility"
import { getSql } from "@/lib/db"
import type { CommitmentRow } from "@/lib/commitments"
import type { LeadRow } from "@/lib/leads"
import type { OperatorRole } from "@/lib/operators"
import { isReservedShopPhone, type PersonRow } from "@/lib/people"
import { deriveAccountKey } from "@/lib/account-key"
import { projectLeadForRole } from "@/lib/ops-data"
import { clampPageToTotal, normalizePage } from "@/lib/pagination"

export function accountKeyForPerson(person: Pick<PersonRow, "id" | "company" | "emails">) {
  return deriveAccountKey(person)
}

export async function getAccount(personId: number, role: OperatorRole, options: { page?: number; query?: string; year?: number | null } = {}) {
  const sql = getSql()
  const targets = (await sql`
    SELECT * FROM people
    WHERE id = ${personId}::bigint AND merged_into IS NULL AND is_test = false
    LIMIT 1`) as PersonRow[]
  const target = targets[0]
  if (!target) return null
  let key = target.account_key || accountKeyForPerson(target)
  if (target.company_key) {
    const aliases = (await sql`SELECT account_key FROM people WHERE company_key = ${target.company_key}::text AND account_key LIKE 'domain:%' AND merged_into IS NULL ORDER BY id LIMIT 1`) as { account_key: string }[]
    if (aliases[0]) key = aliases[0].account_key
    await sql`UPDATE people SET account_key = ${key}::text WHERE company_key = ${target.company_key}::text AND merged_into IS NULL AND account_key IS DISTINCT FROM ${key}::text`
  } else if (!target.account_key) await sql`UPDATE people SET account_key = ${key}::text WHERE id = ${personId}::bigint`
  const people = (await sql`
    SELECT * FROM people
    WHERE account_key = ${key}::text AND merged_into IS NULL AND is_test = false
    ORDER BY status ASC, created_at ASC`) as PersonRow[]
  const personIds = people.map((person) => Number(person.id))
  const primary = people.find((person) => person.company) ?? target
  const requestedPage = normalizePage(options.page)
  const query = options.query?.trim().slice(0, 100) ?? ""
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`
  const year = options.year && options.year >= 2000 && options.year <= 2200 ? options.year : null
  const counts = (await sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE
        (${year}::int IS NULL OR EXTRACT(YEAR FROM l.created_at)::int = ${year}::int)
        AND (${query}::text = '' OR l.first_name ILIKE ${pattern}::text OR l.last_name ILIKE ${pattern}::text
          OR l.service ILIKE ${pattern}::text OR l.public_id ILIKE ${pattern}::text
          OR (CASE WHEN ${role}::text = 'owner' THEN l.notes ELSE COALESCE(l.crew_notes, '') END) ILIKE ${pattern}::text)
      )::int AS filtered_total
    FROM leads l
    WHERE l.person_id = ANY(${personIds}::bigint[]) AND l.is_test = false`) as { total: number; filtered_total: number }[]
  const filteredTotal = Number(counts[0]?.filtered_total ?? 0)
  const page = clampPageToTotal(requestedPage, filteredTotal, 16)
  const offset = (page - 1) * 16
  const leads = (await sql`
    SELECT l.*, COALESCE(o.name, '') AS assigned_operator_name
    FROM leads l
    LEFT JOIN operators o ON o.id = l.assigned_operator_id
    WHERE l.person_id = ANY(${personIds}::bigint[]) AND l.is_test = false
      AND (${year}::int IS NULL OR EXTRACT(YEAR FROM l.created_at)::int = ${year}::int)
      AND (${query}::text = '' OR l.first_name ILIKE ${pattern}::text OR l.last_name ILIKE ${pattern}::text
        OR l.service ILIKE ${pattern}::text OR l.public_id ILIKE ${pattern}::text
        OR (CASE WHEN ${role}::text = 'owner' THEN l.notes ELSE COALESCE(l.crew_notes, '') END) ILIKE ${pattern}::text)
    ORDER BY l.created_at DESC LIMIT 17 OFFSET ${offset}::bigint`) as LeadRow[]
  const hasOlder = leads.length > 16
  if (hasOlder) leads.pop()
  const safeLeads = leads.map((lead) => projectLeadForRole(lead, role))
  const totals = role === "owner" ? (await sql`
    SELECT COALESCE(sum(COALESCE(paid_amount_cents, revenue_cents)), 0)::bigint AS year_total,
      count(*) FILTER (WHERE invoiced_at IS NOT NULL AND paid_at IS NULL)::int AS open_invoices
    FROM leads WHERE person_id = ANY(${personIds}::bigint[]) AND is_test = false
      AND created_at >= date_trunc('year', now())`) as { year_total: number; open_invoices: number }[] : []
  const openInvoiceRows = role === "owner" ? (await sql`
    SELECT id, invoice_number, invoice_due_at, invoiced_at,
      COALESCE(invoice_total_cents, revenue_cents, estimate_value_cents) AS amount_cents
    FROM leads WHERE person_id = ANY(${personIds}::bigint[]) AND is_test = false
      AND invoiced_at IS NOT NULL AND paid_at IS NULL
    ORDER BY invoice_due_at ASC NULLS LAST LIMIT 30`) as { id: number; invoice_number: string; invoice_due_at: string | null; invoiced_at: string; amount_cents: number | null }[] : []
  const years = (await sql`
    SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int AS year FROM leads
    WHERE person_id = ANY(${personIds}::bigint[]) AND is_test = false
    ORDER BY year DESC`) as { year: number }[]
  const rawClaims = (await sql`
    SELECT * FROM claims WHERE subject_type = 'person' AND subject_id = ANY(${personIds}::bigint[])
      AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 100`) as Array<{ id: number; subject_id: number; predicate: string; value: unknown; confidence: number; source_event_id: number }>
  const rawCommitments = (await sql`
    SELECT c.* FROM commitments c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.status = 'open'
      AND (c.person_id = ANY(${personIds}::bigint[]) OR l.person_id = ANY(${personIds}::bigint[]))
      AND (l.is_test = false OR l.id IS NULL)
    ORDER BY c.due_at ASC NULLS LAST LIMIT 100`) as CommitmentRow[]
  const safePeople = people.map((person) => ({
    ...person,
    phones: person.phones.filter((phone) => !isReservedShopPhone(phone)),
  }))
  for (const lead of safeLeads) {
    if (lead.phone_is_placeholder || isReservedShopPhone(lead.phone)) lead.phone = ""
  }
  const safePrimary = safePeople.find((person) => Number(person.id) === Number(primary.id)) ?? safePeople[0] ?? primary
  return {
    person: safePrimary,
    people: safePeople,
    leads: safeLeads,
    claims: rawClaims.map((claim) => projectClaimForRole(claim, role)).filter((claim): claim is NonNullable<typeof claim> => Boolean(claim)),
    commitments: rawCommitments.map((item) => projectCommitmentForRole(item, role)),
    yearTotal: Number(totals[0]?.year_total ?? 0),
    openInvoices: Number(totals[0]?.open_invoices ?? 0),
    accountKey: key,
    page,
    hasOlder,
    totalJobs: Number(counts[0]?.total ?? 0),
    years: years.map((item) => Number(item.year)),
    openInvoiceRows,
  }
}
