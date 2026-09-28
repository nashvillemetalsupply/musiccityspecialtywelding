import type { GlassStageJob } from "./shop-brain-invariants-types.ts"
export type { GlassStageJob } from "./shop-brain-invariants-types.ts"

export type InboundAttachmentSensitivity = "photo" | "drawing" | "owner_paperwork" | "unclassified"

export type TwilioConsentKeyword = "STOP" | "START" | "HELP"

export type BoardSignalKind = "waiting" | "noreply" | "promise" | "followup" | "bounced"

export function normalizeUsPhone(value: unknown) : string {
  const raw = String(value ?? "").trim()
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return ""
}

// US numeric short codes are 5 or 6 digits after optional punctuation (for
// example Instagram's 32665). They are sender infrastructure -- Twilio, Meta,
// banks -- never customer identities, and normalizeUsPhone would reject them.
// Any short-code sender is system SMS, no matter what the body says.
export function isUsNumericShortCode(value: unknown) : boolean {
  const raw = String(value ?? "").trim()
  if (!raw || /[a-z]/i.test(raw)) return false
  const digits = raw.replace(/\D/g, "")
  return digits.length === 5 || digits.length === 6
}

// Meta/Instagram verification texts arrive from ordinary long codes, so the
// body is the only signal. Both the brand and code language must be present;
// either alone is not enough -- a customer praising Instagram is not a
// security event, and an unrelated "your code is" text is not Meta's.
const META_BRAND_PATTERN = /\b(?:instagram|meta)\b/i
const META_CODE_PATTERN = /\b(?:verification code|security code|login code|code is|is your [a-z]+ code|confirm it.s you)\b/i

export function isMetaVerificationSms(body: unknown) : boolean {
  const text = String(body ?? "").slice(0, 500)
  if (!text) return false
  return META_BRAND_PATTERN.test(text) && META_CODE_PATTERN.test(text)
}

// Test status is a partition boundary, so every independent marker is
// authoritative. A false projection must never mask a true receipt/person
// marker through first-non-null selection.
export function isInternalTestContext(...markers: unknown[]) : boolean {
  return markers.some((marker) => {
    if (marker === true || marker === 1) return true
    if (typeof marker !== "string") return false
    const value = marker.trim()
    return value.toLowerCase() === "true" || value.includes("[INTERNAL TEST]")
  })
}

export function classifyInboundAttachmentSensitivity(filenameValue: unknown, contentTypeValue: unknown, contextValue: unknown = "") : InboundAttachmentSensitivity {
  const filename = String(filenameValue ?? "")
  const contentType = String(contentTypeValue ?? "").toLowerCase().split(";", 1)[0].trim()
  const evidence = `${filename} ${String(contextValue ?? "")}`.toLowerCase()
  if (/\b(?:w-?9|certificate of insurance|coi|invoice|payment|deposit|quote|estimate|purchase order|po number|tax)\b/i.test(evidence)) return "owner_paperwork"
  if (/\.(?:dxf|dwg|step|stp|iges|igs)$/i.test(filename)) return "drawing"
  if (contentType === "application/pdf" && /\b(?:rfq|drawing|blueprint|plan|schematic|fabrication|shop drawing|spec|cad|part|assembly|detail)\b/i.test(evidence)) return "drawing"
  // Provider filenames and MIME types do not prove that a raster contains only
  // job-site imagery. Money and identity screenshots remain owner-only until a
  // trusted workflow explicitly promotes them.
  return "unclassified"
}

// Gmail history is an append-only change feed, but an individual message can be
// deleted before the ingester fetches it. That 404 is a terminal tombstone, not
// a retryable provider outage. Require the structured status so an unrelated
// exception whose text happens to mention 404 cannot silently drop work.
export function isGmailMessageGone(error: any) : boolean {
  return Boolean(error && typeof error === "object" && Number(error.status) === 404)
}

