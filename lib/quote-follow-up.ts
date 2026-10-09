// Quoted -> booked follow-up cadence. When a quote goes out the shop gets an
// operator-facing reminder (the existing reminders cron, digest and brief
// surface next_follow_up_at). Nothing here contacts the customer.
//
// Steps are counted from the lead's own follow_up_auto_set events, so the
// cadence needs no new column. A non-NULL next_follow_up_at is never
// overwritten: a manual setFollowUp always wins.

// Days after the quote for step 1, 2 and 3. There is no step 4.
export const QUOTE_FOLLOW_UP_STEP_DAYS = Object.freeze([2, 5, 10] as const)
export const QUOTE_FOLLOW_UP_EVENT = "follow_up_auto_set"
// recordLeadEvent files unmapped legacy types as `lead.<type with dots>`.
export const QUOTE_FOLLOW_UP_EVENT_KIND = "lead.follow.up.auto.set"
// A step whose quote-relative time has already passed (the operator cleared
// the previous reminder late) lands this far out instead of being due at
// once, so clearing a reminder never looks like it failed.
export const QUOTE_FOLLOW_UP_MIN_LEAD_MS = 24 * 60 * 60 * 1000

const MS_PER_DAY = 24 * 60 * 60 * 1000

type QuoteFollowUpSql = (strings: TemplateStringsArray, ...values: unknown[]) => PromiseLike<unknown>
type RecordLeadEvent = (
  leadId: number,
  type: string,
  actor: string,
  detail: Record<string, unknown> | null,
) => PromiseLike<unknown>

export type QuoteFollowUpLead = {
  status: string
  quoted_at: string | Date | null
  next_follow_up_at: string | Date | null
  completed_at: string | Date | null
}

export type QuoteFollowUpPlan = { step: number; days: number; at: string }

export function planQuoteFollowUp(
  lead: QuoteFollowUpLead,
  autoStepsRun: number,
  now: Date = new Date(),
): QuoteFollowUpPlan | null {
  // Won, lost, spam and every other status stop the cadence.
  if (lead.status !== "quoted") return null
  if (lead.completed_at) return null
  // Manual (or any existing) reminder wins.
  if (lead.next_follow_up_at) return null

  const stepsRun = Number.isInteger(autoStepsRun) && autoStepsRun > 0 ? autoStepsRun : 0
  if (stepsRun >= QUOTE_FOLLOW_UP_STEP_DAYS.length) return null

  const quotedMs = lead.quoted_at ? new Date(lead.quoted_at).getTime() : Number.NaN
  const anchorMs = Number.isFinite(quotedMs) ? quotedMs : now.getTime()
  const days = QUOTE_FOLLOW_UP_STEP_DAYS[stepsRun]
  const atMs = Math.max(anchorMs + days * MS_PER_DAY, now.getTime() + QUOTE_FOLLOW_UP_MIN_LEAD_MS)
  return { step: stepsRun + 1, days, at: new Date(atMs).toISOString() }
}

// Schedules the next cadence step for a still-quoted lead with no reminder.
// Call it after a lead becomes quoted and after the operator clears a
// reminder. Returns the plan that was written, or null when nothing changed.
export async function scheduleQuoteFollowUp(
  sql: QuoteFollowUpSql,
  recordLeadEvent: RecordLeadEvent,
  leadId: number,
  now: Date = new Date(),
): Promise<QuoteFollowUpPlan | null> {
  const leads = (await sql`
    SELECT status, quoted_at, next_follow_up_at, completed_at
    FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as QuoteFollowUpLead[]
  const lead = leads[0]
  if (!lead || lead.status !== "quoted" || lead.next_follow_up_at || lead.completed_at) return null

  const counted = (await sql`
    SELECT count(*)::int AS steps FROM events
    WHERE lead_id = ${leadId}::bigint AND kind = ${QUOTE_FOLLOW_UP_EVENT_KIND}::text`) as { steps: number | string }[]
  const plan = planQuoteFollowUp(lead, Number(counted[0]?.steps ?? 0), now)
  if (!plan) return null

  // Re-check every condition in the write so a manual date set in between,
  // a status change, or a concurrent schedule is never overwritten.
  const updated = (await sql`
    UPDATE leads SET next_follow_up_at = ${plan.at}::timestamptz, updated_at = now()
    WHERE id = ${leadId}::bigint
      AND status = 'quoted'
      AND next_follow_up_at IS NULL
      AND completed_at IS NULL
    RETURNING id`) as { id: number }[]
  if (!updated[0]) return null

  await recordLeadEvent(leadId, QUOTE_FOLLOW_UP_EVENT, "system", {
    at: plan.at,
    step: plan.step,
    days: plan.days,
    cadence: "quote",
  })
  return plan
}
