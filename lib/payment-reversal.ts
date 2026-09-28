export function normalizePaymentReversalInput(amountCents, reason) {
  const amount = Number(amountCents)
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Enter a positive reversal amount.")
  const normalizedReason = typeof reason === "string" ? reason.trim().slice(0, 500) : ""
  if (!normalizedReason) throw new Error("A reason is required for a payment reversal.")
  return { amountCents: amount, reason: normalizedReason }
}

export async function runOwnerPaymentReversal(role, persist) {
  if (role !== "owner") throw new Error("Owner access is required for payment reversals.")
  return persist()
}
