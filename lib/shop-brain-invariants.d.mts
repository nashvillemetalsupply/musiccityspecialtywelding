export type GlassStageJob = {
  completed_at?: string | null
  work_started_at?: string | null
  scheduled_at?: string | null
  quoted_at?: string | null
  estimate_value_cents?: number | null
  invoice_number?: string | null
  paid_at?: string | null
}

export function normalizeUsPhone(value: unknown): string
export function isReservedCustomerPhone(value: unknown, reservedValues: unknown[]): boolean
export function selectBriefAudioPath(role: "owner" | "crew", detail: Record<string, unknown> | null | undefined): string | null
export function countsAsHumanResponse(kind: string, actorType: string): boolean
export function glassStageIndex(job: GlassStageJob): number
export function glassReviewEligible(job: GlassStageJob): boolean
export const GLASS_UPLOAD_PENDING_EXPIRY_MS: number
export function isGlassUploadPendingExpired(status: string, createdAt: string, now?: number): boolean
export function glassExpiryAt(completedAt: string | null | undefined): string | null
export function safeGlassCaptionText(note: unknown, service: unknown): string
export function canApplyDone(completedAt: string | null | undefined): boolean
export function canUndoDone(occurredAt: string, now?: number): boolean
export function handoffDisplayState(input: {
  persistedHandedOff: boolean
  handoffStatus: string
  handoffActionEventId?: number | null
  undoStatus: string
  undoActionEventId?: number | null
}): boolean
export function shouldEmitTwilioFailure(previousStatus: string, nextStatus: string, isTest: boolean, immutableEventInserted?: boolean): boolean
export type TwilioConsentKeyword = "STOP" | "START" | "HELP"
export function classifyTwilioConsentKeyword(optOutType: unknown, body: unknown): TwilioConsentKeyword | null
export function attachmentCanRetry(status: string, attempts: number, ageMs: number): boolean
export function safeActionMovement(startX: number, startY: number, currentX: number, currentY: number): boolean
export function swipeFinishDecision(input: { deltaX: number; deltaY: number; width: number; submitted?: boolean }): {
  outcome: "cancel" | "reset" | "submit" | "submitted"
  progress: number
}
export function validateCustomerUploadMetadata(filenameValue: unknown, contentTypeValue: unknown, sizeValue: unknown): {
  filename: string
  safeName: string
  extension: string
  contentType: string
  size: number
}
export function messagingConsentState(events: Array<{ source?: unknown }> | null | undefined): "granted" | "revoked" | "unknown"
export const QUOTE_CONSENT_DISCLOSURE_VERSION: string
export const TEXT_CONSENT_REVOKED_WARNING: string
export const TEXT_CONSENT_UNVERIFIED_WARNING: string
export function webTextConsentResolution(state: unknown): { grant: boolean; consentConflict: boolean }
