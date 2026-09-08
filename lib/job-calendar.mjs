export const SHOP_TIME_ZONE = "America/Chicago"

const DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

const MIDNIGHT_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})

function numericParts(formatter, date) {
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  )
}

export function centralDateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = numericParts(DATE_PARTS, date)
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
}

export function calendarTimestampIso(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function addCalendarDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// Convert a Central civil midnight into a real instant. The second pass is
// important near an offset transition: it makes the helper independent of a
// machine's own timezone and keeps a calendar day a calendar day across DST.
function centralMidnight(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const wallClockUtc = Date.UTC(year, month - 1, day)
  let instant = wallClockUtc
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = numericParts(MIDNIGHT_PARTS, new Date(instant))
    const renderedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    )
    instant = wallClockUtc - (renderedAsUtc - instant)
  }
  return new Date(instant)
}

export function rollingCentralDateRange(now = new Date(), dayCount = 30) {
  const date = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(date.getTime())) throw new TypeError("A valid current time is required.")
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 366) {
    throw new RangeError("The calendar must contain between 1 and 366 days.")
  }

  const firstDateKey = centralDateKey(date)
  const dateKeys = Array.from({ length: dayCount }, (_, index) => addCalendarDays(firstDateKey, index))
  const endDateKey = addCalendarDays(firstDateKey, dayCount)
  return {
    dateKeys,
    startInclusive: centralMidnight(firstDateKey).toISOString(),
    endExclusive: centralMidnight(endDateKey).toISOString(),
  }
}

export function isActiveScheduledJob(job) {
  return Boolean(
    job
    && Number.isInteger(job.id)
    && job.id > 0
    && typeof job.scheduledAt === "string"
    && centralDateKey(job.scheduledAt)
    && job.completedAt == null
    && job.handedOffAt == null
    && job.routedToLeadId == null
    && job.isTest === false
    && job.status !== "lost"
    && job.status !== "spam",
  )
}

export function buildRollingJobCalendar(jobs, now = new Date(), dayCount = 30) {
  const range = rollingCentralDateRange(now, dayCount)
  const days = range.dateKeys.map((dateKey) => ({ dateKey, jobs: [] }))
  const dayByKey = new Map(days.map((day) => [day.dateKey, day]))

  for (const job of jobs) {
    if (!isActiveScheduledJob(job)) continue
    const day = dayByKey.get(centralDateKey(job.scheduledAt))
    if (day) day.jobs.push(job)
  }

  for (const day of days) {
    day.jobs.sort((left, right) => {
      const byTime = new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
      return byTime || left.id - right.id
    })
  }
  return days
}

export function selectedCalendarDay(days, selectedDateKey) {
  if (!Array.isArray(days) || days.length === 0) return null
  return days.find((day) => day.dateKey === selectedDateKey) ?? days[0]
}

export function calendarNavigationIndex(index, key, length, columns = 7) {
  if (!Number.isInteger(index) || !Number.isInteger(length) || length < 1) return null
  if (!Number.isInteger(columns) || columns < 1) return null
  const current = Math.min(Math.max(index, 0), length - 1)
  if (key === "ArrowLeft") return Math.max(0, current - 1)
  if (key === "ArrowRight") return Math.min(length - 1, current + 1)
  if (key === "ArrowUp") return Math.max(0, current - columns)
  if (key === "ArrowDown") return Math.min(length - 1, current + columns)
  if (key === "Home") return current - (current % columns)
  if (key === "End") return Math.min(length - 1, current + columns - 1 - (current % columns))
  return null
}