export function isReservedCustomerPhone(value: unknown, reservedValues: unknown[]) : boolean {
  const phone = normalizeUsPhone(value)
  if (!phone) return false
  return reservedValues.map(normalizeUsPhone).filter(Boolean).includes(phone)
}

export function selectBriefAudioPath(role: "owner" | "crew", detail: Record<string, unknown> | null | undefined) : string | null {
  const value = role === "owner" ? detail?.audioPath : detail?.crewAudioPath
  return typeof value === "string" && value ? value : null
}

export function countsAsHumanResponse(kind: string, actorType: string) : boolean {
  return ["call.answered", "call.out"].includes(kind) || (
    actorType === "operator" && ["sms.out", "email.out", "contact.logged", "contact.first-response"].includes(kind)
  )
}

export function glassStageIndex(job: GlassStageJob) : number {
  if (job.completed_at) return 4
  if (job.work_started_at) return 3
  if (job.scheduled_at) return 2
  if (job.quoted_at || job.invoice_number) return 1
  return 0
}

export function glassReviewEligible(job: GlassStageJob) : boolean {
  return Boolean(job.completed_at && job.paid_at)
}

// An intent should normally leave `pending` within seconds, before Blob issues
// its short-lived upload token. Six hours leaves generous room for a stalled
// browser without letting an abandoned reservation consume the day's quota.
export const GLASS_UPLOAD_PENDING_EXPIRY_MS: number = 6 * 60 * 60 * 1000

export function isGlassUploadPendingExpired(status: string, createdAt: string, now: number = Date.now()) : boolean {
  if (status !== "pending") return false
  const createdTime = new Date(createdAt).getTime()
  const nowTime = Number(now)
  return Number.isFinite(createdTime) && Number.isFinite(nowTime)
    && createdTime <= nowTime - GLASS_UPLOAD_PENDING_EXPIRY_MS
}

