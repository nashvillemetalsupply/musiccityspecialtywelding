const EVENT_LABELS: Record<string, string> = {
  "attachment.added": "File added",
  "attachment.needs-help": "File needs attention",
  "call.answered": "Customer call",
  "call.in": "Customer call",
  "call.missed": "Missed call",
  "call.out": "Shop call",
  "call.out.failed": "Shop call failed",
  "call.recording": "Call recording",
  "call.transcript": "Call notes",
  "claim.corrected": "Job detail corrected",
  "contact.captured": "Contact added",
  "contact.first-response": "Customer contacted",
  "contact.logged": "Customer contacted",
  "email.accepted": "Shop email sent",
  "email.delivered": "Shop email delivered",
  "email.failed": "Shop email failed",
  "email.in": "Customer email",
  "email.out": "Shop email",
  "form.quote": "Quote request",
  "glass.closed": "Customer Page closed",
  "glass.created": "Customer Page created",
  "glass.revoked": "Customer Page turned off",
  "glass.rotated": "Customer Page link replaced",
  "glass.uploaded": "Customer files added",
  "invoice.paid": "Payment received",
  "invoice.payment-received": "Payment received",
  "job.completed": "Job finished",
  "job.completion-undone": "Finish undone",
  "job.handed-off": "Customer handoff complete",
  "job.handoff-undone": "Customer handoff undone",
  "note.text": "Job note",
  "note.voice": "Voice note",
  "promise.closed": "Promise closed",
  "promise.created": "Promise added",
  "promise.kept": "Promise kept",
  "quote.capture-rejected": "Quote suggestion dismissed",
  "quote.confirmed": "Quote confirmed",
  "sms.in": "Customer text",
  "sms.out": "Shop text",
  "status.changed": "Job status changed",
}

const JOB_STATUS_LABELS: Record<string, string> = {
  new: "New job",
  contacted: "Customer contacted",
  qualified: "Pricing next",
  quoted: "Quote sent",
  won: "Booked",
  lost: "Closed",
  spam: "Not a job",
}

const CLAIM_LABELS: Record<string, string> = {
  address: "Jobsite",
  company: "Company",
  contact_active_confirmed: "Contact confirmed",
  contact_departure_candidate: "Contact may have changed",
  contact_successor: "New contact",
  contact_successors: "New contacts",
  customer_name: "Customer",
  deadline: "Date that matters",
  dimensions: "Measurements",
  equipment: "Equipment",
  gate_code: "Gate code",
  material: "Material",
  measurement: "Measurement",
  po_number: "PO number",
  scheduling_note: "Scheduling note",
  service: "Service",
  site_contact: "Site contact",
}

export function shopClaimLabel(predicate: string) {
  return CLAIM_LABELS[predicate.trim().toLowerCase()] ?? "Saved detail"
}

function usefulClaimPrimitive(value: unknown) {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return ""
}

export function shopClaimText(value: unknown): string {
  const direct = usefulClaimPrimitive(value)
  if (direct) return direct
  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        const primitive = usefulClaimPrimitive(item)
        if (primitive) return primitive
        if (!item || typeof item !== "object") return ""
        const object = item as Record<string, unknown>
        return ["display_name", "name", "company", "email", "phone", "summary", "value"]
          .map((key) => usefulClaimPrimitive(object[key]))
          .find(Boolean) ?? ""
      })
      .filter(Boolean)
    if (items.length) return items.join(", ")
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    const preferred = ["display_name", "name", "company", "email", "phone", "summary", "value"]
      .map((key) => usefulClaimPrimitive(object[key]))
      .find(Boolean)
    if (preferred) return preferred
  }
  return "Details saved in the job record."
}

export function shopJobStatusLabel(status: string) {
  return JOB_STATUS_LABELS[status] ?? "Job update"
}

const DELIVERY_LABELS: Record<string, string> = {
  pending: "Waiting for delivery",
  filed: "Filed",
  queued: "Sending",
  accepted: "Sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  delayed: "Delayed",
  failed: "Failed",
  undelivered: "Not delivered",
  resolved: "Handled",
}

export function shopDeliveryLabel(status: string) {
  return DELIVERY_LABELS[status] ?? "Delivery update"
}

const SOURCE_LABELS: Record<string, string> = {
  website: "Website",
  "phone-in": "Phone call",
  "twilio-call": "Phone call",
  walkin: "Walk-in",
  "walk-in": "Walk-in",
  "twilio-sms": "Text message",
  gmail: "Email",
  email: "Email",
  google: "Google",
  referral: "Referral",
  manual: "Added at the shop",
}

export function shopSourceLabel(source: string) {
  return SOURCE_LABELS[source.trim().toLowerCase()] ?? "Other"
}

export function shopEventLabel(kind: string) {
  const exact = EVENT_LABELS[kind]
  if (exact) return exact
  if (kind.startsWith("call.")) return "Call update"
  if (kind.startsWith("sms.")) return "Text update"
  if (kind.startsWith("email.")) return "Email update"
  if (kind.startsWith("glass.")) return "Customer Page update"
  if (kind.startsWith("invoice.") || kind.startsWith("payment.")) return "Payment update"
  if (kind.startsWith("promise.") || kind.startsWith("commitment.")) return "Promise update"
  if (kind.startsWith("attachment.")) return "File update"
  if (kind.startsWith("contact.")) return "Customer contact"
  return "Job update"
}

export function withoutEvidenceMarkers(value: string) {
  return value
    .replace(/\s*\[e:\d+\]/gi, "")
    .replace(/\s*\[(?:e(?::\d*)?)?$/i, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim()
}
