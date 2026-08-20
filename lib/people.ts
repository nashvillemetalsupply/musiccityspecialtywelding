import { getSql } from "@/lib/db"
import { FALLBACK_SHOP_PHONE_E164 } from "@/lib/shop-phone-shared"
import { deriveAccountKey, normalizeCompanyKey } from "@/lib/account-key"
import { isReservedCustomerPhone, normalizeUsPhone } from "@/lib/shop-brain-invariants.mjs"
import { recordEvent } from "@/lib/events"
import { notifyAll } from "@/lib/notify"

export type PersonRow = {
  id: number
  created_at: string
  display_name: string
  company: string
  phones: string[]
  emails: string[]
  merged_into: number | null
  status: "active" | "departed"
  is_test: boolean
  is_regular: boolean
  account_key: string
  company_key: string
}

export function normalizePhone(value: string): string {
  return normalizeUsPhone(value)
}

// A public tracking number or the owner's forwarding cell is routing
// infrastructure, never a customer identity. Old quote forms sometimes used
// the shop number as a placeholder; matching on it can fuse unrelated jobs.
export function isReservedShopPhone(value: string): boolean {
  const configured = [
    FALLBACK_SHOP_PHONE_E164,
    process.env.TWILIO_PHONE_NUMBER ?? "",
    process.env.OWNER_CELL_PHONE ?? "",
  ]
  return isReservedCustomerPhone(value, configured)
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ""
}

export async function fileIdentityConflict(input: { phone: string; email: string; isTest: boolean; personIds: number[]; leadId?: number }) {
  const sql = getSql()
  const conflicts = (await sql`
    INSERT INTO person_identity_conflicts (phone, email, is_test, person_ids, lead_id)
    VALUES (${input.phone}::text, ${input.email}::text, ${input.isTest}::boolean, ${input.personIds}::bigint[], ${input.leadId ?? null}::bigint)
    ON CONFLICT (phone, email, is_test) WHERE status = 'open' DO UPDATE
      SET person_ids = EXCLUDED.person_ids, lead_id = COALESCE(person_identity_conflicts.lead_id, EXCLUDED.lead_id)
    RETURNING id, lead_id`) as { id: number; lead_id: number | null }[]
  const conflictId = Number(conflicts[0]?.id)
  const leadId = Number(conflicts[0]?.lead_id ?? input.leadId) || null
  const externalId = `identity-conflict:${conflictId}`
  const eventId = await recordEvent({
    kind: "identity.conflict",
    actorType: "system",
    externalId,
    leadId,
    body: "Two customer identities disagree. Intake was preserved without merging them.",
    detail: { phone: input.phone || null, email: input.email || null, personIds: input.personIds },
  })
  if (eventId && !input.isTest) await notifyAll({
    priority: "digest",
    stock: "red",
    title: "Two customer records disagree",
    body: "The new work is safe and unmerged. Pick the right customer.",
    url: leadId ? `/ops/leads/${leadId}#identity-jig` : `/board?q=${encodeURIComponent(input.phone || input.email)}`,
    sourceEventId: eventId,
    ownerOnly: true,
    dedupeKey: externalId,
  })
}

