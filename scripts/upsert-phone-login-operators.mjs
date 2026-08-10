import { existsSync, readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

function envValue(name) {
  if (process.env[name]?.trim()) return process.env[name].trim()
  if (!existsSync(".env.local")) return ""
  return readFileSync(".env.local", "utf8").match(new RegExp(`^${name}="?([^"\\r\\n]+)`, "m"))?.[1] ?? ""
}

const databaseUrl = envValue("DATABASE_URL")
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.")
const sql = neon(databaseUrl)
const ownerEmail = (envValue("OPS_LOGIN_EMAIL") || envValue("QUOTE_TO_EMAIL") || "sales@musiccityspecialtywelding.com").toLowerCase()
const people = [
  { email: ownerEmail, name: "Philippe Auguste", phone: "+16158104910", role: "owner" },
  { email: "tj.harahan@phone.mcsw.invalid", name: "TJ Harahan", phone: "+16155468197", role: "owner" },
]

for (const person of people) {
  const conflicts = await sql`
    SELECT id, name FROM operators
    WHERE active = true AND cell_phone = ${person.phone}::text AND lower(email) <> lower(${person.email}::text)`
  if (conflicts[0]) throw new Error(`${person.phone.slice(-4)} already belongs to ${conflicts[0].name}.`)
}

for (const person of people) {
  await sql`
    INSERT INTO operators (email, name, role, cell_phone, active)
    VALUES (${person.email}::text, ${person.name}::text, ${person.role}::text, ${person.phone}::text, true)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      cell_phone = EXCLUDED.cell_phone,
      active = true`
  console.log(`${person.name}: active ${person.role}, phone ending ${person.phone.slice(-4)}`)
}
