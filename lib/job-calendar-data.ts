import { getSql } from "@/lib/db"
import type { OperatorRole } from "@/lib/operators"
import { redactCrewText } from "@/lib/visibility"
import {
  buildRollingJobCalendar,
  calendarTimestampIso,
  rollingCentralDateRange,
} from "@/lib/job-calendar.mjs"

type CalendarQueryRow = {
  id: number
  public_id: string
  first_name: string
  last_name: string
  service: string
  scheduled_at: string | Date
  completed_at: string | Date | null
  handed_off_at: string | Date | null
  routed_to_lead_id: number | null
  is_test: boolean
  status: string
}

type CalendarSourceRow = {
  id: number
  publicId: string
  firstName: string
  lastName: string
  service: string
  scheduledAt: string
  completedAt: string | null
  handedOffAt: string | null
  routedToLeadId: number | null
  isTest: boolean
  status: string
}

export type CalendarJob = {
  id: number
  publicId: string
  customer: string
  service: string
  scheduledAt: string
}

export type CalendarDay = {
  dateKey: string
  jobs: CalendarJob[]
}

export function emptyThirtyDayJobCalendar(now = new Date()): CalendarDay[] {
  return buildRollingJobCalendar([], now, 30)
}

export async function listThirtyDayJobCalendar(
  role: OperatorRole,
  now = new Date(),
): Promise<CalendarDay[]> {
  const sql = getSql()
  const range = rollingCentralDateRange(now, 30)
  // Calendar rows are deliberately a narrow, non-financial projection. The
  // test boundary is fail-closed across both the work order and its person.
  const rows = (await sql`
    SELECT l.id, l.public_id, l.first_name, l.last_name, l.service,
      l.scheduled_at, l.completed_at, l.handed_off_at, l.routed_to_lead_id,
      l.is_test, l.status
    FROM leads l
    LEFT JOIN people p ON p.id = l.person_id
    WHERE l.scheduled_at >= ${range.startInclusive}::timestamptz
      AND l.scheduled_at < ${range.endExclusive}::timestamptz
      AND l.completed_at IS NULL
      AND l.handed_off_at IS NULL
      AND l.routed_to_lead_id IS NULL
      AND l.status NOT IN ('lost', 'spam')
      AND l.is_test = false
      AND COALESCE(p.is_test, false) = false
      AND concat_ws(' ', l.first_name, l.last_name, l.service, l.message, l.notes,
        p.display_name, p.company, p.phones::text, p.emails::text)
        NOT ILIKE '%[INTERNAL TEST]%'
    ORDER BY l.scheduled_at ASC, l.id ASC`) as CalendarQueryRow[]

  const sourceRows: CalendarSourceRow[] = rows.map((row) => ({
    id: Number(row.id),
    publicId: row.public_id,
    firstName: row.first_name,
    lastName: row.last_name,
    service: row.service,
    scheduledAt: calendarTimestampIso(row.scheduled_at) ?? "",
    completedAt: row.completed_at == null ? null : calendarTimestampIso(row.completed_at),
    handedOffAt: row.handed_off_at == null ? null : calendarTimestampIso(row.handed_off_at),
    routedToLeadId: row.routed_to_lead_id == null ? null : Number(row.routed_to_lead_id),
    isTest: row.is_test,
    status: row.status,
  }))

  return buildRollingJobCalendar(sourceRows, now, 30).map((day) => ({
    dateKey: day.dateKey,
    jobs: day.jobs.map((job) => ({
      id: job.id,
      publicId: job.publicId,
      customer: `${job.firstName} ${job.lastName}`.trim() || "Customer",
      service: role === "owner" ? job.service : redactCrewText(job.service),
      scheduledAt: job.scheduledAt,
    })),
  }))
}
