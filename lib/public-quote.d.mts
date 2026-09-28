export const QUOTE_SERVICE_OPTIONS: readonly string[]
export const QUOTE_HONEYPOT_FIELD: "mcsw_9f3a2"
export function isQuoteHoneypotFilled(formData: Pick<FormData, "get">): boolean
export function quoteSubmissionOutcome(data: unknown): "rejected" | "suppressed" | "accepted"
export function validatePublicQuote(input: {
  firstName?: unknown
  lastName?: unknown
  phone?: unknown
  email?: unknown
  service?: unknown
  message?: unknown
}): string
export function detectRasterImageType(bytes: Uint8Array): string | null
export function imageTypeMatches(bytes: Uint8Array, declaredType: string): boolean
