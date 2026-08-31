import assert from "node:assert/strict"
import test from "node:test"
import { extractQuickBooksPaymentFacts, isAuthenticatedIntuitPayment, paymentCompletesInvoice, sentMessageMayStartWork, shouldSkipGmailMessage } from "../lib/gmail-routing.mjs"
import { readableEmailText, stripQuotedReply } from "../lib/gmail-plaintext.mjs"

// Intuit addresses these to the shop, and its DKIM signature covers To:.
const SHOP = ["sales@musiccityspecialtywelding.com"]

// Shape of the real DKIM-Signature on both sampled receipts: covers to: and
// subject:, no l= tag. Signature bytes redacted.
const SIGS = ["v=1; a=rsa-sha256; c=relaxed/relaxed; d=n.intuit.com; s=s1; h=content-transfer-encoding:content-type:date:from:list-unsubscribe:mime-version:subject:to:cc; b=REDACTED"]

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
  assert.equal(shouldSkipGmailMessage({ sent: false, categorizedNoise: false, from: "paul@supabase.com", subject: "Welcome to Supabase" }), true)
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
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@notify.intuit.com", labels: ["INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [trusted], subject: "Payment received: Invoice #1332" }), true)
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@evilintuit.com", labels: ["INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [trusted], subject: "Payment received: Invoice #1332" }), false)
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@intuit.com", labels: ["SPAM"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [trusted], subject: "Payment received: Invoice #1332" }), false)
  assert.equal(isAuthenticatedIntuitPayment({ from: "notice@intuit.com", labels: ["INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: ["mx.google.com; dkim=fail; spf=fail; dmarc=fail", spoof], subject: "Payment received: Invoice #1332" }), false)
})

// Copied out of Show original on two real messages in sales@musiccityspecialtywelding.com
// (invoice #1357, 2026-08-21; deposit notice, 2026-08-21), signatures redacted.
// Gmail writes header.i=, never header.d=. The invented fixture above hid that
// for the life of the feature while production rejected every real receipt.
test("real Gmail receipts on Intuit mail authenticate", () => {
  const invoiceReceipt = 'mx.google.com; dkim=pass header.i=@n.intuit.com header.s=s1 header.b=REDACTED; spf=pass (google.com: domain of bounces+8551759-1cb7-sales=musiccityspecialtywelding.com@sg1.n.intuit.com designates 1.2.3.4 as permitted sender) smtp.mailfrom="bounces+8551759-1cb7-sales=musiccityspecialtywelding.com@sg1.n.intuit.com"; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=notification.intuit.com'
  const depositNotice = 'mx.google.com; dkim=pass header.i=@intuit.com header.s=s1 header.b=REDACTED; spf=pass (google.com: domain of bounce@em8721.intuit.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=bounce@em8721.intuit.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["UNREAD", "CATEGORY_UPDATES", "INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [invoiceReceipt], subject: "Payment received: Invoice #1357-(josh@runclubcreative.com)" }), true)
  assert.equal(isAuthenticatedIntuitPayment({ from: "businessservices@intuit.com", labels: ["UNREAD", "CATEGORY_UPDATES", "INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [depositNotice], subject: "Money on the way!" }), true)
  // Widening to header.i must not widen the domain boundary.
  const lookalike = invoiceReceipt.replace("header.i=@n.intuit.com", "header.i=@n.intuit.com.payments-verify.net")
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [lookalike], subject: "Payment received: Invoice #1357" }), false)
  // Invoice #1354, the one message the 2026-08-22 replay could not recover, copied
  // from Show original. Intuit relayed it through Amazon SES: two DKIM signatures,
  // and an SPF envelope on amazonses.com rather than intuit.com. Requiring SPF to
  // align with Intuit is stricter than DMARC and rejected a genuine receipt.
  const relayedThroughSes = 'mx.google.com; dkim=pass header.i=@intuit.com header.s=s1 header.b=REDACTED; dkim=pass header.i=@amazonses.com header.s=hsbnp7p3 header.b=REDACTED; spf=pass (google.com: domain of 010101a01fb5ac44-c51e4cfd-501c-4530-ae5f-c2e6933cf873-000000@us-west-2.amazonses.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=010101a01fb5ac44-c51e4cfd-501c-4530-ae5f-c2e6933cf873-000000@us-west-2.amazonses.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["UNREAD", "CATEGORY_UPDATES", "INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [relayedThroughSes], subject: "Payment received: Invoice #1354-(mobilemom18@gmail.com)" }), true)
  // The relay only loosens SPF. A message whose Intuit DKIM signature does not
  // verify is still refused however the envelope was routed.
  const sesButUnsigned = relayedThroughSes.replace("dkim=pass header.i=@intuit.com", "dkim=fail header.i=@intuit.com")
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [sesButUnsigned], subject: "Payment received: Invoice #1354" }), false)
  // And DMARC still has to pass over an Intuit From:.
  const sesButUnaligned = relayedThroughSes.replace("dmarc=pass", "dmarc=fail")
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [sesButUnaligned], subject: "Payment received: Invoice #1354" }), false)
  const dmarcLookalike = invoiceReceipt.replace("header.from=notification.intuit.com", "header.from=notification.intuit.com.payments-verify.net")
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [dmarcLookalike], subject: "Payment received: Invoice #1357" }), false)
  const unsigned = invoiceReceipt.replace("dkim=pass", "dkim=none")
  assert.equal(isAuthenticatedIntuitPayment({ from: "quickbooks@notification.intuit.com", labels: ["INBOX"], recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [unsigned], subject: "Payment received: Invoice #1357" }), false)
})