export async function findOrCreatePerson(input: {
  phone?: string
  email?: string
  displayName?: string
  company?: string
  isTest?: boolean
  leadId?: number
}): Promise<PersonRow | null> {
  const sql = getSql()
  const normalizedPhone = normalizePhone(input.phone ?? "")
  const phone = isReservedShopPhone(normalizedPhone) ? "" : normalizedPhone
  const email = normalizeEmail(input.email ?? "")
  if (!phone && !email) return null

  const existing = (await sql`
    WITH matches AS (
      SELECT i.person_id AS id FROM person_identities i
      WHERE i.is_test = ${input.isTest ?? false}::boolean
        AND ((i.kind = 'phone' AND i.value = ${phone}::text AND ${phone}::text <> '')
          OR (i.kind = 'email' AND i.value = ${email}::text AND ${email}::text <> ''))
      UNION
      SELECT p2.id FROM people p2
      WHERE p2.merged_into IS NULL AND p2.is_test = ${input.isTest ?? false}::boolean
        AND ((${phone}::text <> '' AND ${phone}::text = ANY(p2.phones))
          OR (${email}::text <> '' AND ${email}::text = ANY(p2.emails)))
    )
    SELECT p.* FROM matches m JOIN people p ON p.id = m.id
    WHERE p.merged_into IS NULL
    ORDER BY p.created_at ASC LIMIT 3`) as PersonRow[]

  if (existing.length > 1) {
    await fileIdentityConflict({ phone, email, isTest: input.isTest ?? false, personIds: existing.map((person) => Number(person.id)), leadId: input.leadId })
    return null
  }

  if (existing[0]) {
    const person = existing[0]
    const phones = phone && !person.phones.includes(phone) ? [...person.phones, phone] : person.phones
    const emails = email && !person.emails.includes(email) ? [...person.emails, email] : person.emails
    const company = input.company?.trim() || person.company
    const companyKey = normalizeCompanyKey(company)
    let accountKey = deriveAccountKey({ id: person.id, company, emails })
    if (companyKey && accountKey.startsWith("company:")) {
      const aliases = (await sql`SELECT account_key FROM people WHERE company_key = ${companyKey}::text AND account_key LIKE 'domain:%' AND merged_into IS NULL ORDER BY id LIMIT 1`) as { account_key: string }[]
      if (aliases[0]) accountKey = aliases[0].account_key
    }
    const rows = (await sql`
      UPDATE people SET
        phones = ${phones}::text[],
        emails = ${emails}::text[],
        display_name = CASE WHEN display_name = '' THEN ${input.displayName?.trim() ?? ""}::text ELSE display_name END,
        company = CASE WHEN company = '' THEN ${input.company?.trim() ?? ""}::text ELSE company END,
        company_key = ${companyKey}::text,
        account_key = ${accountKey}::text
      WHERE id = ${person.id}::bigint
      RETURNING *`) as PersonRow[]
    if (phone) await sql`INSERT INTO person_identities (kind, value, is_test, person_id) VALUES ('phone', ${phone}::text, ${input.isTest ?? false}::boolean, ${person.id}::bigint) ON CONFLICT (kind, value, is_test) DO NOTHING`
    if (email) await sql`INSERT INTO person_identities (kind, value, is_test, person_id) VALUES ('email', ${email}::text, ${input.isTest ?? false}::boolean, ${person.id}::bigint) ON CONFLICT (kind, value, is_test) DO NOTHING`
    return rows[0]
  }

  const rows = (await sql`
    INSERT INTO people (display_name, company, company_key, phones, emails, is_test)
    VALUES (
      ${input.displayName?.trim() ?? ""}::text,
      ${input.company?.trim() ?? ""}::text,
      ${normalizeCompanyKey(input.company?.trim() ?? "")}::text,
      ${phone ? [phone] : []}::text[],
      ${email ? [email] : []}::text[],
      ${input.isTest ?? false}::boolean
    ) RETURNING *`) as PersonRow[]
  if (!rows[0]) return null
  const freshId = Number(rows[0].id)
  const claimedPersonIds = new Set<number>()
  for (const [kind, value] of [["phone", phone], ["email", email]] as const) {
    if (!value) continue
    const claimed = (await sql`
      INSERT INTO person_identities (kind, value, is_test, person_id)
      VALUES (${kind}::text, ${value}::text, ${input.isTest ?? false}::boolean, ${freshId}::bigint)
      ON CONFLICT (kind, value, is_test) DO NOTHING
      RETURNING person_id`) as { person_id: number }[]
    const mapped = claimed[0] ? claimed : (await sql`
      SELECT person_id FROM person_identities
      WHERE kind = ${kind}::text AND value = ${value}::text
        AND is_test = ${input.isTest ?? false}::boolean LIMIT 1`) as { person_id: number }[]
    if (mapped[0]) claimedPersonIds.add(Number(mapped[0].person_id))
  }
  const priorWinners = [...claimedPersonIds].filter((personId) => personId !== freshId)
  if (new Set(priorWinners).size > 1) {
    await fileIdentityConflict({ phone, email, isTest: input.isTest ?? false, personIds: [...claimedPersonIds], leadId: input.leadId })
    return null
  }
  const winnerId = priorWinners[0] ?? freshId
  if (winnerId !== freshId) {
    await sql`UPDATE people SET merged_into = ${winnerId}::bigint WHERE id = ${freshId}::bigint AND merged_into IS NULL`
    await sql`UPDATE person_identities SET person_id = ${winnerId}::bigint WHERE person_id = ${freshId}::bigint`
  }
  const winner = winnerId === Number(rows[0].id) ? rows[0] : (await sql`SELECT * FROM people WHERE id = ${winnerId}::bigint LIMIT 1`) as PersonRow[]
  const person = Array.isArray(winner) ? winner[0] : winner
  if (!person) return null
  const mergedPhones = phone && !person.phones.includes(phone) ? [...person.phones, phone] : person.phones
  const mergedEmails = email && !person.emails.includes(email) ? [...person.emails, email] : person.emails
  const accountKey = deriveAccountKey({ id: person.id, company: person.company, emails: mergedEmails })
  const keyed = (await sql`
    UPDATE people SET account_key = ${accountKey}::text, company_key = ${normalizeCompanyKey(person.company || input.company?.trim() || "")}::text, phones = ${mergedPhones}::text[], emails = ${mergedEmails}::text[],
      display_name = CASE WHEN display_name = '' THEN ${input.displayName?.trim() ?? ""}::text ELSE display_name END,
      company = CASE WHEN company = '' THEN ${input.company?.trim() ?? ""}::text ELSE company END
    WHERE id = ${winnerId}::bigint RETURNING *`) as PersonRow[]
  return keyed[0] ?? person
}

