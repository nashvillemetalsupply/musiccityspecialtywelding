import type { RecentDeliveryError } from "./delivery-errors.mjs"

export type PermanentTwilioReason = "opted-out" | "not-mobile" | "invalid-number"
export type PermanentTwilioRecipientError = { code: string; reason: PermanentTwilioReason; message: string }
export type AlertFailureReason = "covered-by-sibling" | "undelivered" | "health-monitor-alert"

export type AlertFailureRow = {
  operator_id?: number | string | null
  created_at?: string | Date | null
  error?: string | null
  source?: string | null
  provider_error_code?: string | null
  sibling_delivered?: boolean | null
}

export type HealthDeliveryErrorRow = AlertFailureRow & {
  occurred_at: string
  title: string
  error: string
  is_test: boolean
}

export type PermanentSmsRecipient = { operatorId: number; twilioCode: string; reason: PermanentTwilioReason }
export type HealthMonitorAlertSummary = { count: number; lastAt: string | null; lastError: string }

export type DeadNotificationSummary = {
  counted: number
  raw: number
  coveredBySibling: number
  healthMonitorAlert: HealthMonitorAlertSummary
  permanentSmsRecipients: PermanentSmsRecipient[]
  optedOutOperatorIds: number[]
}

export type DiagnosticDeliveryError = RecentDeliveryError & { reason: AlertFailureReason }

export function twilioErrorCodeFrom(value: unknown): string
export function permanentTwilioRecipientError(code: string | number | null | undefined): PermanentTwilioRecipientError | null
export function classifyAlertFailure(row: AlertFailureRow): {
  blocking: boolean
  reason: AlertFailureReason
  permanent: PermanentTwilioRecipientError | null
}
export function summarizeDeadNotifications(rows: AlertFailureRow[]): DeadNotificationSummary
export function splitHealthDeliveryErrors(rows: HealthDeliveryErrorRow[], nowMs?: number): {
  blocking: RecentDeliveryError[]
  diagnostic: DiagnosticDeliveryError[]
}