export function glassExpiryAt(completedAt: string | null | undefined) : string | null {
  if (!completedAt) return null
  const value = new Date(completedAt)
  if (Number.isNaN(value.getTime())) return null
  return new Date(value.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()
}

export function safeGlassCaptionText(note: unknown, service: unknown) : string {
  const generic = `${service || "Job"} finished and checked by the crew.`.slice(0, 180)
  const clean = String(note ?? "").replace(/\s+/g, " ").trim().slice(0, 180)
  if (!clean) return generic
  const sensitive = /\$|\b(?:price|quote|invoice|paid|payment|deposit|cost|margin|gate\s*code|password|pin|blame|fault|liability)\b|\b(?:fuck|shit|damn|asshole)\b/i
  return sensitive.test(clean) ? generic : clean
}

export function canApplyDone(completedAt: string | null | undefined) : boolean {
  return !completedAt
}

export function canUndoDone(occurredAt: string, now: number = Date.now()) : boolean {
  const time = new Date(occurredAt).getTime()
  return Number.isFinite(time) && now - time >= 0 && now - time <= 10_000
}

export function handoffDisplayState({
  persistedHandedOff,
  handoffStatus,
  handoffActionEventId,
  undoStatus,
  undoActionEventId,
}: {
  persistedHandedOff: boolean
  handoffStatus: string
  handoffActionEventId?: number | null
  undoStatus: string
  undoActionEventId?: number | null
}) : boolean {
  const handoffSucceeded = handoffStatus === "handed-off"
  const undoSucceeded = undoStatus === "active"
  if (handoffSucceeded && undoSucceeded) {
    const handoffId = Number(handoffActionEventId)
    const undoId = Number(undoActionEventId)
    if (Number.isInteger(handoffId) && handoffId > 0 && Number.isInteger(undoId) && undoId > 0) {
      return handoffId > undoId
    }
  }
  if (handoffSucceeded && !undoSucceeded) return true
  if (undoSucceeded && !handoffSucceeded) return false
  return Boolean(persistedHandedOff)
}

export function shouldEmitTwilioFailure(previousStatus: string, nextStatus: string, isTest: boolean, immutableEventInserted: boolean = true) : boolean {
  return !isTest && immutableEventInserted && previousStatus !== nextStatus && ["failed", "undelivered"].includes(nextStatus)
}

// Twilio alert bodies cap at 500 characters. Owner sms-only copies must carry
// the direct work-order URL even when the title and body are long, so the copy
// is truncated to make room for the whole URL instead of the URL being sliced
// off the end. Fallback SMS (smsOnly false) keeps the old cap-only shape.
export function formatSmsBody({ title, body = "", url = "", smsOnly = false }: { title: string; body?: string; url?: string; smsOnly?: boolean }, maxLength: number = 500) : string {
  const copy = body ? `${title}: ${body}` : title
  if (!smsOnly || !url) return copy.slice(0, maxLength)
  const suffix = ` ${url}`
  if (suffix.length >= maxLength) return suffix.slice(0, maxLength)
  return `${copy.slice(0, maxLength - suffix.length)}${suffix}`
}

const TWILIO_CONSENT_KEYWORDS: TwilioConsentKeyword[] = ["STOP", "START", "HELP"]

// Provider classification wins. Without it, only a standalone keyword may
// change consent; conversational prose must never grant or revoke permission.
export function classifyTwilioConsentKeyword(optOutType: unknown, body: unknown) : TwilioConsentKeyword | null {
  const providerValue = String(optOutType ?? "").trim().toUpperCase()
  const providerKeyword = TWILIO_CONSENT_KEYWORDS.find((value) => value === providerValue)
  if (providerKeyword) return providerKeyword
  const exactBody = String(body ?? "").trim().toUpperCase()
  return TWILIO_CONSENT_KEYWORDS.find((value) => value === exactBody) ?? null
}

export function attachmentCanRetry(status: string, attempts: number, ageMs: number) : boolean {
  return ["pending", "failed"].includes(status) && Number(attempts) < 8 && Number(ageMs) >= 5 * 60 * 1000
}

export function safeActionMovement(startX: number, startY: number, currentX: number, currentY: number) : boolean {
  const deltaX = Number(currentX) - Number(startX)
  const deltaY = Number(currentY) - Number(startY)
  return Math.abs(deltaY) >= 10 || Math.hypot(deltaX, deltaY) >= 14
}

export function swipeFinishDecision({ deltaX, deltaY, width, submitted = false }: { deltaX: number; deltaY: number; width: number; submitted?: boolean }) : {
  outcome: "cancel" | "reset" | "submit" | "submitted"
  progress: number
} {
  if (submitted) return { outcome: "submitted", progress: 1 }
  const safeWidth = Math.max(Number(width) || 0, 1)
  const x = Math.max(0, Number(deltaX) || 0)
  const y = Math.abs(Number(deltaY) || 0)
  const progress = Math.min(x / safeWidth, 1)
  if (y >= 12 && y > x * 0.55) return { outcome: "cancel", progress: 0 }
  if (progress >= 0.7) return { outcome: "submit", progress }
  return { outcome: "reset", progress }
}

const CUSTOMER_UPLOAD_MIMES: Record<string, string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  heic: ["image/heic", "image/heif", "application/octet-stream"],
  heif: ["image/heif", "image/heic", "application/octet-stream"],
  pdf: ["application/pdf"],
  dxf: ["application/dxf", "application/x-dxf", "image/vnd.dxf", "image/x-dxf", "application/octet-stream"],
  dwg: ["application/acad", "application/x-acad", "application/autocad_dwg", "application/dwg", "application/x-dwg", "image/vnd.dwg", "image/x-dwg", "application/octet-stream"],
  step: ["model/step", "application/step", "application/step-file", "application/octet-stream"],
  stp: ["model/step", "application/step", "application/step-file", "application/octet-stream"],
  iges: ["model/iges", "application/iges", "application/octet-stream"],
  igs: ["model/iges", "application/iges", "application/octet-stream"],
}

