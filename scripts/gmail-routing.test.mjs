import assert from "node:assert/strict"
import test from "node:test"
import { extractQuickBooksPaymentFacts, isAuthenticatedIntuitPayment, paymentCompletesInvoice, sentMessageMayStartWork, shouldSkipGmailMessage } from "../lib/gmail-routing.mjs"
import { stripQuotedReply } from "../lib/gmail-plaintext.mjs"

test("sales sent mail is never swallowed by the own-domain noise rule", () => {
  assert.equal(shouldSkipGmailMessage({
    sent: true,
    categorizedNoise: false,
    from: "sales@musiccityspecialtywelding.com",
  }), false)
})

test("inbound CRM and promotional noise stays skipped", () => {
  assert.equal(shouldSkipGmailMessage({ sent: false, categorizedNoise: false, from: "alerts@musiccityspecialtywelding.com" }), true)
  assert.equal(shouldSkipGmailMessage({ sent: false, categorizedNoise: true, from: "vendor@example.com" }), true)
  assert.equal(shouldSkipGmailMessage({ sent: false, categorizedNoise: false, from: "dale@example.com" }), false)
})

test("QuickBooks money requires aligned Google authentication and exact domain boundaries", () => {
  const trusted = "mx.google.com; dkim=pass header.d=notify.intuit.com; spf=pass smtp.mailfrom=payments@intuit.com; dmarc=pass header.from=intuit.com"
  const spoof = "mx.google.com; dkim=pass header.d=intuit.com; spf=pass smtp.mailfrom=pay@intuit.com; dmarc=pass header.from=intuit.com"
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@notify.intuit.com", labels: ["INBOX"], authenticationResults: [trusted], subject: "Payment received: Invoice #1332" }), true)
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@evilintuit.com", labels: ["INBOX"], authenticationResults: [trusted], subject: "Payment received: Invoice #1332" }), false)
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@intuit.com", labels: ["SPAM"], authenticationResults: [trusted], subject: "Payment received: Invoice #1332" }), false)
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@intuit.com", labels: ["INBOX"], authenticationResults: ["mx.google.com; dkim=fail; spf=fail; dmarc=fail", spoof], subject: "Payment received: Invoice #1332" }), false)
})

test("partial payments stay open and unknown sent mail must look like sold work", () => {
  assert.equal(paymentCompletesInvoice({ text: "Payment received", amountCents: 20000, invoiceTotalCents: 50000 }), false)
  assert.equal(paymentCompletesInvoice({ text: "Paid in full", amountCents: 20000, invoiceTotalCents: 50000 }), true)
  assert.equal(paymentCompletesInvoice({ text: "Payment received", amountCents: 30000, priorPaidCents: 20000, invoiceTotalCents: 50000 }), true)
  assert.equal(sentMessageMayStartWork({ subject: "Monthly bookkeeping", body: "Attached for your records." }), false)
  assert.equal(sentMessageMayStartWork({ subject: "Re: gate repair quote", body: "$300 to weld the bracket back on." }), true)
})

test("trusted QuickBooks templates expose labeled payment, total, and balance facts", () => {
  assert.deepEqual(extractQuickBooksPaymentFacts({ subject: "Payment received: Invoice #1332", body: "Payment amount: $4,485.00\nInvoice total: $4,485.00\nBalance due: $0.00" }), { invoiceNumber: "1332", paymentAmountCents: 448500, invoiceTotalCents: 448500, balanceCents: 0 })
  assert.deepEqual(extractQuickBooksPaymentFacts({ subject: "Payment received: Invoice 1333", body: "Amount paid: $75.00\nInvoice total: $300.00\nRemaining balance: $225.00" }), { invoiceNumber: "1333", paymentAmountCents: 7500, invoiceTotalCents: 30000, balanceCents: 22500 })
  assert.deepEqual(extractQuickBooksPaymentFacts({ subject: "Payment received: Invoice #1317", body: "$700.00 Payment has been received\nInvoice amount $700.00" }), { invoiceNumber: "1317", paymentAmountCents: 70000, invoiceTotalCents: 70000, balanceCents: null })
  assert.deepEqual(extractQuickBooksPaymentFacts({ subject: "Unfamiliar receipt: Invoice #9", body: "Invoice amount $500.00\nUnlabeled $200.00" }), { invoiceNumber: "9", paymentAmountCents: null, invoiceTotalCents: 50000, balanceCents: null })
})

test("only the newly authored email survives Gmail, Outlook, and mobile reply tails", () => {
  assert.equal(stripQuotedReply("$300 to weld the bracket back on.\n\nOn Fri, Aug 8, 2026 at 9:12 AM\nDale <dale@example.com> wrote:\n> Can you quote it?"), "$300 to weld the bracket back on.")
  assert.equal(stripQuotedReply("We can have it Friday.\r\n\r\n-----Original Message-----\r\nFrom: Dale <dale@example.com>\r\nSent: Thursday\r\nTo: Sales\r\nSubject: Gate\r\nOld promise"), "We can have it Friday.")
  assert.equal(stripQuotedReply("On it.\n\nFrom: Dale <dale@example.com>\nSent: Friday, August 8\nTo: Sales <sales@example.com>\nSubject: RE: Gate\nOld quote $700"), "On it.")
  assert.equal(stripQuotedReply("Photo attached.\nSent from my iPhone\n\n> old message"), "Photo attached.")
})
