export function gmailFreshnessWindowMs(now?: Date): number

export function automationRunIsStale(
  lastRanAt: string | null,
  freshnessMs: number,
  nowMs?: number,
): boolean
