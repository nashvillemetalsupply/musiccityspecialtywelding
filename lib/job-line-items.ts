import { getSql } from "@/lib/db"
import type { ParsedLineItem } from "@/lib/job-line-items.mjs"
import type { OperatorRole } from "@/lib/operators"

export type JobLineItem = ParsedLineItem & { id: number; position: number }

// Line items are money, so they are removed server-side for crew the same way
// projectLeadForRole nulls every other money field. A crew member does not get
// a shorter list -- they get no list, and the panel says the price is not
// theirs to see. Hiding it in the markup would not be authorization.
export async function listJobLineItems(leadId: number, role: OperatorRole, includeTests = false): Promise<JobLineItem[]> {
  if (role !== "owner") return []
  const map = await listJobLineItemsForLeads([leadId], role, includeTests)
  return map.get(leadId) ?? []
}

// One query for a whole page of board rows. The board renders up to twelve
// jobs and Neon compute is metered, so this is never called per row.
export async function listJobLineItemsForLeads(
  leadIds: readonly number[],
  role: OperatorRole,
  includeTests = false,
): Promise<Map<number, JobLineItem[]>> {
  const byLead = new Map<number, JobLineItem[]>()
  if (role !== "owner") return byLead
  const ids = [...new Set(leadIds.filter((id) => Number.isInteger(id) && id > 0).map(Number))]
  if (!ids.length) return byLead

  const sql = getSql()
  const rows = (await sql`
    SELECT items.id, items.lead_id, items.position, items.label, items.note, items.amount_cents
    FROM job_line_items items
    JOIN leads l ON l.id = items.lead_id
    LEFT JOIN people lead_person ON lead_person.id = l.person_id
    WHERE items.lead_id = ANY(${ids}::bigint[])
      AND (${includeTests}::boolean OR (
        items.is_test = false
        AND l.is_test = false
        AND COALESCE(lead_person.is_test, false) = false
        AND concat_ws(' ', l.first_name, l.last_name, l.service, l.message, l.notes,
          lead_person.display_name, lead_person.company,
          lead_person.phones::text, lead_person.emails::text,
          items.label, items.note) NOT ILIKE '%[INTERNAL TEST]%'
      ))
    ORDER BY items.lead_id, items.position, items.id`) as {
    id: number
    lead_id: number
    position: number
    label: string
    note: string
    amount_cents: number
  }[]

  for (const row of rows) {
    const leadId = Number(row.lead_id)
    const list = byLead.get(leadId) ?? []
    list.push({
      id: Number(row.id),
      position: Number(row.position),
      label: row.label,
      note: row.note,
      amountCents: Number(row.amount_cents),
    })
    byLead.set(leadId, list)
  }
  return byLead
}

// The whole breakdown is replaced as one act, because that is how it is typed:
// the owner edits the box and saves the list they see. Deleting a line by
// removing it from the text is the same gesture as adding one, and a partial
// write would leave a total that matches neither what was typed nor what was
// stored.
export async function replaceJobLineItems(input: {
  leadId: number
  items: readonly ParsedLineItem[]
  operatorId: number
  isTest: boolean
}): Promise<number> {
  const sql = getSql()
  await sql`DELETE FROM job_line_items WHERE lead_id = ${input.leadId}::bigint`

  let position = 0
  for (const item of input.items) {
    position += 1
    await sql`
      INSERT INTO job_line_items (lead_id, position, label, note, amount_cents, entered_by, is_test)
      VALUES (
        ${input.leadId}::bigint, ${position}::int, ${item.label}::text, ${item.note}::text,
        ${item.amountCents}::bigint, ${input.operatorId}::bigint, ${input.isTest}::boolean
      )`
  }
  return position
}
