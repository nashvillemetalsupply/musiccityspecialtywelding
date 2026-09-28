export function isCentralBriefHour(date: Date = new Date()) : boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hour12: false,
  }).format(date))
  return hour === 6
}

export function morningBriefDedupeKey(day: string) : string {
  return `brief:${day}`
}
