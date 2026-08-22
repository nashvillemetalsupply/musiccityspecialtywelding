export const GMAIL_NOISE_DOMAINS = [
  "linkedin.com",
  "tiktok.com",
  "alibaba.com",
  "google.com",
  "intuit.com",
  "twilio.com",
  "musiccityspecialtywelding.com",
]

function addressUsesDomain(address, domain) {
  const senderDomain = domainFromAddress(address)
  return senderDomain === domain || senderDomain.endsWith(`.${domain}`)
}

function isAutomatedOrBulkMail({ from, headers = {} }) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [String(key).toLowerCase(), String(value || "")])
  )
  const localPart = String(from || "").toLowerCase().split("@")[0] || ""
  const autoSubmitted = normalizedHeaders["auto-submitted"]?.trim().toLowerCase() || ""
  const precedence = normalizedHeaders.precedence?.trim().toLowerCase() || ""
  return Boolean(normalizedHeaders["list-unsubscribe"])
    || /^(?:bulk|junk|list)$/.test(precedence)
    || (autoSubmitted && autoSubmitted !== "no")
    || /^(?:do-?not-?reply|no-?reply|mailer-daemon)$/.test(localPart)
}

function looksLikeColdSolicitation({ subject = "", body = "" }) {
  const text = `${subject}\n${body}`
  return /\b(?:business funding|funding partnership|working capital|merchant cash advance|business credit card|prequalified for|book your 1:1 call with your google ads expert)\b/i.test(text)
}

export function shouldSkipGmailMessage({ sent, categorizedNoise, from, subject = "", body = "", headers = {} }) {
  if (sent) return false
  if (categorizedNoise) return true
  if (GMAIL_NOISE_DOMAINS.some((domain) => addressUsesDomain(from, domain))) return true
  return isAutomatedOrBulkMail({ from, headers }) || looksLikeColdSolicitation({ subject, body })
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

// Authentication-Results is a structured header (RFC 8601) and this gate used to
// run regexes across the whole flattened string. That let one clause satisfy
// another's requirement: a sender-influenced SPF comment or quoted local part
// carrying "dmarc=pass header.from=intuit.com" authenticated a message whose real
// dmarc result was fail. Parse the header instead of pattern-matching over it.
function stripComments(value) {
  let out = ""
  let depth = 0
  let quoted = false
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch === "\\") {
      // A backslash only means anything inside a quoted string or a comment. Bare
      // in the header body it is malformed, and malformed fails closed rather than
      // letting "pa\\ss" read as a pass.
      if (!quoted && depth === 0) return null
      if (quoted) out += ch + (value[i + 1] ?? "")
      i += 1
      continue
    }
    if (quoted) {
      if (ch === '"') quoted = false
      out += ch
      continue
    }
    if (ch === '"' && depth === 0) { quoted = true; out += ch; continue }
    if (ch === "(") { depth += 1; continue }
    if (ch === ")") {
      if (depth === 0) return null
      depth -= 1
      out += " "
      continue
    }
    if (depth === 0) out += ch
  }
  return depth === 0 && !quoted ? out : null
}

function splitOnSemicolons(value) {
  const parts = []
  let current = ""
  let quoted = false
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch === "\\") { current += ch + (value[i + 1] ?? ""); i += 1; continue }
    if (quoted) {
      if (ch === '"') quoted = false
      current += ch
      continue
    }
    if (ch === '"') { quoted = true; current += ch; continue }
    if (ch === ";") { parts.push(current); current = ""; continue }
    current += ch
  }
  parts.push(current)
  return parts
}

