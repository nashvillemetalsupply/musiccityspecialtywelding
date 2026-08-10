export const GMAIL_NOISE_DOMAINS = [
  "linkedin.com",
  "tiktok.com",
  "alibaba.com",
  "google.com",
  "musiccityspecialtywelding.com",
]

export function shouldSkipGmailMessage({ sent, categorizedNoise, from }) {
  if (sent) return false
  if (categorizedNoise) return true
  const address = String(from || "").toLowerCase()
  return GMAIL_NOISE_DOMAINS.some((domain) => address.endsWith(`@${domain}`))
}

function domainFromAddress(address) {
  return String(address || "").toLowerCase().split("@").at(-1) || ""
}

function isIntuitDomain(domain) {
  return domain === "intuit.com" || domain.endsWith(".intuit.com")
}

export function looksLikeIntuitPaymentEnvelope({ from, subject = "", body = "" }) {
  const domain = domainFromAddress(from)
  return domain.includes("intuit") && /(?:payment received|money on the way)/i.test(`${subject}\n${body}`)
}

export function isAuthenticatedIntuitPayment({ from, labels = [], authenticationResults = "", subject = "", body = "" }) {
  const fromDomain = domainFromAddress(from)
  if (!isIntuitDomain(fromDomain)) return false
  if (labels.some((label) => label === "SPAM" || label === "TRASH")) return false
  if (!/(?:payment received|money on the way)/i.test(`${subject}\n${body}`)) return false
  const authValues = Array.isArray(authenticationResults) ? authenticationResults : [authenticationResults]
  // Gmail prepends its own result. Trust only the first mx.google.com authserv-id;
  // never a later sender-supplied duplicate Authentication-Results header.
  const auth = String(authValues.find((value) => /^\s*mx\.google\.com\s*;/i.test(String(value))) || "").toLowerCase()
  if (!auth) return false
  const dkimPass = /\bdkim=pass\b/.test(auth) && /\bheader\.d=(?:[a-z0-9-]+\.)*intuit\.com\b/.test(auth)
  const spfPass = /\bspf=pass\b/.test(auth) && /\bsmtp\.mailfrom=[^\s;@]+@(?:[a-z0-9-]+\.)*intuit\.com\b/.test(auth)
  const dmarcPass = /\bdmarc=pass\b/.test(auth) && /\bheader\.from=(?:[a-z0-9-]+\.)*intuit\.com\b/.test(auth)
  return dkimPass && spfPass && dmarcPass
}

export function paymentCompletesInvoice({ text = "", amountCents = null, invoiceTotalCents = null, priorPaidCents = 0 }) {
  if (/\b(?:paid in full|payment status\s*:\s*paid|invoice(?:\s*#?[a-z0-9-]+)?\s+(?:is|has been)\s+paid)\b/i.test(text)) return true
  if (/\b(?:balance due|remaining balance)\s*:?\s*\$?0(?:\.00)?\b/i.test(text)) return true
  const payment = Number(amountCents)
  const total = Number(invoiceTotalCents)
  const prior = Number(priorPaidCents) || 0
  return Number.isFinite(payment) && payment > 0 && Number.isFinite(total) && total > 0 && prior + payment >= total
}

function labeledCents(text, labels) {
  const label = labels.join("|")
  const match = String(text).match(new RegExp(`(?:${label})\\s*:?\\s*\\$\\s*([\\d,]+(?:\\.\\d{2})?)`, "i"))
  return match ? Math.round(Number(match[1].replace(/,/g, "")) * 100) : null
}

export function extractQuickBooksPaymentFacts({ subject = "", body = "" }) {
  const text = `${subject}\n${body}`
  const invoiceNumber = text.match(/Invoice\s*#?\s*([A-Za-z0-9-]+)/i)?.[1] ?? null
  const verifiedReceiptAmount = text.match(/\$\s*([\d,]+(?:\.\d{2})?)\s*Payment has been received/i)?.[1]
  const paymentAmountCents = labeledCents(text, ["payment amount", "amount paid", "payment received"])
    ?? (verifiedReceiptAmount ? Math.round(Number(verifiedReceiptAmount.replace(/,/g, "")) * 100) : null)
  const invoiceTotalCents = labeledCents(text, ["invoice total", "total amount", "invoice amount"])
  const balanceCents = labeledCents(text, ["balance due", "remaining balance"])
  return { invoiceNumber, paymentAmountCents, invoiceTotalCents, balanceCents }
}

export function sentMessageMayStartWork({ subject = "", body = "" }) {
  const text = `${subject}\n${body}`
  const work = /\b(?:weld(?:ing)?|fabricat(?:e|ion)|repair|trailer|railing|gate|bracket|equipment|rfq|request for quote|estimate)\b/i.test(text)
  const commercialReply = /^\s*re:/i.test(subject) && /\b(?:quote|rfq|weld|repair|fabricat)/i.test(subject)
  const pricedOffer = /\$\s*\d/.test(text) && /\b(?:quote|price|each|per piece|labor|material|weld|repair|fabricat)/i.test(text)
  return commercialReply || (work && pricedOffer)
}
