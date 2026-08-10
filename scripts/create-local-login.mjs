// Local visual-QA helper. Creates a normal one-use 15-minute owner login link.
import { createHash, randomBytes } from "node:crypto"
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
const owners = await sql`SELECT id, email FROM operators WHERE role = 'owner' AND active = true ORDER BY created_at ASC LIMIT 1`
if (!owners[0]) throw new Error("No active owner exists.")
const token = randomBytes(32).toString("hex")
const hash = createHash("sha256").update(token).digest("hex")
await sql`
  INSERT INTO ops_tokens (token_hash, purpose, email, operator_id, expires_at)
  VALUES (${hash}::text, 'login'::text, ${owners[0].email}::text, ${owners[0].id}::bigint, now() + interval '15 minutes')`
console.log(`http://localhost:3030/api/ops/verify?token=${token}`)
