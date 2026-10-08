// Decides which failed operator alerts mean "the shop was not told" and which
// are per-recipient noise. Health used to count every dead copy: notifyAll
// writes one row per owner, so an owner with no channel for an alert (a cell
// but no push subscription, or no cell at all) produced a dead row on every
// alert even when another owner's copy was delivered. The health monitor's own
// failure text then failed the same way and kept /api/health red forever.

import { normalizeRecentDeliveryErrors } from "./delivery-errors.mjs"

// Twilio recipient errors that no retry can fix. Codes, never numbers, are
// what health reports; the operator id names who must act.
const PERMANENT_TWILIO_RECIPIENT_ERRORS = new Map([
  ["21610", "opted-out"], // Attempt to send to unsubscribed recipient (texted STOP)
  ["21614", "not-mobile"], // 'To' number is not a valid mobile number (landline)
  ["21211", "invalid-number"], // Invalid 'To' phone number
  ["21217", "invalid-number"], // Phone number does not appear to be valid
  ["21401", "invalid-number"], // Invalid phone number
  ["21421", "invalid-number"], // PhoneNumber is invalid
])

const PERMANENT_MESSAGES = {
  "opted-out": (code) => `The operator's cell opted out of texts (Twilio ${code}). It gets no SMS until that phone texts START to the shop number. Not retried.`,
  "not-mobile": (code) => `The operator's cell on file cannot receive texts (Twilio ${code}: not a mobile number). Fix the number on the operator record. Not retried.`,
  "invalid-number": (code) => `The operator's cell on file is not a valid phone number (Twilio ${code}). Fix the number on the operator record. Not retried.`,
}

// Errors that mean this recipient had no channel for this alert, as opposed
// to a channel that was tried and failed in transit.
const NO_CHANNEL_ERRORS = [
  /^No configured alert channel accepted this retry\.?$/,
  /^No registered push, email, or SMS fallback channel accepted the alert\.?$/,
  /^Operator \d+ has no cell_phone on file\.?$/,
  /^The coalesced alert could not reach a registered push/,
]

export function twilioErrorCodeFrom(value) {
  if (value == null) return ""
  if (typeof value === "object") {
    const code = value.code ?? value.error_code ?? value.ErrorCode
    return code == null ? "" : String(code).replace(/\D/g, "").slice(0, 6)
  }
  const text = String(value).trim()
  if (/^\d{5}$/.test(text)) return text
  const tagged = text.match(/\b(?:error|Twilio)\s+(\d{5})\b/i)
  if (tagged) return tagged[1]
  if (/unsubscribed recipient/i.test(text)) return "21610"
  return ""
}

export function permanentTwilioRecipientError(code) {
  const normalized = code == null ? "" : String(code).trim()
  const reason = PERMANENT_TWILIO_RECIPIENT_ERRORS.get(normalized)
  if (!reason) return null
  return { code: normalized, reason, message: PERMANENT_MESSAGES[reason](normalized) }
}

function isNoChannelError(error) {
  const text = String(error ?? "").trim()
  return NO_CHANNEL_ERRORS.some((pattern) => pattern.test(text))
}

export function classifyAlertFailure(row) {
  const code = twilioErrorCodeFrom(row.provider_error_code) || twilioErrorCodeFrom(row.error)
  const permanent = permanentTwilioRecipientError(code)
  if (row.source === "health-monitor") return { blocking: false, reason: "health-monitor-alert", permanent }
  // Only a recipient-shaped failure is excused by a delivered sibling. A
  // channel that was tried and failed in transit still counts, and a dead
  // alert nobody received always counts.
  if (row.sibling_delivered === true && (permanent || isNoChannelError(row.error))) {
    return { blocking: false, reason: "covered-by-sibling", permanent }
  }
  return { blocking: true, reason: "undelivered", permanent }
}

function iso(value) {
  const ms = Date.parse(String(value ?? ""))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export function summarizeDeadNotifications(rows) {
  let counted = 0
  let coveredBySibling = 0
  const healthMonitorAlert = { count: 0, lastAt: null, lastError: "" }
  const permanentByOperator = new Map()
  for (const row of rows ?? []) {
    const verdict = classifyAlertFailure(row)
    if (verdict.reason === "health-monitor-alert") {
      healthMonitorAlert.count += 1
      const at = iso(row.created_at)
      if (at && (!healthMonitorAlert.lastAt || at > healthMonitorAlert.lastAt)) {
        healthMonitorAlert.lastAt = at
        healthMonitorAlert.lastError = String(row.error ?? "").slice(0, 300)
      }
    } else if (verdict.blocking) counted += 1
    else coveredBySibling += 1
    const operatorId = Number(row.operator_id)
    if (verdict.permanent && Number.isSafeInteger(operatorId) && operatorId > 0 && !permanentByOperator.has(operatorId)) {
      permanentByOperator.set(operatorId, { operatorId, twilioCode: verdict.permanent.code, reason: verdict.permanent.reason })
    }
  }
  const permanentSmsRecipients = [...permanentByOperator.values()].sort((a, b) => a.operatorId - b.operatorId)
  return {
    counted,
    coveredBySibling,
    healthMonitorAlert,
    permanentSmsRecipients,
    optedOutOperatorIds: permanentSmsRecipients.filter((item) => item.reason === "opted-out").map((item) => item.operatorId),
  }
}

export function splitHealthDeliveryErrors(rows, nowMs = Date.now()) {
  const blockingRows = []
  const diagnosticRows = []
  for (const row of rows ?? []) {
    const verdict = classifyAlertFailure(row)
    if (verdict.blocking) blockingRows.push(row)
    else diagnosticRows.push({ row, reason: verdict.reason })
  }
  const diagnostic = []
  for (const { row, reason } of diagnosticRows) {
    const [item] = normalizeRecentDeliveryErrors([row], nowMs)
    if (item) diagnostic.push({ ...item, reason })
  }
  return { blocking: normalizeRecentDeliveryErrors(blockingRows, nowMs), diagnostic }
}
