import { createHmac, timingSafeEqual } from "node:crypto"
import { getSql } from "@/lib/db"

export type OperatorRole = "owner" | "crew"

// Internal-test records exercise real workflows without becoming business
// records. Only the owner may opt into that partition; URL parameters and
// guessed record IDs never grant access on their own.
export function canAccessInternalTests(role: OperatorRole) {
  return role === "owner"
}

// A rendered page is not an authorization boundary. Every mutation that takes
// a lead id from a form calls this before changing durable state, so a crew
// member cannot reach an owner-only test record by guessing its id.
export async function requireLeadMutationAccess(
  operator: Pick<Operator, "role">,
  leadId: number,
  options: { allowRoutingInbox?: boolean } = {},
): Promise<{ isTest: boolean; routedToLeadId: number | null; service: string }> {
  const sql = getSql()
  const rows = (await sql`
    SELECT is_test, routed_to_lead_id, service FROM leads
    WHERE id = ${leadId}::bigint LIMIT 1`) as Array<{ is_test: boolean; routed_to_lead_id: number | null; service: string }>
  if (!rows[0]) throw new Error("Job not found.")
  if (rows[0].is_test && !canAccessInternalTests(operator.role)) {
    throw new Error("Owner access is required for internal test jobs.")
  }
  if (!options.allowRoutingInbox && rows[0].routed_to_lead_id) {
    throw new Error(`This conversation was filed to Job #${rows[0].routed_to_lead_id}. Open that job to make changes.`)
  }
  if (!options.allowRoutingInbox && rows[0].service === "Needs job match") {
    throw new Error("Choose the correct job before making changes or replying.")
  }
  return { isTest: rows[0].is_test, routedToLeadId: rows[0].routed_to_lead_id, service: rows[0].service }
}

export type Operator = {
  id: number
  email: string
  name: string
  signature_name: string
  role: OperatorRole
  cell_phone: string
  active: boolean
  last_seen_at: string | null
  created_at: string
  glass_clean_approvals: number
  glass_auto_post: boolean
}

export function operatorHasEmail(operator: Pick<Operator, "email">) {
  const email = operator.email.trim().toLowerCase()
  return Boolean(email && !email.endsWith(".invalid"))
}

export function operatorSignature(operator: Pick<Operator, "name" | "signature_name" | "role">) {
  const explicit = operator.signature_name?.trim()
  if (explicit) return explicit
  if (operator.role === "owner" && /^philippe?$/i.test(operator.name.trim())) return "Philip"
  return operator.name.trim() || "Philip"
}

// Attribution is provenance only. Do not aggregate activity by operator.
export async function getOperatorById(id: number): Promise<Operator | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT * FROM operators WHERE id = ${id}::bigint AND active = true LIMIT 1`) as Operator[]
  return rows[0] ?? null
}

export async function getOperatorByEmail(email: string): Promise<Operator | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT * FROM operators
    WHERE lower(email) = lower(${email.trim()}::text) AND active = true
    LIMIT 1`) as Operator[]
  return rows[0] ?? null
}

export async function getOperatorByPhone(phone: string): Promise<Operator | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT * FROM operators
    WHERE cell_phone = ${phone}::text AND active = true
    ORDER BY id ASC LIMIT 2`) as Operator[]
  // Fail closed if an older database has not yet applied the unique index.
  return rows.length === 1 ? rows[0] : null
}

export function operatorPunchSelector(id: number) {
  const secret = process.env.OPS_PUNCH_SECRET?.trim()
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) return ""
  const signature = createHmac("sha256", secret).update(`mcsw-punch:${id}`).digest("base64url")
  return `${id}.${signature}`
}

export async function getOperatorByPunchSelector(selector: string): Promise<Operator | null> {
  const [rawId, supplied = ""] = selector.split(".", 2)
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0 || !supplied) return null
  const expected = operatorPunchSelector(id).split(".", 2)[1] ?? ""
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return null
  return getOperatorById(id)
}

export async function listOperators(includeInactive = false): Promise<Operator[]> {
  const sql = getSql()
  return (await sql`
    SELECT * FROM operators
    WHERE (${includeInactive}::boolean OR active = true)
    ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, name, email`) as Operator[]
}

export async function touchOperator(id: number) {
  const sql = getSql()
  await sql`UPDATE operators SET last_seen_at = now() WHERE id = ${id}::bigint`
}
