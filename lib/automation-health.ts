const MINUTE_MS = 60 * 1000

export function gmailFreshnessWindowMs(now: Date = new Date()) : number {
  const utcHour = now.getUTCHours()
  return utcHour >= 12 ? 60 * MINUTE_MS : 120 * MINUTE_MS
}

export function automationRunIsStale(lastRanAt: string | null, freshnessMs: number, nowMs: number = Date.now()) : boolean {
  if (!lastRanAt) return true
  const lastRanAtMs = new Date(lastRanAt).getTime()
  return !Number.isFinite(lastRanAtMs) || nowMs - lastRanAtMs > freshnessMs
}
