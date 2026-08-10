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

const reservedPhones = new Set([
  "+16158104910",
  normalizePhone(process.env.TWILIO_PHONE_NUMBER),
  normalizePhone(process.env.OWNER_CELL_PHONE),
].filter(Boolean))

const sql = neon(databaseUrl())
const leads = await sql`
  SELECT id, first_name, last_name, phone, email, is_test
  FROM leads WHERE person_id IS NULL ORDER BY id`

let attached = 0
for (const lead of leads) {
  const normalizedPhone = normalizePhone(lead.phone)
  const phone = reservedPhones.has(normalizedPhone) ? "" : normalizedPhone
  const email = String(lead.email ?? "").trim().toLowerCase()
  if (!phone && !email) continue
  const existing = await sql`
    SELECT id FROM people
    WHERE merged_into IS NULL
      AND is_test = ${Boolean(lead.is_test)}::boolean
      AND (
      (${phone}::text <> '' AND ${phone}::text = ANY(phones)) OR
      (${email}::text <> '' AND ${email}::text = ANY(emails))
    ) ORDER BY id LIMIT 1`
  let personId = existing[0]?.id
  if (!personId) {
    const inserted = await sql`
      INSERT INTO people (display_name, phones, emails, is_test)
      VALUES (
        ${`${lead.first_name} ${lead.last_name}`.trim()}::text,
        ${phone ? [phone] : []}::text[],
        ${email ? [email] : []}::text[],
        ${Boolean(lead.is_test)}::boolean
      ) RETURNING id`
    personId = inserted[0].id
  }
  await sql`
    UPDATE leads l SET person_id = p.id
    FROM people p
    WHERE l.id = ${lead.id}::bigint
      AND p.id = ${personId}::bigint
      AND l.person_id IS NULL
      AND l.is_test = p.is_test`
  attached += 1
}

console.log(`People backfill complete. Attached ${attached} lead(s).`)
