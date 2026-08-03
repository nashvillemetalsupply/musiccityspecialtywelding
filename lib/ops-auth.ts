import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { getSql } from "@/lib/db"

export const OPS_SESSION_COOKIE = "mcw_ops_session"
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function getOwnerEmail(): string {
  return (
    process.env.OPS_LOGIN_EMAIL?.trim() ||
    process.env.QUOTE_TO_EMAIL?.trim() ||
    ""
  )
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export const CANONICAL_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://musiccityspecialtywelding.com"

// Constant-time bearer-secret comparison for cron/automation routes.
export function safeSecretMatch(candidate: string, expected: string) {
  const a = createHash("sha256").update(candidate).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  const header = req.headers.get("authorization") ?? ""
  return safeSecretMatch(header, `Bearer ${secret}`)
}

export function safeEmailMatch(candidate: string, expected: string) {
  const a = Buffer.from(candidate.trim().toLowerCase())
  const b = Buffer.from(expected.trim().toLowerCase())
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function createLoginToken(email: string): Promise<string> {
  const sql = getSql()
  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MS).toISOString()
  await sql`DELETE FROM ops_tokens WHERE expires_at < now()`
  await sql`
    INSERT INTO ops_tokens (token_hash, purpose, email, expires_at)
    VALUES (${hashToken(token)}, 'login', ${email}, ${expiresAt})`
  return token
}

export async function redeemLoginToken(token: string): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const sql = getSql()
  const rows = (await sql`
    UPDATE ops_tokens SET used_at = now()
    WHERE token_hash = ${hashToken(token)} AND purpose = 'login'
      AND used_at IS NULL AND expires_at > now()
    RETURNING email`) as { email: string }[]
  if (!rows.length) return null

  const sessionToken = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  await sql`
    INSERT INTO ops_tokens (token_hash, purpose, email, expires_at)
    VALUES (${hashToken(sessionToken)}, 'session', ${rows[0].email}, ${expiresAt})`
  return sessionToken
}

export async function validateSessionToken(token: string | undefined): Promise<string | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  try {
    const sql = getSql()
    const rows = (await sql`
      SELECT email FROM ops_tokens
      WHERE token_hash = ${hashToken(token)} AND purpose = 'session'
        AND expires_at > now()
      LIMIT 1`) as { email: string }[]
    return rows.length ? rows[0].email : null
  } catch {
    return null
  }
}

export async function destroySession(token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return
  const sql = getSql()
  await sql`DELETE FROM ops_tokens WHERE token_hash = ${hashToken(token)}`
}

export async function getAuthenticatedOperator(): Promise<string | null> {
  const cookieStore = await cookies()
  return validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
}