// Codex review, 2026-08-22, fourth round. dkim=pass and dmarc=pass prove Intuit
// signed the message. They do not prove Intuit sent it to THIS shop. Someone can
// take a real receipt from their own QuickBooks tenant, for an invoice number they
// chose, and re-send the signed bytes here -- both checks still pass. Intuit's h=
// tag covers to: and oversigns it, so the signed recipient is the thing a replay
// cannot change.
test("a genuine receipt addressed to someone else is refused", () => {
  const genuine = 'mx.google.com; dkim=pass header.i=@n.intuit.com header.s=s1 header.b=REDACTED; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  const receipt = { from: "quickbooks@notification.intuit.com", labels: ["INBOX"], dkimSignatures: SIGS, authenticationResults: [genuine], subject: "Payment received: Invoice #1311-(attacker@example.com)" }
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: SHOP }), true)
  // Intuit signed it, but signed it to the attacker's own mailbox.
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ["books@attacker.example"] }), false)
  // An unsigned second To: appended by the replayer must not override the signed one.
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ["sales@musiccityspecialtywelding.com", "books@attacker.example"] }), false)
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ["sales@musiccityspecialtywelding.com, books@attacker.example"] }), false)
  // No recipient at all fails closed rather than skipping the binding.
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: [] }), false)
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: [""] }), false)
  // A lookalike of the shop domain is not the shop.
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ["sales@musiccityspecialtywelding.com.attacker.example"] }), false)
  // Display-name form and casing are still the shop.
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ["MCS Welding <Sales@MusicCitySpecialtyWelding.com>"] }), true)
  // A comma inside a quoted display name is not a recipient separator.
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ['"Welding, Sales" <sales@musiccityspecialtywelding.com>'] }), true)
  // A present-but-empty To: is malformed, not absent.
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ["sales@musiccityspecialtywelding.com", ""] }), false)
  // Codex probe: the shop address hidden inside a quoted display name. Intuit signs
  // this to attacker@example.com; reading the first <...> would call it the shop.
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ['"MCS <sales@musiccityspecialtywelding.com>" <attacker@example.com>'] }), false)
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ['"sales@musiccityspecialtywelding.com" <attacker@example.com>'] }), false)
  // Stray brackets that are not a terminal angle-address are malformed.
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, recipients: ["<sales@musiccityspecialtywelding.com> junk"] }), false)
})

