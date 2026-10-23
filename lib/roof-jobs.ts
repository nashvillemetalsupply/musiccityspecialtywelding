// O1 (Fable ruling 2026-10-23): per-job rows for LD2R, Railing and BuilderBox.
// Grease Patrol keeps its own ops board and never writes here; welding keeps
// the leads table. Both doors (the /board tabs and the S81 text count) write
// through this file so the business list, money cap and idempotency key are
// one rule.
import { getSql } from "./db.ts"
import type { Operator } from "@/lib/operators"
import { mayRecordBusinessFact, ownerSurfaceRoleForOperator } from "./business-entries.ts"
import { OPERATOR_PAYMENT_MAX_CENTS, parseDollarsToken, S81_BUSINESS_KEYS } from "./sms-operator-commands.ts"

export const GREASE_BUSINESS_KEY = "grease-patrol"
export const ROOF_JOB_BUSINESSES = S81_BUSINESS_KEYS.filter((key) => key !== GREASE_BUSINESS_KEY)
export const ROOF_JOB_SMS_NOTE = "sms count"

export function isRoofJobBusiness(business: string) {
  return ROOF_JOB_BUSINESSES.includes(business)
}

export type RoofJob = {
  id: number
  business: string
  customer_name: string | null
  phone: string | null
  job_date: string | null
  amount_cents: number | null
  status: "booked" | "paid"
  note: string
  created_by: number
  is_test: boolean
  created_at: string
  paid_at: string | null
}

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
type Recorder = Pick<Operator, "id" | "role">

const sqlOrDefault = (sql?: Sql) => sql ?? (getSql() as unknown as Sql)

function requireBusiness(business: string) {
  if (business === GREASE_BUSINESS_KEY) throw new Error("Grease Patrol jobs live on the Grease Patrol ops board.")
  if (!isRoofJobBusiness(business)) throw new Error("Unknown business.")
}

function requireRecorder(operator: Recorder) {
  const role = ownerSurfaceRoleForOperator(operator.role)
  if (!role) throw new Error("This operator role is not bound to the owner surface.")
  if (!mayRecordBusinessFact(role)) throw new Error("This role cannot enter business money facts.")
}

// Dollars typed in the app ("450", "$1,250.50") through the same token parser
// the S81 text path uses. Empty is "no amount yet".
export function parseAmountCents(value: string): number | null {
  const trimmed = String(value ?? "").trim().replace(/^\$/, "")
  if (!trimmed) return null
  const cents = parseDollarsToken(`$${trimmed}`)
  if (cents === null || cents <= 0) throw new Error("Enter the amount in dollars, like 450 or 450.25.")
  if (cents > OPERATOR_PAYMENT_MAX_CENTS) throw new Error("That amount looks too big. Check it and try again.")
  return cents
}

function optionalText(value: unknown, max: number, label: string) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (text.length > max) throw new Error(`${label} is too long (${max} characters at most).`)
  return text || null
}

