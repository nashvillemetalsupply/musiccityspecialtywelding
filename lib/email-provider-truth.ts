export class EmailProviderError extends Error {
  definitive: boolean

  constructor(message: string, definitive: boolean) {
    super(message)
    this.name = "EmailProviderError"
    this.definitive = definitive
  }
}

export function isDefinitiveEmailProviderError(error: unknown) : boolean {
  return error instanceof EmailProviderError && error.definitive
}

/**
 * Reduces an immutable receipt history without allowing a later ambiguous
 * request result to erase stronger provider truth. A signed terminal failure
 * still outranks request acceptance; an unsent request rejection does not.
 */
export function strongestEmailReceiptStatus(receipts: ReadonlyArray<{
  kind?: string | null
  providerType?: string | null
}>) : "failed" | "delivered" | "accepted" | "unknown" | null {
  if (receipts.some((receipt) => receipt?.kind === "email.failed" && receipt.providerType)) return "failed"
  if (receipts.some((receipt) => receipt?.kind === "email.delivered")) return "delivered"
  if (receipts.some((receipt) => receipt?.kind === "email.accepted")) return "accepted"
  if (receipts.some((receipt) => receipt?.kind === "email.unknown")) return "unknown"
  if (receipts.some((receipt) => receipt?.kind === "email.failed")) return "failed"
  return null
}

/**
 * Keeps Resend's returned rejection separate from a request whose response was
 * lost. The caller owns the durable intent and receipt; this adapter owns only
 * the provider-response truth boundary.
 */
export async function sendEmailWithProviderTruth(send: () => Promise<{
  data?: { id?: string | null } | null
  error?: { message?: string | null } | null
}>) : Promise<{ id: string }> {
  let result
  try {
    result = await send()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email provider response was lost."
    throw new EmailProviderError(message, false)
  }
  if (result?.error) {
    throw new EmailProviderError(result.error.message || "Email provider rejected the message.", true)
  }
  if (!result?.data?.id) {
    throw new EmailProviderError("Email provider responded without an acceptance receipt. Check delivery before retrying.", false)
  }
  return { id: result.data.id }
}
