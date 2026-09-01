"use client"

import { useActionState, useEffect, useRef } from "react"
import { recordPaymentState, type OpsActionState } from "../../actions"
import { SafeSubmitButton } from "../../safe-action-controls"

const INITIAL_STATE: OpsActionState = { status: "idle", message: "" }

export function PaymentForm({ leadId, receiptKey, paidAmountCents, invoiceTotalCents, paidAt }: { leadId: number; receiptKey: string; paidAmountCents: number; invoiceTotalCents: number | null; paidAt: string | null }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action] = useActionState(recordPaymentState, INITIAL_STATE)

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset()
  }, [state.status])

  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)

  return <form ref={formRef} action={action} className="job-payment-form">
    <input type="hidden" name="leadId" value={leadId} />
    <input type="hidden" name="receiptKey" value={receiptKey} />
    <label htmlFor="payment-amount">Amount received</label>
    <input id="payment-amount" name="paymentAmount" inputMode="decimal" autoComplete="transaction-amount" placeholder="0.00" required aria-required="true" />
    <label htmlFor="payment-method">Payment method</label>
    <select id="payment-method" name="paymentMethod" defaultValue="cash">
      <option value="cash">Cash</option>
      <option value="check">Check</option>
      <option value="card">Card</option>
      <option value="other">Other</option>
    </select>
    <label className="job-check job-payment-settles">
      <input type="checkbox" name="settles" value="1" />
      Mark remaining balance paid in full
    </label>
    <SafeSubmitButton className="btn btn--sm btn--go" pendingLabel="Recording…">Record payment</SafeSubmitButton>
    {state.message && <p className={`job-action-result is-${state.status}`} role={state.status === "error" ? "alert" : "status"} aria-live="polite">{state.message}</p>}
    <small>Use this for cash, checks, or payments taken outside QuickBooks. A GoPayment receipt files itself; do not enter it twice. Payment does not finish or close the job.</small>
    {paidAmountCents > 0 && <span className="job-current t-caption">
      {paidAt
        ? "Balance paid in full"
        : invoiceTotalCents
          ? `${money(Math.max(0, invoiceTotalCents - paidAmountCents))} still out`
          : "Payment recorded; balance is not marked paid in full"}
    </span>}
  </form>
}