export async function refreshPersonAccountKey(personId: number) {
  const person = await getPerson(personId)
  if (!person) return
  const sql = getSql()
  const companyKey = normalizeCompanyKey(person.company)
  let accountKey = deriveAccountKey(person)
  if (companyKey && accountKey.startsWith("company:")) {
    const aliases = (await sql`SELECT account_key FROM people WHERE company_key = ${companyKey}::text AND account_key LIKE 'domain:%' AND merged_into IS NULL ORDER BY id LIMIT 1`) as { account_key: string }[]
    if (aliases[0]) accountKey = aliases[0].account_key
  }
  await sql`UPDATE people SET account_key = ${accountKey}::text, company_key = ${companyKey}::text WHERE id = ${personId}::bigint`
  if (companyKey && accountKey.startsWith("domain:")) await sql`
    UPDATE people SET account_key = ${accountKey}::text
    WHERE company_key = ${companyKey}::text AND merged_into IS NULL
      AND account_key IS DISTINCT FROM ${accountKey}::text`
}

export async function attachLeadToPerson(leadId: number, personId: number) {
  const sql = getSql()
  await sql`
    UPDATE leads l SET person_id = p.id, updated_at = now()
    FROM people p
    WHERE l.id = ${leadId}::bigint
      AND p.id = ${personId}::bigint
      AND l.person_id IS NULL
      AND l.is_test = p.is_test`
}

export async function getPerson(id: number): Promise<PersonRow | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT * FROM people WHERE id = ${id}::bigint AND merged_into IS NULL LIMIT 1`) as PersonRow[]
  return rows[0] ?? null
}

export async function findPersonByEmail(value: string, isTest = false): Promise<PersonRow | null> {
  const email = normalizeEmail(value)
  if (!email) return null
  const sql = getSql()
  const rows = (await sql`
    SELECT p.* FROM person_identities i
    JOIN people p ON p.id = i.person_id
    WHERE i.kind = 'email' AND i.value = ${email}::text
      AND i.is_test = ${isTest}::boolean
      AND p.is_test = ${isTest}::boolean
      AND p.merged_into IS NULL
    ORDER BY p.created_at ASC LIMIT 1`) as PersonRow[]
  if (rows[0]) return rows[0]
  const fallback = (await sql`
    SELECT * FROM people
    WHERE ${email}::text = ANY(emails)
      AND is_test = ${isTest}::boolean
      AND merged_into IS NULL
    ORDER BY created_at ASC LIMIT 1`) as PersonRow[]
  return fallback[0] ?? null
}

export async function findPersonByPhone(value: string, isTest = false): Promise<PersonRow | null> {
  const phone = normalizePhone(value)
  if (!phone || isReservedShopPhone(phone)) return null
  const sql = getSql()
  const rows = (await sql`
    SELECT p.* FROM person_identities i
    JOIN people p ON p.id = i.person_id
    WHERE i.kind = 'phone' AND i.value = ${phone}::text
      AND i.is_test = ${isTest}::boolean
      AND p.is_test = ${isTest}::boolean
      AND p.merged_into IS NULL
    ORDER BY p.created_at ASC LIMIT 1`) as PersonRow[]
  if (rows[0]) return rows[0]
  const fallback = (await sql`
    SELECT * FROM people
    WHERE ${phone}::text = ANY(phones)
      AND is_test = ${isTest}::boolean
      AND merged_into IS NULL
    ORDER BY created_at ASC LIMIT 1`) as PersonRow[]
  return fallback[0] ?? null
}

export async function findRecentOpenLeadForPerson(personId: number, isTest = false) {
  const sql = getSql()
  const rows = (await sql`
    SELECT id FROM leads
    WHERE person_id = ${personId}::bigint
      AND is_test = ${isTest}::boolean
      AND (status = ANY(ARRAY['new','contacted','qualified','quoted']::text[]) OR (status = 'won' AND completed_at IS NULL))
      AND updated_at > now() - interval '90 days'
    ORDER BY updated_at DESC LIMIT 1`) as { id: number }[]
  return rows[0] ? Number(rows[0].id) : null
}

export async function getPersonJobCount(personId: number): Promise<number> {
  const sql = getSql()
  const rows = (await sql`
    SELECT count(*)::int AS count FROM leads WHERE person_id = ${personId}::bigint`) as { count: number }[]
  return Number(rows[0]?.count ?? 0)
}
