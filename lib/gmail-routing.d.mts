export const GMAIL_NOISE_DOMAINS: string[]
export function shouldSkipGmailMessage(input: {
  sent: boolean
  categorizedNoise: boolean
  from: string
}): boolean
export function isAuthenticatedIntuitPayment(input: {
  from: string
  labels?: string[]
  authenticationResults?: string | string[]
  subject?: string
  body?: string
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
