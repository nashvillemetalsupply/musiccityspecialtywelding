const CENTRAL_ZONE = "America/Chicago"

const CENTRAL_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: CENTRAL_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/
const VALID_TIME = /^\d{2}:\d{2}$/

function centralKey(instant) {
  const values = Object.fromEntries(
    CENTRAL_PARTS.formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  )
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

/**
 * Resolve an unambiguous Central civil time to an ISO instant.
 * Returns null for malformed dates, spring-forward gaps, and fall-back times
 * that occur twice.
 */
export function resolveCentralDateTime(date, time) {
  if (!VALID_DATE.test(date) || !VALID_TIME.test(time)) return null
  const [year, month, day] = date.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  const civil = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (civil.getUTCFullYear() !== year
    || civil.getUTCMonth() + 1 !== month
    || civil.getUTCDate() !== day
    || civil.getUTCHours() !== hour
    || civil.getUTCMinutes() !== minute) return null

  const expected = `${date}T${time}`
  const matches = []
  // Chicago is UTC-5 or UTC-6 for the dates this application schedules.
  // Half-hour steps make the matching logic explicit and future-safe.
  for (let offsetMinutes = 4 * 60; offsetMinutes <= 7 * 60; offsetMinutes += 30) {
    const candidate = new Date(civil.getTime() + offsetMinutes * 60_000)
    if (centralKey(candidate) === expected) matches.push(candidate)
  }
  return matches.length === 1 ? matches[0].toISOString() : null
}
