import { existsSync, readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

function databaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim()
  if (existsSync(".env.local")) {
    const match = readFileSync(".env.local", "utf8").match(/^DATABASE_URL="?([^"\r\n]+)/m)
    if (match) return match[1]
  }
  throw new Error("DATABASE_URL not found")
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return ""
}

function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ""
}

function accountKey(id, company, emails) {
  const normalizedCompany = String(company ?? "").toLowerCase().replace(/\b(?:incorporated|corporation|company|limited|inc|corp|llc|ltd|co)\b/g, "").replace(/[^a-z0-9]/g, "")
  if (normalizedCompany) return `company:${normalizedCompany}`
  const consumer = new Set(["gmail.com", "googlemail.com", "icloud.com", "outlook.com", "hotmail.com", "yahoo.com", "aol.com"])
  const domain = emails.map((email) => email.split("@")[1]).find((item) => item && !consumer.has(item))
  return domain ? `domain:${domain}` : `person:${id}`
}

const reserved = new Set([
  "+16158104910",
  normalizePhone(process.env.TWILIO_PHONE_NUMBER),
  normalizePhone(process.env.OWNER_CELL_PHONE),
].filter(Boolean))
const sql = neon(databaseUrl())
const leadPhones = await sql`SELECT id, phone FROM leads WHERE phone <> ''::text`
const placeholderLeadIds = leadPhones
  .filter((lead) => reserved.has(normalizePhone(lead.phone)))
  .map((lead) => Number(lead.id))
if (placeholderLeadIds.length) {
  // Preserve every original value. The marker prevents routing actions without
  // erasing historical intake data.
  await sql`
    INSERT INTO events (kind, actor_type, lead_id, external_id, body, crew_body, detail)
    SELECT 'system.data-correction'::text, 'system'::text, l.id,
      ('reserved-phone-marked:' || l.id::text)::text,
      'Shop routing number marked as a non-customer contact'::text,
      'Customer phone still needs to be caught'::text,
      jsonb_build_object('reason', 'reserved shop/forwarding number', 'original_phone', l.phone)
    FROM leads l WHERE l.id = ANY(${placeholderLeadIds}::bigint[])
    ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING`
  await sql`
    UPDATE leads SET phone_is_placeholder = true, updated_at = now()
    WHERE id = ANY(${placeholderLeadIds}::bigint[])`
}
const people = await sql`
  SELECT p.id, p.is_test, p.phones,
    jsonb_agg(jsonb_build_object(
      'id', l.id, 'first_name', l.first_name, 'last_name', l.last_name,
      'email', l.email, 'phone', l.phone, 'created_at', l.created_at
    ) ORDER BY l.created_at, l.id) FILTER (WHERE l.id IS NOT NULL) AS leads
  FROM people p
  JOIN leads l ON l.person_id = p.id
  WHERE p.merged_into IS NULL
  GROUP BY p.id
  ORDER BY p.id`

let splitPeople = 0
let movedLeads = 0
for (const person of people) {
  const leads = Array.isArray(person.leads) ? person.leads : []
  const contaminated = (person.phones ?? []).some((phone) => reserved.has(normalizePhone(phone))) ||
    leads.some((lead) => reserved.has(normalizePhone(lead.phone)))
  if (!contaminated || leads.length < 2) continue

  // Email is the strongest remaining identifier. Without one, stay
  // conservative: each lead gets its own customer instead of a false merge.
  const buckets = new Map()
  for (const lead of leads) {
    const email = normalizeEmail(lead.email)
    const key = email ? `email:${email}` : `lead:${lead.id}`
    const bucket = buckets.get(key) ?? []
    bucket.push(lead)
    buckets.set(key, bucket)
  }
  if (buckets.size < 2) {
    const safePhones = (person.phones ?? []).filter((phone) => !reserved.has(normalizePhone(phone)))
    await sql`UPDATE people SET phones = ${safePhones}::text[] WHERE id = ${person.id}::bigint`
    continue
  }

  let first = true
  for (const bucket of buckets.values()) {
    const lead = bucket[0]
    const email = normalizeEmail(lead.email)
    const validPhone = reserved.has(normalizePhone(lead.phone)) ? "" : normalizePhone(lead.phone)
    let personId
    if (first) {
      const displayName = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim()
      await sql`
        UPDATE people SET
          display_name = ${displayName}::text,
          phones = ${validPhone ? [validPhone] : []}::text[],
          emails = ${email ? [email] : []}::text[],
          account_key = ${accountKey(Number(person.id), "", email ? [email] : [])}::text
        WHERE id = ${person.id}::bigint`
      personId = person.id
      first = false
    } else {
      const inserted = await sql`
        INSERT INTO people (display_name, phones, emails, is_test)
        VALUES (
          ${`${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim()}::text,
          ${validPhone ? [validPhone] : []}::text[],
          ${email ? [email] : []}::text[],
          ${Boolean(person.is_test)}::boolean
        ) RETURNING id`
      personId = inserted[0].id
      await sql`UPDATE people SET account_key = ${accountKey(Number(personId), "", email ? [email] : [])}::text WHERE id = ${personId}::bigint`
      splitPeople += 1
    }
    const leadIds = bucket.map((item) => Number(item.id))
    await sql`
      UPDATE leads SET person_id = ${personId}::bigint, updated_at = now()
      WHERE id = ANY(${leadIds}::bigint[])
        AND person_id = ${person.id}::bigint
        AND is_test = ${Boolean(person.is_test)}::boolean`
    movedLeads += leadIds.length
  }
}

console.log(`Placeholder reconciliation complete. Marked ${placeholderLeadIds.length} reserved lead phone(s); created ${splitPeople} customer record(s); reconciled ${movedLeads} lead(s).`)
