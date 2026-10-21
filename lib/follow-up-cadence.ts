export const FOLLOW_UP_DAY_BOUNDS = Object.freeze({ min: 1, max: 30 })
export const MINIMUM_WON_JOB_SAMPLES = 5

const MS_PER_DAY = 24 * 60 * 60 * 1000
type WonJobSql = (strings: TemplateStringsArray, ...values: unknown[]) => PromiseLike<unknown>

export function median(values: number[]): number | null {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right)
  if (sorted.length === 0) return null

  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export function defaultFollowUpAtFromDurations(daysToClose: number[], now: Date = new Date()): string | null {
  const samples = daysToClose.map(Number).filter(Number.isFinite)
  if (samples.length < MINIMUM_WON_JOB_SAMPLES) return null

  const medianDays = median(samples)
  if (medianDays === null) return null

  const clampedDays = Math.max(
    FOLLOW_UP_DAY_BOUNDS.min,
    Math.min(FOLLOW_UP_DAY_BOUNDS.max, medianDays),
  )
  return new Date(now.getTime() + clampedDays * MS_PER_DAY).toISOString()
}

export async function getDefaultFollowUpAt(sql: WonJobSql, now: Date = new Date()) {
  let wonJobs: Array<{ days_to_close: number | string | null }>
  try {
    wonJobs = await sql`
      SELECT EXTRACT(EPOCH FROM (won_at - created_at)) / 86400.0 AS days_to_close
      FROM leads
      WHERE status = 'won'
        AND won_at IS NOT NULL
        AND is_test = false
        AND concat_ws(
          ' ', first_name, last_name, phone, email, service, message, source,
          notes, landing_page, referrer, user_agent
        ) NOT ILIKE '%[INTERNAL TEST]%'
    ` as Array<{ days_to_close: number | string | null }>
  } catch {
    // Keep intake available and preserve the existing NULL default if history
    // cannot be read for this best-effort suggestion.
    return null
  }

  return defaultFollowUpAtFromDurations(
    wonJobs.map((job: { days_to_close: number | string | null }) => job.days_to_close as number),
    now,
  )
}

export const QUOTE_DRAFT_EVENT = "quote_draft_prepared"
// recordLeadEvent files unmapped legacy types as `lead.<type with dots>`.
export const QUOTE_DRAFT_EVENT_KIND = "lead.quote.draft.prepared"
const QUOTE_DRAFT_COMPS = 10

type RecordLeadEvent = (
  leadId: number,
  type: string,
  actor: string,
  detail: Record<string, unknown> | null,
) => PromiseLike<unknown>

// Internal only: files one suggested price (median of recent won jobs with the
// same service) for the operator to review. It never sets status, quoted_at or
// the estimate, and never contacts the customer; quoting stays one operator tap.
export async function prepareQuoteDraft(
  sql: WonJobSql,
  recordLeadEvent: RecordLeadEvent,
  leadId: number,
): Promise<{ suggested_cents: number | null; n: number } | null> {
  const leads = (await sql`
    SELECT service, message, is_test, quoted_at, photo_count
    FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as {
    service: string; message: string; is_test: boolean; quoted_at: string | Date | null; photo_count: number | string | null
  }[]
  const lead = leads[0]
  if (!lead || lead.is_test || lead.quoted_at) return null

  const prior = (await sql`
    SELECT 1 AS found FROM events
    WHERE lead_id = ${leadId}::bigint AND kind = ${QUOTE_DRAFT_EVENT_KIND}::text LIMIT 1`) as unknown[]
  if (prior[0]) return null

  const comps = (await sql`
    SELECT estimate_value_cents FROM leads
    WHERE status = 'won' AND won_at IS NOT NULL AND is_test = false
      AND estimate_value_cents IS NOT NULL AND service = ${lead.service}::text
      AND id <> ${leadId}::bigint
      AND concat_ws(
        ' ', first_name, last_name, phone, email, service, message, source,
        notes, landing_page, referrer, user_agent
      ) NOT ILIKE '%[INTERNAL TEST]%'
    ORDER BY won_at DESC LIMIT ${QUOTE_DRAFT_COMPS}::int`) as { estimate_value_cents: number | string }[]
  const n = comps.length
  const mid = n >= MINIMUM_WON_JOB_SAMPLES ? median(comps.map((row) => Number(row.estimate_value_cents))) : null
  const draft = { suggested_cents: mid === null ? null : Math.round(mid), n }

  await recordLeadEvent(leadId, QUOTE_DRAFT_EVENT, "system", {
    ...draft,
    scope: `${lead.service}: ${lead.message ?? ""}`.slice(0, 300),
    photos: Number(lead.photo_count ?? 0),
  })
  return draft
}
