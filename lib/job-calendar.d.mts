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

export type RollingCalendarDay<T> = {
  dateKey: string
  jobs: T[]
}

export function centralDateKey(value: Date | string | number): string | null
export function calendarTimestampIso(value: Date | string | number): string | null
export function rollingCentralDateRange(now?: Date | string | number, dayCount?: number): {
  dateKeys: string[]
  startInclusive: string
  endExclusive: string
}
export function isActiveScheduledJob(job: CalendarSourceJob | null | undefined): boolean
export function buildRollingJobCalendar<T extends CalendarSourceJob>(
  jobs: T[],
  now?: Date | string | number,
  dayCount?: number,
): RollingCalendarDay<T>[]
export function selectedCalendarDay<T>(
  days: RollingCalendarDay<T>[],
  selectedDateKey: string,
): RollingCalendarDay<T> | null
export function calendarNavigationIndex(
  index: number,
  key: string,
  length: number,
  columns?: number,
): number | null
