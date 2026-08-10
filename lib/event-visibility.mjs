export const OWNER_ONLY_EVENT_KINDS = Object.freeze([
  "email.payment",
  "invoice.paid",
  "invoice.recorded",
  "invoice.payment-received",
  "email.deposit",
  "quote.saved",
  "quote.confirmed",
  "lead.invoice.cleared",
  "payment.received",
  "job.outcome",
])

// Financial event producers do not need to remember every crew-facing reader.
// A financial namespace segment is private by default, including future kinds.
export const OWNER_ONLY_EVENT_NAMESPACE_PATTERN =
  "(^|[.:/_-])(invoice|payment|payments|quote|estimate|deposit|revenue|billing|finance|financial)([.:/_-]|$)"

export const OWNER_ONLY_EVENT_SENSITIVITIES = Object.freeze([
  "financial",
  "finance",
  "money",
  "payment",
  "owner-only",
  "owner",
])

const OWNER_ONLY_KIND_SET = new Set(OWNER_ONLY_EVENT_KINDS)
const OWNER_ONLY_NAMESPACE = new RegExp(OWNER_ONLY_EVENT_NAMESPACE_PATTERN, "i")
const OWNER_ONLY_SENSITIVITY_SET = new Set(OWNER_ONLY_EVENT_SENSITIVITIES)

export function eventIsOwnerOnly(kindValue, detailValue) {
  const kind = String(kindValue ?? "").trim().toLowerCase()
  const detail = detailValue && typeof detailValue === "object" ? detailValue : null
  const sensitivity = String(detail?.sensitivity ?? "").trim().toLowerCase()
  return OWNER_ONLY_KIND_SET.has(kind)
    || OWNER_ONLY_NAMESPACE.test(kind)
    || OWNER_ONLY_SENSITIVITY_SET.has(sensitivity)
}
