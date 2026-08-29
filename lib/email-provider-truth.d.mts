export class EmailProviderError extends Error {
  readonly definitive: boolean
  constructor(message: string, definitive: boolean)
}

export function isDefinitiveEmailProviderError(error: unknown): boolean

export function strongestEmailReceiptStatus(receipts: ReadonlyArray<{
  kind?: string | null
  providerType?: string | null
}>): "failed" | "delivered" | "accepted" | "unknown" | null

export function sendEmailWithProviderTruth(send: () => Promise<{
  data?: { id?: string | null } | null
  error?: { message?: string | null } | null
}>): Promise<{ id: string }>