// Authentication-Results reports that a signature passed, never what it covered.
// A signature that leaves to: out of h= could be readdressed after Intuit signed
// it, and an l= body-length tag lets anyone append text the amount parser reads.
// Both sampled receipts cover to: and subject: and carry no l=.
test("an Intuit signature that does not cover the recipient or bounds the body is refused", () => {
  const genuine = 'mx.google.com; dkim=pass header.i=@n.intuit.com header.s=s1 header.b=REDACTED; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  const receipt = { from: "quickbooks@notification.intuit.com", labels: ["INBOX"], recipients: SHOP, authenticationResults: [genuine], subject: "Payment received: Invoice #1357" }
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: SIGS }), true)
  const noTo = SIGS[0].replace(":subject:to:cc", ":subject:cc")
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [noTo] }), false)
  const noSubject = SIGS[0].replace("mime-version:subject:to", "mime-version:to")
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [noSubject] }), false)
  const lengthBounded = SIGS[0].replace("; b=REDACTED", "; l=1024; b=REDACTED")
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [lengthBounded] }), false)
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [] }), false)
  // A well-formed signature from someone else is not an Intuit signature.
  const otherSigner = SIGS[0].replace("d=n.intuit.com", "d=attacker.example")
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [otherSigner] }), false)
  // The SES co-signature rides along; Intuit's own must still be fully bound.
  const ses = "v=1; a=rsa-sha256; c=relaxed/simple; d=amazonses.com; s=hsbnp7p3; h=subject:from:to; b=REDACTED"
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [SIGS[0], ses] }), true)
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [noTo, ses] }), false)
  // Codex probe: RFC 6376 permits whitespace around "=", so matching "l=" literally
  // missed "l = 1024", and matching "d=" missed a weak "d = n.intuit.com" signature
  // that then escaped the coverage rule entirely.
  const spacedLength = SIGS[0].replace("; b=REDACTED", "; l = 1024; b=REDACTED")
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [spacedLength] }), false)
  const spacedWeak = noTo.replace("d=n.intuit.com", "d = n.intuit.com")
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [spacedWeak, SIGS[0]] }), false)
  // A repeated tag is malformed, so that signature is not read as Intuit's.
  const repeated = SIGS[0].replace("s=s1;", "s=s1; d=attacker.example;")
  assert.equal(isAuthenticatedIntuitPayment({ ...receipt, dkimSignatures: [repeated] }), false)
})

