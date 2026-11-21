const MINUTE_MS = 60 * 1000

export function gmailFreshnessWindowMs(): number {
  return 45 * MINUTE_MS
}

export function automationRunIsStale(lastRanAt: string | null, freshnessMs: number, nowMs: number = Date.now()) : boolean {
  if (!lastRanAt) return true
  const lastRanAtMs = new Date(lastRanAt).getTime()
  return !Number.isFinite(lastRanAtMs) || nowMs - lastRanAtMs > freshnessMs
}
