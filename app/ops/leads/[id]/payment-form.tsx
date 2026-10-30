"use client"

import { useId, useActionState, useEffect, useRef, useState } from "react"
import { recordPaymentState, reversePaymentState, type OpsActionState } from "../../actions"
import { SafeSubmitButton } from "../../safe-action-controls"

const INITIAL_STATE: OpsActionState = { status: "idle", message: "" }

export function PaymentForm({ leadId, receiptKey, reversalKey: initialReversalKey, paidAmountCents, invoiceTotalCents, paidAt }: { leadId: number; receiptKey: string; reversalKey: string; paidAmountCents: number; invoiceTotalCents: number | null; paidAt: string | null }) {
  const instanceId = useId()
  const domId = (name: string) => `${name}-${instanceId}`
  const formRef = useRef<HTMLFormElement>(null)
  const reversalFormRef = useRef<HTMLFormElement>(null)
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("cash")
  const [settles, setSettles] = useState(false)
  const [reversalAmount, setReversalAmount] = useState("")
  const [reversalReason, setReversalReason] = useState("")
  const [reversalKey, setReversalKey] = useState(initialReversalKey)
  const [state, action, pending] = useActionState(async (previous: OpsActionState, data: FormData) => {
    const result = await recordPaymentState(previous, data)
    if (result.status === "success") {
      setAmount("")
      setMethod("cash")
      setSettles(false)
    }
    return result
  }, INITIAL_STATE)
  const [reversalState, reverseAction, reversing] = useActionState(async (previous: OpsActionState, data: FormData) => {
    const result = await reversePaymentState(previous, data)
    if (result.status === "success") {
      setReversalAmount("")
      setReversalReason("")
      setReversalKey(crypto.randomUUID())
    }
    return result
  }, INITIAL_STATE)
  const busy = pending || reversing

  useEffect(() => {
    // A submit that came back rejected puts the keyboard on the first field at fault.
    if (state.status === "error") formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [state])

  useEffect(() => {
    if (reversalState.status === "error") reversalFormRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [reversalState])

  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)

  return <div className="job-payment-workflow"><form ref={formRef} action={action} onReset={(event) => event.preventDefault()} className="job-payment-form" aria-busy={pending}>
    <input type="hidden" name="leadId" value={leadId} />
    <input type="hidden" name="receiptKey" value={receiptKey} />
    <label htmlFor={domId("payment-amount")}>Amount received</label>
    <input id={domId("payment-amount")} name="paymentAmount" value={amount} onChange={(event) => setAmount(event.target.value)} readOnly={busy} type="text" inputMode="decimal" autoComplete="transaction-amount" placeholder="0.00" required aria-required="true" aria-invalid={state.status === "error" ? "true" : undefined} aria-describedby={`${domId("payment-hint")}${state.message ? ` ${domId("payment-result")}` : ""}`} />
    <label htmlFor={domId("payment-method")}>Payment method</label>
    <select id={domId("payment-method")} name="paymentMethod" disabled={busy} value={method} onChange={(event) => setMethod(event.target.value)}>
      <option value="cash">Cash</option>
      <option value="check">Check</option>
      <option value="card">Card</option>
      <option value="other">Other</option>
    </select>
    <label className="job-check job-payment-settles">
      <input type="checkbox" disabled={busy} name="settles" value="1" checked={settles} onChange={(event) => setSettles(event.target.checked)} />
      Mark remaining balance paid in full
    </label>
    <SafeSubmitButton className="btn btn--sm btn--go" disabled={busy} pendingLabel="Recording…">Record payment</SafeSubmitButton>
    {state.message && <p id={domId("payment-result")} className={`job-action-result is-${state.status}`} role={state.status === "error" ? "alert" : "status"} aria-live="polite">{state.message}</p>}
    <small id={domId("payment-hint")}>Use this for cash, checks, or payments taken outside QuickBooks. A GoPayment receipt files itself; do not enter it twice. Payment does not finish or close the job.</small>
    {paidAmountCents > 0 && <span className="job-current t-caption">
      {paidAt
        ? "Balance paid in full"
        : invoiceTotalCents
          ? `${money(Math.max(0, invoiceTotalCents - paidAmountCents))} still out`
          : "Payment recorded; balance is not marked paid in full"}
    </span>}
  </form>
  {paidAmountCents > 0 && <form ref={reversalFormRef} action={reverseAction} onReset={(event) => event.preventDefault()} className="job-payment-reversal" aria-busy={reversing}>
    <input type="hidden" name="leadId" value={leadId} />
    <input type="hidden" name="reversalKey" value={reversalKey} />
    <strong>Record a refund or payment correction</strong>
    <label htmlFor={domId("payment-reversal-amount")}>Amount reversed</label>
    <input id={domId("payment-reversal-amount")} name="reversalAmount" value={reversalAmount} onChange={(event) => setReversalAmount(event.target.value)} readOnly={busy} type="text" inputMode="decimal" placeholder="0.00" required aria-required="true" aria-invalid={reversalState.status === "error" ? "true" : undefined} aria-describedby={`${domId("reversal-hint")}${reversalState.message ? ` ${domId("reversal-result")}` : ""}`} />
    <label htmlFor={domId("payment-reversal-reason")}>Reason</label>
    <textarea id={domId("payment-reversal-reason")} name="reason" value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} readOnly={busy} rows={2} maxLength={500} required aria-required="true" aria-invalid={reversalState.status === "error" ? "true" : undefined} aria-describedby={`${domId("reversal-hint")}${reversalState.message ? ` ${domId("reversal-result")}` : ""}`} />
    <SafeSubmitButton className="btn btn--sm btn--edge" disabled={busy} pendingLabel="Recording…">Record payment reversal</SafeSubmitButton>
    {reversalState.message && <p id={domId("reversal-result")} className={`job-action-result is-${reversalState.status}`} role={reversalState.status === "error" ? "alert" : "status"} aria-live="polite">{reversalState.message}</p>}
    <small id={domId("reversal-hint")}>Use after the refund or correction is completed with the payment provider. The amount cannot exceed the current net paid total of {money(paidAmountCents)}.</small>
  </form>}
  </div>
}
