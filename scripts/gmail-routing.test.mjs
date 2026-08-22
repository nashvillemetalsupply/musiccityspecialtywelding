import assert from "node:assert/strict"
import test from "node:test"
import { extractQuickBooksPaymentFacts, isAuthenticatedIntuitPayment, paymentCompletesInvoice, sentMessageMayStartWork, shouldSkipGmailMessage } from "../lib/gmail-routing.mjs"
import { readableEmailText, stripQuotedReply } from "../lib/gmail-plaintext.mjs"

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

test("provider subdomains, bulk mail, and cold finance pitches never become jobs", () => {
  assert.equal(shouldSkipGmailMessage({ sent: false, categorizedNoise: false, from: "rep@xwf.google.com" }), true)
  assert.equal(shouldSkipGmailMessage({ sent: false, categorizedNoise: false, from: "intuit@eq.intuit.com" }), true)
  assert.equal(shouldSkipGmailMessage({ sent: false, categorizedNoise: false, from: "donotreply@twilio.com" }), true)
  assert.equal(shouldSkipGmailMessage({ sent: false, categorizedNoise: false, from: "news@vendor.example", headers: { "List-Unsubscribe": "<https://vendor.example/unsubscribe>" } }), true)
  assert.equal(shouldSkipGmailMessage({ sent: false, categorizedNoise: false, from: "jake@lender.example", subject: "Funding partnership?" }), true)
})

test("real customer RFQs survive Gmail noise screening", () => {
  assert.equal(shouldSkipGmailMessage({
    sent: false,
    categorizedNoise: false,
    from: "buyer@epsi.com",
    subject: "RFQ for EPSI-TN",
    body: "Please quote the attached stainless parts.",
    headers: {},
  }), false)
  assert.equal(shouldSkipGmailMessage({ sent: true, categorizedNoise: false, from: "donotreply@twilio.com" }), false)
})

test("QuickBooks money requires aligned Google authentication and exact domain boundaries", () => {
  const trusted = "mx.google.com; dkim=pass header.d=notify.intuit.com; spf=pass smtp.mailfrom=payments@intuit.com; dmarc=pass header.from=intuit.com"
  const spoof = "mx.google.com; dkim=pass header.d=intuit.com; spf=pass smtp.mailfrom=pay@intuit.com; dmarc=pass header.from=intuit.com"
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@notify.intuit.com", labels: ["INBOX"], authenticationResults: [trusted], subject: "Payment received: Invoice #1332" }), true)
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@evilintuit.com", labels: ["INBOX"], authenticationResults: [trusted], subject: "Payment received: Invoice #1332" }), false)
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@intuit.com", labels: ["SPAM"], authenticationResults: [trusted], subject: "Payment received: Invoice #1332" }), false)
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@intuit.com", labels: ["INBOX"], authenticationResults: ["mx.google.com; dkim=fail; spf=fail; dmarc=fail", spoof], subject: "Payment received: Invoice #1332" }), false)
})

