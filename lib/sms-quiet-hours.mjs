const CENTRAL_ZONE = "America/Chicago"
const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CENTRAL_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

function centralParts(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError("A valid send time is required.")
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

function centralWallTimeToUtc({ year, month, day, hour, minute }) {
  const desiredWallMinute = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = desiredWallMinute
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = centralParts(new Date(candidate))
    const actualWallMinute = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
    const adjustment = desiredWallMinute - actualWallMinute
    if (adjustment === 0) break
    candidate += adjustment
  }
  return new Date(candidate)
}

/** Return the next 8 a.m. Central instant while quiet hours are active. */
export function getDeferredSmsSendAt(now = new Date()) {
  const local = centralParts(now)
  const minuteOfDay = local.hour * 60 + local.minute
  if (minuteOfDay >= 8 * 60 && minuteOfDay < 21 * 60) return null

  const nextDay = minuteOfDay >= 21 * 60
    ? new Date(Date.UTC(local.year, local.month - 1, local.day + 1))
    : new Date(Date.UTC(local.year, local.month - 1, local.day))
  return centralWallTimeToUtc({
    year: nextDay.getUTCFullYear(),
    month: nextDay.getUTCMonth() + 1,
    day: nextDay.getUTCDate(),
    hour: 8,
    minute: 0,
  })
}

export function isCentralQuietHours(now = new Date()) {
  return getDeferredSmsSendAt(now) !== null
}
