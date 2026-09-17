export const INBOUND_CALL_SILENCE_LIMIT_HOURS: number

export type InboundCallReceiptHealth = {
  source: "shop-brain-database"
  providerVerified: false
  recentNonTestCount: number | null
  lastReceiptAt: string | null
  silenceHours: number | null
  silenceLimitHours: number
  silent: boolean | null
}

export function evaluateInboundCallReceiptHealth(input: {
  connected: boolean
  lastReceiptAt: string | null
  recentNonTestCount: number | null
  nowMs?: number
}): InboundCallReceiptHealth
