// Rollup math for money in hand. QuickBooks payments arrive with their own
// running total (GREATEST semantics in the ingest); manual payments increment.
export function paymentRollup({ currentPaidCents, amountCents, invoiceTotalCents, settles }) {
  const paidTotalCents = Math.max(0, Math.trunc(Number(currentPaidCents ?? 0))) + Math.trunc(Number(amountCents))
  const fullyPaid = settles === true ||
    (invoiceTotalCents !== null && invoiceTotalCents !== undefined &&
      Number(invoiceTotalCents) > 0 && paidTotalCents >= Number(invoiceTotalCents))
  return { paidTotalCents, fullyPaid }
}
