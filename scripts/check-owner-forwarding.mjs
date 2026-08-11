import { existsSync, readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

function databaseUrl() {
  if (process.env.DATABASE_URL_UNPOOLED?.trim()) return process.env.DATABASE_URL_UNPOOLED.trim()
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim()
  if (!existsSync(".env.local")) return ""
  const env = readFileSync(".env.local", "utf8")
  return env.match(/^DATABASE_URL_UNPOOLED="?([^"\r\n]+)/m)?.[1] ?? env.match(/^DATABASE_URL="?([^"\r\n]+)/m)?.[1] ?? ""
}

function normalize(value) {
  const digits = String(value ?? "").replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return ""
}

const url = databaseUrl()
if (!url) throw new Error("Database URL is unavailable.")
const sql = neon(url)
const rows = await sql`
  SELECT cell_phone
  FROM operators
  WHERE active = true AND role = 'owner'
  ORDER BY id ASC
  LIMIT 2`
const phones = rows.map((row) => normalize(row.cell_phone)).filter(Boolean)
const unique = [...new Set(phones)]
const phone = unique.length === 1 ? unique[0] : ""
console.log(JSON.stringify({
  exactlyOneOwnerForwardingNumber: Boolean(phone),
  masked: phone ? `(***) ***-${phone.slice(-4)}` : "",
  equalsCurrentPublicShopNumber: phone === "+16158104910",
}, null, 2))
if (!phone) process.exitCode = 1
