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

export function centralMonthRange(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(date.getTime())) throw new TypeError("A valid current time is required.")

  const currentDateKey = centralDateKey(date)
  const [year, month] = currentDateKey.split("-").map(Number)
  const firstDateKey = `${year}-${String(month).padStart(2, "0")}-01`
  const endDate = new Date(Date.UTC(year, month, 1))
  const endDateKey = endDate.toISOString().slice(0, 10)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const dateKeys = Array.from({ length: daysInMonth }, (_, index) => addCalendarDays(firstDateKey, index))
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

export function buildMonthJobCalendar(jobs, now = new Date()) {
  const range = centralMonthRange(now)
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

export function calendarNavigationIndex(index, key, length, columns = 7, leadingOffset = 0) {
  if (!Number.isInteger(index) || !Number.isInteger(length) || length < 1) return null
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(leadingOffset) || leadingOffset < 0 || leadingOffset >= columns) return null
  const current = Math.min(Math.max(index, 0), length - 1)
  const position = current + leadingOffset
  if (key === "ArrowLeft") return Math.max(0, current - 1)
  if (key === "ArrowRight") return Math.min(length - 1, current + 1)
  if (key === "ArrowUp") return Math.max(0, current - columns)
  if (key === "ArrowDown") return Math.min(length - 1, current + columns)
  if (key === "Home") return Math.max(0, position - (position % columns) - leadingOffset)
  if (key === "End") return Math.min(length - 1, position + columns - 1 - (position % columns) - leadingOffset)
  return null
}
