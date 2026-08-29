import type { CommitmentRow } from "@/lib/commitments"
import type { EventRow } from "@/lib/events"
import type { OperatorRole } from "@/lib/operators"
import {
  eventIsOwnerOnly,
  OWNER_ONLY_EVENT_KINDS,
  OWNER_ONLY_EVENT_NAMESPACE_PATTERN,
  OWNER_ONLY_EVENT_SENSITIVITIES,
} from "@/lib/event-visibility.mjs"

export {
  OWNER_ONLY_EVENT_KINDS,
  OWNER_ONLY_EVENT_NAMESPACE_PATTERN,
  OWNER_ONLY_EVENT_SENSITIVITIES,
}

const CREW_SAFE_CLAIM_PREDICATES = new Set([
  "address", "deadline", "gate_code", "material", "measurement", "dimensions",
  "finish", "color", "quantity", "service", "job_description", "access",
  "site_contact", "contact_successor", "contact_successors", "company",
  "customer_name", "equipment", "scheduling_note", "po_number",
])

const OWNER_LEGACY_EVENTS = new Set([
  "estimate_saved", "estimate_emailed", "outcome_saved", "invoice_recorded", "invoice_cleared",
])

export function redactCrewText(value: string) {
  return String(value || "")
    .replace(/\$\s*[\d,.]+(?:\s*(?:k|m|dollars?|bucks?))?/gi, "[owner-only money]")
    .replace(/\b\d[\d,.]*\s*(?:dollars?|bucks?)\b/gi, "[owner-only money]")
    .replace(/\b((?:invoice|inv|quote|estimate|price|paid|payment|deposit|budget|hourly\s+rate|rate|balance|total|revenue|cost|margin)(?:\s+(?:number|no\.?|is|was|of|due))?\s*[:#-]?)\s*[A-Z0-9$.,-]+/gi, "$1 [owner-only]")
}

export function projectEventForRole(event: EventRow, role: OperatorRole): EventRow | null {
  if (role === "owner") return event
  // The events table has two generated tsvector columns; tsv indexes the
  // owner body. Both are search internals and would leak owner-body lexemes
  // into every crew projection, so strip them once here and spread `safe` in
  // every crew branch below. The owner early-return above stays untouched.
  const safe = { ...event } as EventRow & { tsv?: unknown; crew_tsv?: unknown }
  delete safe.tsv
  delete safe.crew_tsv
  if (eventIsOwnerOnly(event.kind, event.detail)) return null
  if (event.kind === "brief.morning") {
    const crewBody = typeof event.detail?.crewBody === "string"
      ? event.detail.crewBody
      : "Your due work is waiting in Jobs."
    return { ...safe, body: crewBody, crew_body: crewBody, detail: null }
  }
  if (event.kind === "email.attachments") {
    const attachments = Array.isArray(event.detail?.attachments)
      ? event.detail.attachments.flatMap((raw, index) => {
        const item = raw as { pathname?: unknown; name?: unknown; contentType?: unknown; sensitivity?: unknown }
        const contentType = typeof item.contentType === "string" ? item.contentType : "application/octet-stream"
        const sensitivity = typeof item.sensitivity === "string" ? item.sensitivity : "unclassified"
        const isImage = sensitivity === "photo"
        const isDrawing = sensitivity === "drawing"
        if (!isImage && !isDrawing) return []
        return [{ pathname: item.pathname, contentType, sensitivity, name: isImage ? `Customer photo ${index + 1}` : `Customer drawing ${index + 1}` }]
      })
      : []
    const body = attachments.length ? `${attachments.length} customer photo or drawing ${attachments.length === 1 ? "was" : "were"} filed.` : "Owner paperwork filed from email."
    return { ...safe, body: redactCrewText(body), crew_body: redactCrewText(body), detail: { attachments } }
  }
  if (["email.accepted", "email.failed", "email.unknown", "email.delivered"].includes(event.kind)) {
    const body = event.kind === "email.failed"
      ? "Email did not deliver."
      : event.kind === "email.unknown"
        ? "Email may have sent. Check delivery before retrying."
        : event.kind === "email.accepted"
          ? "Email accepted for delivery."
          : "Email delivered."
    return { ...safe, body: redactCrewText(event.crew_body || body), detail: { sourceEventId: event.detail?.sourceEventId ?? null, providerType: event.detail?.providerType ?? null } }
  }
  if (event.kind === "email.out") {
    return { ...safe, body: redactCrewText(event.crew_body || "Shop email saved. MCSW Jobs is preparing the crew-safe copy."), detail: { deliveryStatus: event.detail?.deliveryStatus ?? "pending" } }
  }
  if (event.kind === "job.completed") {
    return { ...safe, body: redactCrewText(event.crew_body || "Closeout note recorded. MCSW Jobs is preparing the crew-safe copy."), detail: { operatorName: event.detail?.operatorName ?? null, noteSource: event.detail?.noteSource ?? null } }
  }
  return {
    ...safe,
    body: redactCrewText(event.crew_body || "Update recorded. MCSW Jobs is preparing the crew-safe copy."),
    detail: null,
  }
}

export function projectCommitmentForRole(commitment: CommitmentRow, role: OperatorRole): CommitmentRow {
  if (role === "owner") return commitment
  return {
    ...commitment,
    summary: redactCrewText(commitment.crew_summary || "Promise detail is owner-only until MCSW Jobs prepares a crew-safe copy."),
  }
}

export function claimVisibleToRole(predicate: string, role: OperatorRole) {
  if (role === "owner") return true
  return CREW_SAFE_CLAIM_PREDICATES.has(predicate.toLowerCase())
}

const OWNER_ONLY_VALUE_KEY = /(price|quote|invoice|pay|paid|amount|deposit|budget|rate|balance|total|revenue|cost|margin)/i
const CURRENCY_MARKER = /\$|\b(?:usd|dollars?|bucks?|cents?)\b/i

function containsMoneyMarker(value: unknown): boolean {
  if (typeof value === "string") return CURRENCY_MARKER.test(value)
  if (Array.isArray(value)) return value.some(containsMoneyMarker)
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, item]) => OWNER_ONLY_VALUE_KEY.test(key) || containsMoneyMarker(item))
  }
  return false
}

function projectClaimValue(value: unknown): unknown {
  if (typeof value === "string") return containsMoneyMarker(value) ? "[owner-only money]" : redactCrewText(value)
  if (Array.isArray(value)) return containsMoneyMarker(value) ? "[owner-only money]" : value.map(projectClaimValue)
  if (value && typeof value === "object") {
    if (containsMoneyMarker(value)) return "[owner-only money]"
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      OWNER_ONLY_VALUE_KEY.test(key) ? "[owner-only]" : projectClaimValue(item),
    ]))
  }
  return value
}

export function projectClaimForRole<T extends { predicate: string; value: unknown }>(claim: T, role: OperatorRole): T | null {
  if (!claimVisibleToRole(claim.predicate, role)) return null
  if (role === "owner") return claim
  return { ...claim, value: projectClaimValue(claim.value) }
}

export function legacyEventVisibleToRole(kind: string, role: OperatorRole) {
  return role === "owner" || (
    !OWNER_LEGACY_EVENTS.has(kind)
    && !eventIsOwnerOnly(kind.replace(/_/g, "."), null)
  )
}
