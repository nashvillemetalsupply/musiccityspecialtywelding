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

function deriveAccountKey(input) {
  const consumer = new Set(["gmail.com", "googlemail.com", "icloud.com", "me.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "aol.com", "proton.me", "protonmail.com"])
  const domain = (input.emails ?? []).map((email) => email.split("@")[1]?.toLowerCase()).find((item) => item && !consumer.has(item))
  if (domain) return `domain:${domain}`
  const company = String(input.company ?? "").toLowerCase().replace(/\b(?:incorporated|corporation|company|limited|inc|corp|llc|ltd|co)\b/g, "").replace(/[^a-z0-9]/g, "")
  return company ? `company:${company}` : `person:${input.id}`
}

const sql = neon(databaseUrl())
const people = await sql`SELECT id, company, emails FROM people WHERE merged_into IS NULL ORDER BY id`
let changed = 0
for (const person of people) {
  const key = deriveAccountKey({ id: Number(person.id), company: person.company, emails: person.emails })
  const rows = await sql`
    UPDATE people SET account_key = ${key}::text
    WHERE id = ${person.id}::bigint AND account_key IS DISTINCT FROM ${key}::text
    RETURNING id`
  changed += rows.length
}
await sql`
  UPDATE people company_only SET account_key = domain_contact.account_key
  FROM LATERAL (
    SELECT p2.account_key FROM people p2
    WHERE p2.company_key = company_only.company_key AND p2.company_key <> ''
      AND p2.account_key LIKE 'domain:%' AND p2.merged_into IS NULL
    ORDER BY p2.id LIMIT 1
  ) domain_contact
  WHERE company_only.company_key <> '' AND company_only.account_key LIKE 'company:%'`
console.log(`Account-key backfill complete. Updated ${changed} customer record(s).`)