// Codex review, 2026-08-22. The gate used to run three regexes over the whole
// flattened header, so any clause could satisfy another clause's requirement.
// Every fixture here authenticated as Intuit before the header was parsed.
test("a crafted Authentication-Results cannot borrow another clause's result", () => {
  const real = { from: "quickbooks@notification.intuit.com", labels: ["INBOX"], recipients: SHOP, dkimSignatures: SIGS, subject: "Payment received: Invoice #1357" }
  // dmarc genuinely failed; the text that satisfied it lived inside the spf value.
  const borrowedDmarc = 'mx.google.com; dkim=pass header.i=@n.intuit.com; spf=pass smtp.mailfrom="dmarc=pass header.from=intuit.com@attacker.example"; dmarc=fail header.from=intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [borrowedDmarc] }), false)
  // The SPF parenthetical is free text the sending side influences.
  const borrowedFromComment = 'mx.google.com; dkim=fail header.i=@attacker.example; spf=pass (google.com: dkim=pass header.i=@intuit.com) smtp.mailfrom=bounce@attacker.example; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [borrowedFromComment] }), false)
  // intuit.com sitting in the local part is an attacker identity, not an Intuit one.
  const localPartLookalike = 'mx.google.com; dkim=pass header.i=intuit.com@evil.example; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [localPartLookalike] }), false)
  // Two DKIM signatures are normal (ESP plus brand) and Gmail writes one clause per
  // signature, so a verified Intuit signature counts even beside a failed one.
  // Rejecting duplicate methods outright would have re-broken real receipts.
  const twoSignatures = 'mx.google.com; dkim=fail header.i=@esp.example; dkim=pass header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [twoSignatures] }), true)
  // No DKIM signature from Intuit at all, however many others verified.
  const noIntuitSignature = 'mx.google.com; dkim=pass header.i=@esp.example; dkim=fail header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [noIntuitSignature] }), false)
  // spf and dmarc are single by definition; a second copy is someone guessing.
  const doubledSpf = 'mx.google.com; dkim=pass header.i=@intuit.com; spf=fail smtp.mailfrom=bounce@attacker.example; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [doubledSpf] }), false)
  // A result token has to end at a delimiter, and a bare backslash is malformed.
  const suffixedResult = 'mx.google.com; dkim=pass/garbage header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [suffixedResult] }), false)
  const escapedResult = 'mx.google.com; dkim=pa\\ss header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [escapedResult] }), false)
  // A property has to start at a boundary, not ride along inside another token.
  const smuggledProperty = 'mx.google.com; dkim=pass x/header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [smuggledProperty] }), false)
  // Repeating a property inside one clause must not let the first copy win.
  const duplicateProperty = 'mx.google.com; dkim=pass header.i=@intuit.com header.i=@attacker.example; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [duplicateProperty] }), false)
  // Only the header Gmail prepended counts; a later sender-supplied copy is unreachable.
  const spoofSecond = 'mx.google.com; dkim=pass header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: ["mx.google.com; dkim=fail; spf=fail; dmarc=fail", spoofSecond] }), false)
  // An unbalanced comment is malformed, and malformed must fail closed.
  const unbalanced = 'mx.google.com; dkim=pass header.i=@n.intuit.com; spf=pass (unclosed smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [unbalanced] }), false)
  // A non-Google authserv-id is never trusted, however well-formed the rest is.
  const wrongAuthserv = 'mx.attacker.example; dkim=pass header.i=@intuit.com; spf=pass smtp.mailfrom=bounce@sg1.n.intuit.com; dmarc=pass header.from=notification.intuit.com'
  assert.equal(isAuthenticatedIntuitPayment({ ...real, recipients: SHOP, dkimSignatures: SIGS, authenticationResults: [wrongAuthserv] }), false)
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

// Every subject above is invented, and every real one names the customer after the
// number: "Invoice #1357-(josh@runclubcreative.com)". The separating hyphen was
// captured as part of the number, so all 15 receipts replayed on 2026-08-22 recorded
// "1357-" -- which would never match a job numbered 1357. Same shape of miss as the
// header.d fixture: the test agreed with the code instead of with the mailbox.
test("the customer parenthetical in a real subject is not part of the invoice number", () => {
  const number = (subject) => extractQuickBooksPaymentFacts({ subject, body: "$54.88 Payment has been received" }).invoiceNumber
  assert.equal(number("Payment received: Invoice #1357-(josh@runclubcreative.com)"), "1357")
  assert.equal(number("Payment received: Invoice #1348-(concrete strategies)"), "1348")
  assert.equal(number("Payment received: Invoice #1345-(BRUCE HEIGHTS)"), "1345")
  // A hyphen inside the number belongs to it; only a trailing separator is trimmed.
  assert.equal(number("Payment received: Invoice #INV-1357-(a@b.com)"), "INV-1357")
  assert.equal(number("Payment received: Invoice #1332"), "1332")
  // Only the template's delimiter goes. A number that really ends in a hyphen keeps
  // it, because pointing a payment at the wrong job is worse than an odd-looking id.
  assert.equal(number("Payment received: Invoice #INV-1357-"), "INV-1357-")
  assert.equal(number("Payment received: Invoice #2024.11-(a@b.com)"), "2024.11")
  assert.equal(number("Payment received: Invoice #JOB_88-(a@b.com)"), "JOB_88")
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
