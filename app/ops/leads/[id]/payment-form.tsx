"use client"

import { useActionState, useEffect, useRef } from "react"
import { recordPaymentState, type OpsActionState } from "../../actions"
import { SafeSubmitButton } from "../../safe-action-controls"

const INITIAL_STATE: OpsActionState = { status: "idle", message: "" }

export function PaymentForm({ leadId, receiptKey, paidAmountCents, invoiceTotalCents, paidAt }: { leadId: number; receiptKey: string; paidAmountCents: number; invoiceTotalCents: number | null; paidAt: string | null }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState(recordPaymentState, INITIAL_STATE)

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset()
    // A submit that came back rejected puts the keyboard on the first field at fault.
    if (state.status === "error") formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [state.status])

  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)

  return <form ref={formRef} action={action} className="job-payment-form" aria-busy={pending}>
    <input type="hidden" name="leadId" value={leadId} />
    <input type="hidden" name="receiptKey" value={receiptKey} />
    <label htmlFor="payment-amount">Amount received</label>
    <input id="payment-amount" name="paymentAmount" type="text" inputMode="decimal" autoComplete="transaction-amount" placeholder="0.00" required aria-required="true" aria-invalid={state.status === "error" ? "true" : undefined} aria-describedby={`payment-hint${state.message ? " payment-result" : ""}`} />
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
    {state.message && <p id="payment-result" className={`job-action-result is-${state.status}`} role={state.status === "error" ? "alert" : "status"} aria-live="polite">{state.message}</p>}
    <small id="payment-hint">Use this for cash, checks, or payments taken outside QuickBooks. A GoPayment receipt files itself; do not enter it twice. Payment does not finish or close the job.</small>
    {paidAmountCents > 0 && <span className="job-current t-caption">
      {paidAt
        ? "Balance paid in full"
        : invoiceTotalCents
          ? `${money(Math.max(0, invoiceTotalCents - paidAmountCents))} still out`
          : "Payment recorded; balance is not marked paid in full"}
    </span>}
  </form>
}
