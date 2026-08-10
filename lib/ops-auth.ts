import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { getSql } from "@/lib/db"
import type { Operator } from "@/lib/operators"

export const OPS_SESSION_COOKIE = "mcw_ops_session"
export const OPS_SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000
const SMS_CODE_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = OPS_SESSION_MAX_AGE_SECONDS * 1000

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

function hashSmsLoginCode(phone: string, code: string) {
  const secret = process.env.OPS_PUNCH_SECRET?.trim() ?? ""
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("OPS_PUNCH_SECRET must contain at least 32 bytes before SMS sign-in can be used.")
  return createHmac("sha256", secret).update(`sms-login:${phone}:${code}`).digest("hex")
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
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) return false
  const header = req.headers.get("authorization") ?? ""
  return safeSecretMatch(header, `Bearer ${secret}`)
}

export function safeEmailMatch(candidate: string, expected: string) {
  const a = Buffer.from(candidate.trim().toLowerCase())
  const b = Buffer.from(expected.trim().toLowerCase())
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function createLoginToken(operator: Operator): Promise<string> {
  const sql = getSql()
  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MS).toISOString()
  await sql`DELETE FROM ops_tokens WHERE expires_at < now()`
  await sql`
    INSERT INTO ops_tokens (token_hash, purpose, email, operator_id, expires_at)
    VALUES (
      ${hashToken(token)}::text, 'login'::text, ${operator.email}::text,
      ${operator.id}::bigint, ${expiresAt}::timestamptz
    )`
  return token
}

async function createSession(operatorId: number, email: string): Promise<string> {
  const sql = getSql()
  const sessionToken = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  await sql`
    INSERT INTO ops_tokens (token_hash, purpose, email, operator_id, expires_at)
    VALUES (
      ${hashToken(sessionToken)}::text, 'session'::text, ${email}::text,
      ${operatorId}::bigint, ${expiresAt}::timestamptz
    )`
  return sessionToken
}

export async function createSmsVerificationIntent(operator: Operator) {
  const sql = getSql()
  const expiresAt = new Date(Date.now() + SMS_CODE_TTL_MS).toISOString()
  await sql`DELETE FROM ops_tokens WHERE expires_at < now()`
  await sql`DELETE FROM ops_tokens WHERE purpose = 'sms-verify-login' AND operator_id = ${operator.id}::bigint`
  await sql`
    INSERT INTO ops_tokens (token_hash, purpose, email, operator_id, expires_at)
    VALUES (
      ${hashToken(randomBytes(32).toString("hex"))}::text,
      'sms-verify-login'::text,
      ${operator.email}::text,
      ${operator.id}::bigint,
      ${expiresAt}::timestamptz
    )`
}

export async function redeemSmsVerificationIntent(operator: Operator): Promise<string | null> {
  const sql = getSql()
  const rows = (await sql`
    UPDATE ops_tokens SET used_at = now()
    WHERE token_hash = (
      SELECT token_hash FROM ops_tokens
      WHERE purpose = 'sms-verify-login' AND operator_id = ${operator.id}::bigint
        AND used_at IS NULL AND expires_at > now()
      ORDER BY expires_at DESC LIMIT 1
    )
    RETURNING token_hash`) as { token_hash: string }[]
  return rows.length ? createSession(Number(operator.id), operator.email) : null
}

export async function redeemLoginToken(token: string): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const sql = getSql()
  const rows = (await sql`
    UPDATE ops_tokens SET used_at = now()
    WHERE token_hash = ${hashToken(token)}::text AND purpose = 'login'
      AND used_at IS NULL AND expires_at > now()
    RETURNING email, operator_id`) as { email: string; operator_id: number | null }[]
  if (!rows.length) return null

  let operatorId = rows[0].operator_id
  if (!operatorId) {
    const operators = (await sql`
      SELECT id FROM operators
      WHERE lower(email) = lower(${rows[0].email}::text) AND active = true
      LIMIT 1`) as { id: number }[]
    operatorId = operators[0]?.id ?? null
  }
  if (!operatorId) return null
  return createSession(Number(operatorId), rows[0].email)
}

export async function createSmsLoginCode(operator: Operator): Promise<string> {
  const sql = getSql()
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
  const expiresAt = new Date(Date.now() + SMS_CODE_TTL_MS).toISOString()
  await sql`DELETE FROM ops_tokens WHERE expires_at < now()`
  await sql`
    DELETE FROM ops_tokens
    WHERE purpose = 'sms-login' AND operator_id = ${operator.id}::bigint`
  await sql`
    INSERT INTO ops_tokens (token_hash, purpose, email, operator_id, expires_at)
    VALUES (
      ${hashSmsLoginCode(operator.cell_phone, code)}::text,
      'sms-login'::text,
      ${operator.email}::text,
      ${operator.id}::bigint,
      ${expiresAt}::timestamptz
    )`
  return code
}

export async function redeemSmsLoginCode(phone: string, code: string): Promise<string | null> {
  if (!/^\d{6}$/.test(code)) return null
  const sql = getSql()
  const rows = (await sql`
    UPDATE ops_tokens SET used_at = now()
    WHERE token_hash = ${hashSmsLoginCode(phone, code)}::text
      AND purpose = 'sms-login'
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING email, operator_id`) as { email: string; operator_id: number | null }[]
  if (!rows[0]?.operator_id) return null
  return createSession(Number(rows[0].operator_id), rows[0].email)
}

export async function validateSessionToken(token: string | undefined): Promise<Operator | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  try {
    const sql = getSql()
    const rows = (await sql`
      SELECT o.* FROM ops_tokens t
      JOIN operators o ON (
        o.id = t.operator_id OR
        (t.operator_id IS NULL AND lower(o.email) = lower(t.email))
      )
      WHERE t.token_hash = ${hashToken(token)}::text
        AND t.purpose = 'session'
        AND t.expires_at > now()
        AND o.active = true
      LIMIT 1`) as { email: string }[]
    return rows.length ? (rows[0] as Operator) : null
  } catch {
    return null
  }
}

export async function destroySession(token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return
  const sql = getSql()
  await sql`DELETE FROM ops_tokens WHERE token_hash = ${hashToken(token)}::text`
}

export async function getAuthenticatedOperator(): Promise<Operator | null> {
  const cookieStore = await cookies()
  return validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
}