// Copied out of Show original on two real messages in sales@musiccityspecialtywelding.com
// (invoice #1357, 2026-08-21; deposit notice, 2026-08-21), signatures redacted.
// Gmail writes header.i=, never header.d=. The invented fixture above hid that
// for the life of the feature while production rejected every real receipt.
test("real Gmail receipts on Intuit mail authenticate", () => {
  const invoiceReceipt = 'mx.google.com; dkim=pass header.i=@n.intuit.com header.s=s1 header.b=REDACTED; spf=pass (google.com: domain of bounces+8551759-1cb7-sales=musiccityspecialtywelding.com@sg1.n.intuit.com designates 1.2.3.4 as permitted sender) smtp.mailfrom="bounces+8551759-1cb7-sales=musiccityspecialtywelding.com@sg1.n.intuit.com"; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=notification.intuit.com'
  const depositNotice = 'mx.google.com; dkim=pass header.i=@intuit.com header.s=s1 header.b=REDACTED; spf=pass (google.com: domain of bounce@em8721.intuit.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=bounce@em8721.intuit.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["UNREAD", "CATEGORY_UPDATES", "INBOX"], authenticationResults: [invoiceReceipt], subject: "Payment received: Invoice #1357-(josh@runclubcreative.com)" }), true)
  assert.equal(isAuthenticatedIntuitPayment({ from: "businessservices@intuit.com", labels: ["UNREAD", "CATEGORY_UPDATES", "INBOX"], authenticationResults: [depositNotice], subject: "Money on the way!" }), true)
  // Widening to header.i must not widen the domain boundary.
  const lookalike = invoiceReceipt.replace("header.i=@n.intuit.com", "header.i=@n.intuit.com.payments-verify.net")
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["INBOX"], authenticationResults: [lookalike], subject: "Payment received: Invoice #1357" }), false)
  // Replace only the smtp.mailfrom copy; the SPF parenthetical repeats the domain.
  const spfLookalike = invoiceReceipt.replace('smtp.mailfrom="bounces+8551759-1cb7-sales=musiccityspecialtywelding.com@sg1.n.intuit.com"', 'smtp.mailfrom="bounces@sg1.n.intuit.com.payments-verify.net"')
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["INBOX"], authenticationResults: [spfLookalike], subject: "Payment received: Invoice #1357" }), false)
  const dmarcLookalike = invoiceReceipt.replace("header.from=notification.intuit.com", "header.from=notification.intuit.com.payments-verify.net")
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["INBOX"], authenticationResults: [dmarcLookalike], subject: "Payment received: Invoice #1357" }), false)
  const unsigned = invoiceReceipt.replace("dkim=pass", "dkim=none")
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["INBOX"], authenticationResults: [unsigned], subject: "Payment received: Invoice #1357" }), false)
})

// Codex review, 2026-08-22. The gate used to run three regexes over the whole
// flattened header, so any clause could satisfy another clause's requirement.
// Every fixture here authenticated as Intuit before the header was parsed.
test("a crafted Authentication-Results cannot borrow another clause's result", () => {
  const real = { from: "quickbooks@notification.intuit.com", labels: ["INBOX"], subject: "Payment received: Invoice #1357" }
  // dmarc genuinely failed; the text that satisfied it lived inside the spf value.
  const borrowedDmarc = 'mx.google.com; dkim=pass header.i=@n.intuit.com; spf=pass smtp.mailfrom="dmarc=pass header.from=intuit.com@attacker.example"; dmarc=fail header.from=intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, authenticationResults: [borrowedDmarc] }), false)
  // The SPF parenthetical is free text the sending side influences.
  const borrowedFromComment = 'mx.google.com; dkim=fail header.i=@attacker.example; spf=pass (google.com: dkim=pass header.i=@intuit.com) smtp.mailfrom=bounce@attacker.example; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, authenticationResults: [borrowedFromComment] }), false)
  // intuit.com sitting in the local part is an attacker identity, not an Intuit one.
  const localPartLookalike = 'mx.google.com; dkim=pass header.i=intuit.com@evil.example; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, authenticationResults: [localPartLookalike] }), false)
  // Two dkim clauses must not let the sender choose which one is read.
  const doubled = 'mx.google.com; dkim=fail header.i=@attacker.example; dkim=pass header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, authenticationResults: [doubled] }), false)
  // Only the header Gmail prepended counts; a later sender-supplied copy is unreachable.
  const spoofSecond = 'mx.google.com; dkim=pass header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, authenticationResults: ["mx.google.com; dkim=fail; spf=fail; dmarc=fail", spoofSecond] }), false)
  // An unbalanced comment is malformed, and malformed must fail closed.
  const unbalanced = 'mx.google.com; dkim=pass header.i=@n.intuit.com; spf=pass (unclosed smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, authenticationResults: [unbalanced] }), false)
  // A non-Google authserv-id is never trusted, however well-formed the rest is.
  const wrongAuthserv = 'mx.attacker.example; dkim=pass header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, authenticationResults: [wrongAuthserv] }), false)
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

test("HTML and invisible tracking junk become readable email text", () => {
  const raw = `<!doctype html><html><head><style>.hide{display:none}</style></head><body><!-- tracker --><p>Hello&nbsp;Philippe,</p><div>Please quote <strong>12 brackets</strong>.</div><script>steal()</script><p>You&rsquo;re all set.\u034f\u034f\u200b</p></body></html>`
  assert.equal(readableEmailText(raw), "Hello Philippe,\nPlease quote 12 brackets.\nYou’re all set.")
})
