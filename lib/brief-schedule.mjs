export function isCentralBriefHour(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hour12: false,
  }).format(date))
  return hour === 6
}

export function morningBriefDedupeKey(day) {
  return `brief:${day}`
}