export function validateCustomerUploadMetadata(filenameValue: unknown, contentTypeValue: unknown, sizeValue: unknown) : {
  filename: string
  safeName: string
  extension: string
  contentType: string
  size: number
} {
  const filename = String(filenameValue ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 180)
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ""
  const accepted = CUSTOMER_UPLOAD_MIMES[extension]
  const supplied = String(contentTypeValue || "application/octet-stream").toLowerCase().split(";", 1)[0].trim()
  const size = Math.floor(Number(sizeValue))

  if (!filename || !accepted) {
    throw new Error("Use JPG, PNG, WebP, HEIC/HEIF, PDF, DXF, DWG, STEP/STP, or IGES/IGS files.")
  }
  if (!Number.isFinite(size) || size <= 0 || size > 20 * 1024 * 1024) {
    throw new Error("Each file must be 20 MB or smaller.")
  }
  if (!accepted.includes(supplied)) {
    throw new Error(`The file type for ${filename} does not match its extension.`)
  }

  const contentType = supplied === "application/octet-stream" ? accepted[0] : supplied
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(-140) || `customer-file.${extension}`
  return { filename, safeName, extension, contentType, size }
}

export function messagingConsentState(events: Array<{ source?: unknown }> | null | undefined) : "granted" | "revoked" | "unknown" {
  let state: "unknown" | "granted" | "revoked" = "unknown"
  for (const event of events ?? []) {
    const source = String(event?.source ?? "")
    if (source === "STOP") state = "revoked"
    else if (source === "START") state = "granted"
    else if (source !== "HELP" && state !== "revoked") state = "granted"
  }
  return state
}

// The web quote form's text-consent disclosure. Bumped whenever the disclosure
// wording or the consent semantics change, so older consents can be traced.
export const QUOTE_CONSENT_DISCLOSURE_VERSION: string = "2026-08-14"

// Customer-facing warning returned when a prior STOP still governs a number.
// It must stay phone-free: the shop number is already on the form and an
// internal E.164 value must never leak into a client-facing response.
export const TEXT_CONSENT_REVOKED_WARNING: string =
  "Text updates remain off for this number. Text START to the shop number to turn them back on."

// Customer-facing warning returned when permission could not be verified (a
// consent-store lookup failure). The lead still lands, but text updates stay
// off until the customer opts in by text. Phone-free for the same reason as
// TEXT_CONSENT_REVOKED_WARNING: no digits, no internal E.164.
export const TEXT_CONSENT_UNVERIFIED_WARNING: string =
  "Text updates were not enabled because permission could not be verified. Text START to the shop number to turn them on."

// A web checkbox can never override a prior STOP. Only the customer texting
// START re-grants consent. The explicit durable states "unknown" and
// "granted" keep the normal atomic lead + consent behavior; anything else
// (null, empty, invalid, or unavailable input) denies the grant without
// manufacturing a conflict, because no real STOP exists to report.
export function webTextConsentResolution(state: unknown) : { grant: boolean; consentConflict: boolean } {
  if (state === "granted" || state === "unknown") return { grant: true, consentConflict: false }
  if (state === "revoked") return { grant: false, consentConflict: true }
  return { grant: false, consentConflict: false }
}

// What the board calls each signal *kind* when it counts jobs rather than
// naming one. Four of the five equal a reason string lib/ops-data.ts already
// emits; `waiting` has no single one, because that kind emits four different
// reasons depending on which inbound event arrived last ('Customer text
// waiting', 'Customer email waiting', 'New files waiting', 'Missed call').
// A row that counts the kind needs one product name, declared here once, so no
// component ever paraphrases its own. Per-job reasons stay verbatim.
export const BOARD_SIGNAL_LABELS: Readonly<Record<BoardSignalKind, string>> = Object.freeze({
  waiting:  "Customer waiting",
  noreply:  "Needs a call",
  promise:  "Promise overdue",
  followup: "Follow-up due",
  bounced:  "Email did not deliver",
})

