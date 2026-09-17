const HOUR_MS = 60 * 60 * 1000

// At the shop's recent call volume, four complete days without a database
// receipt is unusual enough to investigate while still tolerating weekends,
// holidays, and delayed GitHub schedules.
export const INBOUND_CALL_SILENCE_LIMIT_HOURS = 96

export function evaluateInboundCallReceiptHealth({
  connected,
  lastReceiptAt,
  recentNonTestCount,
  nowMs = Date.now(),
}) {
  const count = Math.max(0, Math.floor(Number(recentNonTestCount) || 0))
  const lastReceiptMs = lastReceiptAt ? new Date(lastReceiptAt).getTime() : Number.NaN
  const validLastReceipt = Number.isFinite(lastReceiptMs)
  const silenceHours = validLastReceipt
    ? Math.max(0, Math.floor((nowMs - lastReceiptMs) / HOUR_MS))
    : null
  const silent = connected
    ? count === 0 && (silenceHours === null || silenceHours >= INBOUND_CALL_SILENCE_LIMIT_HOURS)
    : null

  return {
    source: "shop-brain-database",
    providerVerified: false,
    recentNonTestCount: connected ? count : null,
    lastReceiptAt: connected && validLastReceipt ? new Date(lastReceiptMs).toISOString() : null,
    silenceHours: connected ? silenceHours : null,
    silenceLimitHours: INBOUND_CALL_SILENCE_LIMIT_HOURS,
    silent,
  }
}
