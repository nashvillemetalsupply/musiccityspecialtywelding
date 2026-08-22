export function paymentRollup(input: {
  currentPaidCents: number | null | undefined
  amountCents: number
  invoiceTotalCents: number | null | undefined
  settles: boolean
}): { paidTotalCents: number; fullyPaid: boolean }
