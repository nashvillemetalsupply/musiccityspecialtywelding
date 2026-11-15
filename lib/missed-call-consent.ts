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
