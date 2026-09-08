import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  buildRollingJobCalendar,
  calendarNavigationIndex,
  calendarTimestampIso,
  centralDateKey,
  rollingCentralDateRange,
  selectedCalendarDay,
} from "../lib/job-calendar.mjs"

function job(id, scheduledAt, overrides = {}) {
  return {
    id,
    scheduledAt,
    completedAt: null,
    handedOffAt: null,
    routedToLeadId: null,
    isTest: false,
    status: "won",
    ...overrides,
  }
}

test("the rolling calendar starts today and contains exactly today plus 29 days", () => {
  const range = rollingCentralDateRange("2026-12-31T18:00:00.000Z")
  assert.equal(range.dateKeys.length, 30)
  assert.equal(range.dateKeys[0], "2026-12-31")
  assert.equal(range.dateKeys[29], "2027-01-29")
  assert.equal(new Set(range.dateKeys).size, 30)
})

test("Central date boundaries follow the shop day rather than UTC midnight", () => {
  assert.equal(centralDateKey("2026-03-08T05:59:59.999Z"), "2026-03-07")
  assert.equal(centralDateKey("2026-03-08T06:00:00.000Z"), "2026-03-08")
  assert.equal(centralDateKey("2026-11-01T04:59:59.999Z"), "2026-10-31")
  assert.equal(centralDateKey("2026-11-01T05:00:00.000Z"), "2026-11-01")
})

test("database Date objects become serializable ISO timestamps", () => {
  assert.equal(
    calendarTimestampIso(new Date("2026-09-08T15:30:00.000Z")),
    "2026-09-08T15:30:00.000Z",
  )
  assert.equal(calendarTimestampIso("not-a-date"), null)
})

test("thirty civil days survive spring and fall DST changes", () => {
  const spring = rollingCentralDateRange("2026-03-07T18:00:00.000Z")
  assert.equal(spring.startInclusive, "2026-03-07T06:00:00.000Z")
  assert.equal(spring.endExclusive, "2026-04-06T05:00:00.000Z")
  assert.equal((Date.parse(spring.endExclusive) - Date.parse(spring.startInclusive)) / 3_600_000, 719)

  const fall = rollingCentralDateRange("2026-10-31T18:00:00.000Z")
  assert.equal(fall.startInclusive, "2026-10-31T05:00:00.000Z")
  assert.equal(fall.endExclusive, "2026-11-30T06:00:00.000Z")
  assert.equal((Date.parse(fall.endExclusive) - Date.parse(fall.startInclusive)) / 3_600_000, 721)
})

test("only active, production, directly scheduled jobs enter the thirty-day range", () => {
  const calendar = buildRollingJobCalendar([
    job(1, "2026-09-08T05:00:00.000Z"),
    job(2, "2026-10-08T04:59:59.999Z"),
    job(3, "2026-10-08T05:00:00.000Z"),
    job(4, "2026-09-09T15:00:00.000Z", { completedAt: "2026-09-09T16:00:00.000Z" }),
    job(5, "2026-09-10T15:00:00.000Z", { handedOffAt: "2026-09-10T17:00:00.000Z" }),
    job(6, "2026-09-11T15:00:00.000Z", { routedToLeadId: 99 }),
    job(7, "2026-09-12T15:00:00.000Z", { isTest: true }),
    job(8, "2026-09-13T15:00:00.000Z", { status: "lost" }),
    job(9, "2026-09-14T15:00:00.000Z", { status: "spam" }),
    job(10, "not-a-date"),
  ], "2026-09-08T17:00:00.000Z")

  assert.deepEqual(calendar.flatMap((day) => day.jobs.map((item) => item.id)), [1, 2])
  assert.equal(calendar[0].dateKey, "2026-09-08")
  assert.equal(calendar[29].dateKey, "2026-10-07")
})

test("jobs are ordered by scheduled time with a stable id tie-break", () => {
  const calendar = buildRollingJobCalendar([
    job(3, "2026-09-08T15:00:00.000Z"),
    job(2, "2026-09-08T14:00:00.000Z"),
    job(1, "2026-09-08T14:00:00.000Z"),
  ], "2026-09-08T12:00:00.000Z")
  assert.deepEqual(calendar[0].jobs.map((item) => item.id), [1, 2, 3])
})

test("day selection returns populated and explicit empty agendas and recovers after midnight", () => {
  const calendar = buildRollingJobCalendar([
    job(1, "2026-09-10T15:00:00.000Z"),
    job(2, "2026-09-10T16:00:00.000Z"),
  ], "2026-09-08T12:00:00.000Z")
  assert.deepEqual(selectedCalendarDay(calendar, "2026-09-10")?.jobs.map((item) => item.id), [1, 2])
  assert.deepEqual(selectedCalendarDay(calendar, "2026-09-09")?.jobs, [])
  assert.equal(selectedCalendarDay(calendar, "2026-09-07")?.dateKey, "2026-09-08")
})

test("calendar keyboard navigation is row-aware and bounded", () => {
  assert.equal(calendarNavigationIndex(0, "ArrowLeft", 30), 0)
  assert.equal(calendarNavigationIndex(0, "ArrowUp", 30), 0)
  assert.equal(calendarNavigationIndex(0, "ArrowRight", 30), 1)
  assert.equal(calendarNavigationIndex(1, "ArrowDown", 30), 8)
  assert.equal(calendarNavigationIndex(8, "ArrowUp", 30), 1)
  assert.equal(calendarNavigationIndex(10, "Home", 30), 7)
  assert.equal(calendarNavigationIndex(10, "End", 30), 13)
  assert.equal(calendarNavigationIndex(29, "Home", 30), 28)
  assert.equal(calendarNavigationIndex(29, "End", 30), 29)
  assert.equal(calendarNavigationIndex(29, "ArrowRight", 30), 29)
  assert.equal(calendarNavigationIndex(0, "Enter", 30), null)
})

test("the server projection is non-financial, fail-closed for tests, and every agenda job opens its work order", () => {
  const data = readFileSync(new URL("../lib/job-calendar-data.ts", import.meta.url), "utf8")
  const component = readFileSync(new URL("../app/board/job-calendar.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("../app/board/job-calendar.module.css", import.meta.url), "utf8")
  const selectedColumns = data.slice(data.indexOf("SELECT l.id"), data.indexOf("FROM leads l"))

  assert.doesNotMatch(selectedColumns, /phone|email|message|notes|invoice|paid|revenue|estimate/i)
  assert.match(data, /l\.is_test = false/)
  assert.match(data, /COALESCE\(p\.is_test, false\) = false/)
  assert.match(data, /NOT ILIKE '%\[INTERNAL TEST\]%'/)
  assert.match(data, /l\.completed_at IS NULL/)
  assert.match(data, /l\.handed_off_at IS NULL/)
  assert.match(data, /l\.routed_to_lead_id IS NULL/)
  assert.match(css, /grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/)
  assert.match(component, /aria-pressed=\{selected\}/)
  assert.match(component, /tabIndex=\{selected \? 0 : -1\}/)
  assert.match(component, /onKeyDown=\{\(event\) => moveSelection\(index, event\)\}/)
  assert.match(component, /href=\{`\/ops\/leads\/\$\{job\.id\}`\}/)
})
