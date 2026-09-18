const HOUR_MS = 60 * 60 * 1000

// The phone is the channel: roughly twenty inbound calls a week, every one of
// them arriving through the Twilio webhook. Two complete days of silence at
// that rate is about a one-in-three-hundred event, so it means a dead webhook
// far more often than it means a quiet shop. Ninety-six hours was chosen when
// this was only a warning; it is the red signal now, so it tightens.
export const INBOUND_CALL_SILENCE_LIMIT_HOURS = 48

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
