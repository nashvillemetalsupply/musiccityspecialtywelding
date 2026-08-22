export const GMAIL_NOISE_DOMAINS: string[]
export function shouldSkipGmailMessage(input: {
  sent: boolean
  categorizedNoise: boolean
  from: string
  subject?: string
  body?: string
  headers?: Record<string, string>
}): boolean
export function isAuthenticatedIntuitPayment(input: {
  from: string
  labels?: string[]
  authenticationResults?: string | string[]
  subject?: string
  body?: string
  /** Every To: header value. All must be at the shop domain, or the receipt is refused. */
  recipients?: string | string[]
  /** Raw DKIM-Signature headers. Intuit's must cover to: and subject: and carry no l= tag. */
  dkimSignatures?: string | string[]
}): boolean
export function looksLikeIntuitPaymentEnvelope(input: { from: string; subject?: string; body?: string }): boolean
export function paymentCompletesInvoice(input: {
  text?: string
  amountCents?: number | null
  invoiceTotalCents?: number | null
  priorPaidCents?: number
}): boolean
export function extractQuickBooksPaymentFacts(input: { subject?: string; body?: string }): {
  invoiceNumber: string | null
  paymentAmountCents: number | null
  invoiceTotalCents: number | null
  balanceCents: number | null
}
export function sentMessageMayStartWork(input: { subject?: string; body?: string }): boolean
