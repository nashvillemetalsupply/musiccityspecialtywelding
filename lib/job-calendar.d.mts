export const SHOP_TIME_ZONE: "America/Chicago"

export type CalendarSourceJob = {
  id: number
  scheduledAt: string
  completedAt: string | null
  handedOffAt: string | null
  routedToLeadId: number | null
  isTest: boolean
  status: string
}

export type CalendarDay<T> = {
  dateKey: string
  jobs: T[]
}

export function centralDateKey(value: Date | string | number): string | null
export function calendarTimestampIso(value: Date | string | number): string | null
export function centralMonthRange(now?: Date | string | number): {
  dateKeys: string[]
  startInclusive: string
  endExclusive: string
}
export function isActiveScheduledJob(job: CalendarSourceJob | null | undefined): boolean
export function buildMonthJobCalendar<T extends CalendarSourceJob>(
  jobs: T[],
  now?: Date | string | number,
): CalendarDay<T>[]
export function selectedCalendarDay<T>(
  days: CalendarDay<T>[],
  selectedDateKey: string,
): CalendarDay<T> | null
export function calendarNavigationIndex(
  index: number,
  key: string,
  length: number,
  columns?: number,
  leadingOffset?: number,
): number | null
