export function normalizePaymentReversalInput(amountCents: number, reason: unknown): { amountCents: number; reason: string }
export function runOwnerPaymentReversal<T>(role: string, persist: () => Promise<T>): Promise<T>
