import { getSql } from "./db.ts"
import type { Operator, OperatorRole } from "@/lib/operators"
import { businessReply, parseOperatorCommand, S81_BUSINESS_KEYS, type OperatorCommandVerb } from "./sms-operator-commands.ts"

export type OwnerSurfaceRole = "owner" | "manager" | "worker" | "bookkeeper" | "operator"

export function ownerSurfaceRoleForOperator(role: OperatorRole | string): OwnerSurfaceRole | null {
  // S80's existing operators table is the current binding source: owner stays
  // owner; crew is the S79a worker role. No role column or migration added.
  if (role === "owner") return "owner"
  if (role === "crew") return "worker"
  // The current operators table CHECK only admits owner/crew. Fail closed if
  // a future or malformed row reaches this boundary without a binding.
  return null
}

export function mayRecordBusinessFact(role: OwnerSurfaceRole) {
  // Workers report the paid fact; they do not initiate or transfer money.
  return role === "owner" || role === "worker"
}

export type BusinessEntry = {
  id: number
  occurred_at: string
  body: string
  detail: Record<string, unknown> | null
  actor_id: string
}

export async function listBusinessEntries(input: {
  business: string
  operator: Pick<Operator, "id" | "role">
  limit?: number
}) {
  if (!S81_BUSINESS_KEYS.includes(input.business)) throw new Error("Unknown business.")
  const sql = getSql()
  const owner = input.operator.role === "owner"
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 30), 100))
  return await sql`
    SELECT id, occurred_at, body, detail, actor_id
    FROM events
    WHERE kind = 'sms.operator.in'::text
      AND actor_type = 'operator'::text
      AND is_test = false
      AND detail->>'business' = ${input.business}::text
      AND (${owner}::boolean OR actor_id = ${input.operator.id}::text)
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${limit}::int` as BusinessEntry[]
}

export async function recordBusinessEntry(input: {
  operator: Operator
  business: string
  verb: Extract<OperatorCommandVerb, "booked" | "paid">
  value: string
  externalId: string
  journal?: (event: {
    operator: Operator
    sid: string
    body: string
    messageId: number | null
    verb: OperatorCommandVerb | null
    leadId: number | null
    outcome: "done" | "refused" | "unmatched" | "not-understood"
    reply: string
    amountCents?: number | null
    business?: string | null
    count?: number | null
  }) => Promise<unknown>
}) {
  const role = ownerSurfaceRoleForOperator(input.operator.role)
  if (!role) throw new Error("This operator role is not bound to the owner surface.")
  if (!mayRecordBusinessFact(role)) throw new Error("This role cannot enter business money facts.")
  if (!S81_BUSINESS_KEYS.includes(input.business)) throw new Error("Unknown business.")
  const trimmedValue = input.value.trim()
  const body = input.verb === "booked"
    ? `booked ${input.business} ${trimmedValue}`
    : `paid ${input.business} $${trimmedValue}`
  const parsed = parseOperatorCommand(body)
  if (!parsed?.ok || parsed.ref.kind !== "business" || parsed.ref.business !== input.business || parsed.verb !== input.verb) {
    throw new Error(parsed && !parsed.ok ? parsed.reply : "Enter a valid booked count or paid amount.")
  }

  const reply = businessReply(parsed.verb, parsed.ref.business, {
    count: parsed.ref.count,
    amountCents: parsed.amountCents,
  })
  const journal = input.journal ?? (await import("./operator-command-journal.ts")).journalOperatorCommand
  await journal({
    operator: input.operator,
    sid: input.externalId,
    body,
    messageId: null,
    verb: parsed.verb,
    leadId: null,
    outcome: "done",
    reply,
    amountCents: parsed.amountCents,
    business: parsed.ref.business,
    count: parsed.ref.count,
  })
  return { body, reply, business: parsed.ref.business, count: parsed.ref.count, amountCents: parsed.amountCents }
}