// Walks the clause left to right instead of scanning for pairs anywhere in it, so
// "x/header.i=@intuit.com" cannot smuggle a property in. Returns null on a
// duplicate key or on leftover text that is not a well-formed pair.
function clauseProperties(clause) {
  const properties = new Map()
  let rest = clause
  while (rest.trim() !== "") {
    const pair = rest.match(/^\s*([a-z0-9._-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s;"]+)(?=\s|$)/i)
    if (!pair) return null
    const key = pair[1].toLowerCase()
    if (properties.has(key)) return null
    let value = pair[2]
    if (value.startsWith('"')) value = value.slice(1, -1).replace(/\\(.)/g, "$1")
    properties.set(key, value)
    rest = rest.slice(pair[0].length)
  }
  return properties
}

// Returns null for anything malformed or ambiguous so every caller fails closed.
function parseAuthenticationResults(raw) {
  const stripped = stripComments(String(raw ?? ""))
  if (stripped === null) return null
  const segments = splitOnSemicolons(stripped)
  const authservId = (segments.shift() ?? "").trim().toLowerCase()
  const methods = new Map()
  for (const segment of segments) {
    if (segment.trim() === "") continue
    // The result token must end at a delimiter, so "pass/garbage" and "pa\\ss" are
    // malformed rather than silently read as "pass".
    const head = segment.match(/^\s*([a-z0-9-]+)\s*=\s*([a-z0-9-]+)(?=\s|$)/i)
    if (!head) return null
    const properties = clauseProperties(segment.slice(head[0].length))
    if (properties === null) return null
    const method = head[1].toLowerCase()
    // A message legitimately carries two DKIM signatures (ESP plus brand), and
    // Gmail reports one clause per signature. Keep them all; spf and dmarc are
    // single by definition, and a second copy of either is someone guessing.
    if (!methods.has(method)) methods.set(method, [])
    else if (method !== "dkim") return null
    methods.get(method).push({ result: head[2].toLowerCase(), properties })
  }
  return { authservId, methods }
}

// "intuit.com@evil.example" is an evil.example identity, not an Intuit one, so the
// domain is always whatever follows the last @ -- never a substring of the value.
function identityDomain(value) {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\.$/, "")
  if (!raw) return ""
  const at = raw.lastIndexOf("@")
  const domain = at >= 0 ? raw.slice(at + 1) : raw
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain) ? domain : ""
}

// Gmail writes dkim=pass only for a signature it actually verified, so one passing
// Intuit-signed clause is the guarantee we want even when other signatures fail.
function methodDomainIsIntuit(methods, method, keys) {
  const clauses = methods.get(method) ?? []
  return clauses.some((clause) => {
    if (clause.result !== "pass") return false
    for (const key of keys) {
      if (!clause.properties.has(key)) continue
      return isIntuitDomain(identityDomain(clause.properties.get(key)))
    }
    return false
  })
}

// The shop's own mail domain. Intuit's DKIM signature covers the To: header --
// its h= tag lists to: and oversigns it -- so a receipt cannot be readdressed
// without breaking the signature.
const SHOP_MAIL_DOMAIN = "musiccityspecialtywelding.com"

// This is what stops a DKIM replay. dkim=pass plus dmarc=pass prove Intuit signed
// the message; they do not prove Intuit sent it HERE. A genuine receipt from an
// attacker's own QuickBooks tenant, with an invoice number they chose, can be
// re-sent to this mailbox with its signed bytes untouched and both checks still
// pass. What it cannot carry is this shop's address in the signed To:.
//
// Every recipient must be at the shop domain, not merely one of them: a second
// To: header appended by whoever replayed the message would otherwise override
// the signed one, since headers collapse last-wins.
function addressedToShop(recipients) {
  const values = (Array.isArray(recipients) ? recipients : [recipients])
    .map((value) => String(value ?? "").trim())
    .filter((value) => value !== "")
  if (values.length === 0) return false
  return values.every((value) => value.split(",").every((part) => {
    const address = part.includes("<") ? part.replace(/^[^<]*</, "").replace(/>.*$/, "") : part
    const trimmed = address.trim().toLowerCase()
    return trimmed !== "" && domainFromAddress(trimmed) === SHOP_MAIL_DOMAIN
  }))
}

export function isAuthenticatedIntuitPayment({ from, labels = [], authenticationResults = "", subject = "", body = "", recipients = [] }) {
  const fromDomain = domainFromAddress(from)
  if (!isIntuitDomain(fromDomain)) return false
  if (labels.some((label) => label === "SPAM" || label === "TRASH")) return false
  if (!/(?:payment received|money on the way)/i.test(`${subject}\n${body}`)) return false
  if (!addressedToShop(recipients)) return false
  const authValues = Array.isArray(authenticationResults) ? authenticationResults : [authenticationResults]
  // Gmail prepends its own result, so only the first header counts. Falling through
  // to a later one hands the decision to whoever wrote the message.
  const parsed = parseAuthenticationResults(authValues[0] ?? "")
  if (!parsed || parsed.authservId !== "mx.google.com") return false
  // Gmail reports the signing identity as header.i=@domain and only emits header.d=
  // when the DKIM signature carries no i= tag. Requiring header.d= alone quarantined
  // all 28 real Intuit receipts between 2026-08-05 and 2026-08-22. RFC 6376 keeps i=
  // inside d=, and dmarc=pass still pins From: alignment.
  // SPF is deliberately not required to be Intuit-aligned. Intuit relays some
  // receipts through Amazon SES, which makes smtp.mailfrom an amazonses.com bounce
  // address while DKIM still carries header.i=@intuit.com -- invoice #1354 was
  // exactly that, and was the one message the 2026-08-22 replay could not recover.
  // Demanding SPF alignment is stricter than DMARC itself and rejects real mail.
  //
  // What is required is the pair that cannot be forged: a DKIM signature that
  // verifies over an intuit.com identity, and dmarc=pass with an intuit.com From:.
  // Together they say Gmail cryptographically verified an Intuit-signed message
  // whose From: aligns. SPF alone is satisfied by anyone who controls a sending
  // host, so it was never the part carrying the guarantee.
  const dkimPass = methodDomainIsIntuit(parsed.methods, "dkim", ["header.i", "header.d"])
  const dmarcPass = methodDomainIsIntuit(parsed.methods, "dmarc", ["header.from"])
  return dkimPass && dmarcPass
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
  // QuickBooks subjects read "Invoice #1357-(customer@example.com)", and the hyphen
  // before the parenthetical was being captured as part of the number. Every one of
  // the 15 receipts replayed on 2026-08-22 recorded "1357-" instead of "1357", which
  // would never have matched a job numbered 1357.
  //
  // Only that one known delimiter is removed, by matching the template shape rather
  // than trimming trailing punctuation: a number really can end in a hyphen, and
  // blindly stripping it would silently point a payment at the wrong job.
  const invoiceNumber = (
    text.match(/Invoice\s*#?\s*([A-Za-z0-9][A-Za-z0-9._/-]*?)-\(/i)?.[1]
    ?? text.match(/Invoice\s*#?\s*([A-Za-z0-9-]+)/i)?.[1]
  ) || null
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
