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
