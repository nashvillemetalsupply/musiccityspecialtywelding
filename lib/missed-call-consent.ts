export function isMissedCallTextOnCall(flagValue: string | undefined, idempotencyKey: string): boolean {
  return flagValue === "1" && /^missed-call:CA[0-9a-f]{32}:auto-reply$/i.test(idempotencyKey)
}

export function missedCallTextConsentAllowed(
  flagValue: string | undefined,
  idempotencyKey: string,
  consentState: "granted" | "revoked" | "unknown",
): boolean {
  return isMissedCallTextOnCall(flagValue, idempotencyKey) && consentState !== "revoked"
}

export function missedCallQuietExempt(callAt: Date, now: Date): boolean {
  const elapsed = now.getTime() - callAt.getTime()
  return elapsed >= -60_000 && elapsed <= 5 * 60 * 1000
}