function optionalDate(value: unknown) {
  const text = String(value ?? "").trim()
  if (!text) return null
  const date = new Date(`${text}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error("Enter the job date as a calendar date.")
  }
  return text
}

export function validateRoofJobInput(raw: {
  business: string
  customerName?: unknown
  phone?: unknown
  jobDate?: unknown
  amount?: unknown
  note?: unknown
}) {
  const business = String(raw.business ?? "")
  requireBusiness(business)
  const phone = optionalText(raw.phone, 40, "Phone")
  if (phone && !/^[0-9+().\-\s]+$/.test(phone)) throw new Error("Phone can only hold digits, spaces and + ( ) -.")
  return {
    business,
    customerName: optionalText(raw.customerName, 120, "Customer name"),
    phone,
    jobDate: optionalDate(raw.jobDate),
    amountCents: parseAmountCents(String(raw.amount ?? "")),
    note: optionalText(raw.note, 500, "Note") ?? "",
  }
}

const REQUEST_ID = /^[a-f0-9-]{36}$/i

export async function addRoofJob(input: {
  operator: Recorder
  fields: Parameters<typeof validateRoofJobInput>[0]
  requestId: string
  isTest?: boolean
  sql?: Sql
}) {
  requireRecorder(input.operator)
  const job = validateRoofJobInput(input.fields)
  if (!REQUEST_ID.test(input.requestId)) throw new Error("Refresh the business page and try again.")
  // Test entries are owner-only, the same partition rule as internal-test leads.
  const isTest = Boolean(input.isTest) && input.operator.role === "owner"
  await sqlOrDefault(input.sql)`
    INSERT INTO roof_jobs (business, customer_name, phone, job_date, amount_cents, status, note, created_by, external_id, is_test)
    VALUES (${job.business}::text, ${job.customerName}::text, ${job.phone}::text, ${job.jobDate}::date,
      ${job.amountCents}::bigint, 'booked', ${job.note}::text, ${input.operator.id}::bigint,
      ${`crm-${input.requestId}`}::text, ${isTest}::boolean)
    ON CONFLICT (external_id) DO NOTHING`
  return job
}

// Owner sees every row; crew sees (and can mark paid) only the rows they made.
export async function listRoofJobs(input: { business: string; operator: Recorder; limit?: number; sql?: Sql }) {
  requireBusiness(input.business)
  const owner = input.operator.role === "owner"
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 200))
  return await sqlOrDefault(input.sql)`
    SELECT id, business, customer_name, phone, to_char(job_date, 'YYYY-MM-DD') AS job_date, amount_cents,
      status, note, created_by, is_test, created_at, paid_at
    FROM roof_jobs
    WHERE business = ${input.business}::text
      AND (${owner}::boolean OR (created_by = ${input.operator.id}::bigint AND is_test = false))
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}::int` as RoofJob[]
}

export async function markRoofJobPaid(input: { operator: Recorder; business: string; id: number; amount: string; sql?: Sql }) {
  requireRecorder(input.operator)
  requireBusiness(input.business)
  if (!Number.isSafeInteger(input.id) || input.id <= 0) throw new Error("Job not found.")
  const amountCents = parseAmountCents(input.amount)
  const owner = input.operator.role === "owner"
  const sql = sqlOrDefault(input.sql)
  const rows = await sql`
    SELECT status, amount_cents FROM roof_jobs
    WHERE id = ${input.id}::bigint AND business = ${input.business}::text
      AND (${owner}::boolean OR (created_by = ${input.operator.id}::bigint AND is_test = false))
    LIMIT 1` as Pick<RoofJob, "status" | "amount_cents">[]
  if (!rows[0]) throw new Error("Job not found.")
  if (rows[0].status === "paid") return { alreadyPaid: true }
  if (amountCents === null && rows[0].amount_cents === null) throw new Error("Enter the amount to mark this job paid.")
  // The booked amount stands; mark-paid only fills a missing one.
  if (amountCents !== null && rows[0].amount_cents !== null && Number(rows[0].amount_cents) !== amountCents) {
    throw new Error("This job already has an amount. Ask the owner to fix it.")
  }
  await sql`
    UPDATE roof_jobs
    SET status = 'paid', paid_at = now(), updated_at = now(),
      amount_cents = COALESCE(amount_cents, ${amountCents}::bigint)
    WHERE id = ${input.id}::bigint AND business = ${input.business}::text AND status = 'booked'
      AND (${owner}::boolean OR (created_by = ${input.operator.id}::bigint AND is_test = false))`
  return { alreadyPaid: false }
}

// S81 text count -> rows. "booked ld2r 2" is two booked rows with no customer;
// "paid ld2r $450" is one paid row. The SID-derived external_id makes a
// replayed text a no-op. Grease and welding produce nothing here.
export function roofJobRowsForSmsCount(input: {
  business: string
  verb: "booked" | "paid"
  count: number | null
  amountCents: number | null
  sid: string
}) {
  if (!isRoofJobBusiness(input.business)) return []
  const key = `sms-${input.sid.replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 80)
  if (input.verb === "paid") {
    const cents = input.amountCents ?? 0
    if (cents <= 0 || cents > OPERATOR_PAYMENT_MAX_CENTS) throw new Error("Paid needs an amount.")
    return [{ status: "paid" as const, amountCents: cents, externalId: `${key}-paid` }]
  }
  const count = input.count ?? 0
  if (!Number.isSafeInteger(count) || count < 1 || count > 99) throw new Error("Booked needs a count from 1 to 99.")
  return Array.from({ length: count }, (_, i) => ({ status: "booked" as const, amountCents: null, externalId: `${key}-${i + 1}` }))
}

export async function recordSmsCountRoofJobs(input: {
  operator: Recorder
  business: string
  rows: ReturnType<typeof roofJobRowsForSmsCount>
  sql?: Sql
}) {
  requireRecorder(input.operator)
  requireBusiness(input.business)
  if (!input.rows.length) return 0
  await sqlOrDefault(input.sql)`
    INSERT INTO roof_jobs (business, status, amount_cents, note, created_by, external_id, paid_at)
    SELECT ${input.business}::text, r.status, r.amount_cents, ${ROOF_JOB_SMS_NOTE}::text, ${input.operator.id}::bigint,
      r.external_id, CASE WHEN r.status = 'paid' THEN now() END
    FROM unnest(${input.rows.map((row) => row.status)}::text[], ${input.rows.map((row) => row.amountCents)}::bigint[],
      ${input.rows.map((row) => row.externalId)}::text[]) AS r(status, amount_cents, external_id)
    ON CONFLICT (external_id) DO NOTHING`
  return input.rows.length
}
