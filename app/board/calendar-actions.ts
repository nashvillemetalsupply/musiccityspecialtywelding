"use server"

import { randomUUID } from "node:crypto"
import { createManualLeadRecord, scheduleLeadRecord } from "@/app/ops/actions"
import { resolveCentralDateTime } from "@/lib/central-date-time.mjs"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { canAccessInternalTests } from "@/lib/operators"

export type CalendarQuickAddState =
  | { status: "idle" }
  | { status: "saved"; leadId: number; customer: string; scheduledAt: string; nextIntakeKey: string }
  | { status: "partial"; leadId: number; message: string; intakeKey: string }
  | { status: "error"; message: string; intakeKey: string }

function actionError(error: unknown, intakeKey: string) {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim().slice(0, 240)
    : "The job could not be added to the calendar. Try again."
  return { status: "error", message, intakeKey } as const
}

export async function createCalendarJobAction(
  _state: CalendarQuickAddState,
  formData: FormData,
): Promise<CalendarQuickAddState> {
  const intakeKey = String(formData.get("intakeKey") ?? "").trim()
  const operator = await getAuthenticatedOperator()
  if (!operator) return { status: "error", message: "Sign in again before adding a job.", intakeKey }

  const scheduledDate = String(formData.get("scheduledDate") ?? "").trim()
  const scheduledTime = String(formData.get("scheduledTime") ?? "").trim()
  const customer = String(formData.get("firstName") ?? "").trim().slice(0, 120)
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40)
  const need = String(formData.get("message") ?? "").trim().slice(0, 2000)

  if (!resolveCentralDateTime(scheduledDate, scheduledTime)) {
    return { status: "error", message: "Pick an unambiguous Central date and time.", intakeKey }
  }
  if (!customer) return { status: "error", message: "Add the customer or company name.", intakeKey }
  if (!phone) return { status: "error", message: "Add the customer's phone number.", intakeKey }
  if (phone.replace(/\D/g, "").length < 7) {
    return { status: "error", message: "Add a valid customer phone number.", intakeKey }
  }
  if (!need) return { status: "error", message: "Add what the customer needs.", intakeKey }
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(intakeKey)) {
    return { status: "error", message: "This form expired. Refresh the board and try again.", intakeKey }
  }
  if (need.includes("[INTERNAL TEST]") && !canAccessInternalTests(operator.role)) {
    return { status: "error", message: "Only the owner can add an internal test job.", intakeKey }
  }

  const manual = new FormData()
  manual.set("firstName", customer)
  manual.set("phone", phone)
  manual.set("message", need)
  manual.set("service", "Not Sure / Other")
  manual.set("source", "phone-in")
  manual.set("intakeKey", intakeKey)

  // Lead creation is durable first; scheduling follows serially and records a
  // separate immutable event so the calendar never claims an appointment
  // before the customer/job record exists.
  let created
  try {
    created = await createManualLeadRecord(manual)
  } catch (error) {
    return actionError(error, intakeKey)
  }

  try {
    const schedule = new FormData()
    schedule.set("leadId", String(created.leadId))
    schedule.set("scheduledAt", `${scheduledDate}T${scheduledTime}`)
    schedule.set("scheduleKey", intakeKey)
    const scheduled = await scheduleLeadRecord(schedule, { source: "board_calendar_quick_add" })
    return {
      status: "saved",
      leadId: created.leadId,
      customer: created.name,
      scheduledAt: scheduled.scheduledAt,
      nextIntakeKey: randomUUID(),
    }
  } catch (error) {
    const detail = actionError(error, intakeKey).message
    return {
      status: "partial",
      leadId: created.leadId,
      message: `The job was saved, but the appointment was not added. ${detail}`,
      intakeKey,
    }
  }
}
