import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  buildMonthJobCalendar,
  calendarNavigationIndex,
  calendarTimestampIso,
  centralDateKey,
  centralMonthRange,
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

test("the month calendar contains every day in the current Central month", () => {
  const range = centralMonthRange("2026-12-31T18:00:00.000Z")
  assert.equal(range.dateKeys.length, 31)
  assert.equal(range.dateKeys[0], "2026-12-01")
  assert.equal(range.dateKeys[30], "2026-12-31")
  assert.equal(new Set(range.dateKeys).size, 31)
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

test("month boundaries follow Central civil midnights across DST changes", () => {
  const spring = centralMonthRange("2026-03-08T18:00:00.000Z")
  assert.equal(spring.startInclusive, "2026-03-01T06:00:00.000Z")
  assert.equal(spring.endExclusive, "2026-04-01T05:00:00.000Z")
  assert.equal((Date.parse(spring.endExclusive) - Date.parse(spring.startInclusive)) / 3_600_000, 743)

  const fall = centralMonthRange("2026-11-01T18:00:00.000Z")
  assert.equal(fall.startInclusive, "2026-11-01T05:00:00.000Z")
  assert.equal(fall.endExclusive, "2026-12-01T06:00:00.000Z")
  assert.equal((Date.parse(fall.endExclusive) - Date.parse(fall.startInclusive)) / 3_600_000, 721)
})

test("only active, production, directly scheduled jobs enter the month range", () => {
  const calendar = buildMonthJobCalendar([
    job(1, "2026-09-08T05:00:00.000Z"),
    job(2, "2026-09-30T04:59:59.999Z"),
    job(3, "2026-09-30T05:00:00.000Z"),
    job(4, "2026-09-09T15:00:00.000Z", { completedAt: "2026-09-09T16:00:00.000Z" }),
    job(5, "2026-09-10T15:00:00.000Z", { handedOffAt: "2026-09-10T17:00:00.000Z" }),
    job(6, "2026-09-11T15:00:00.000Z", { routedToLeadId: 99 }),
    job(7, "2026-09-12T15:00:00.000Z", { isTest: true }),
    job(8, "2026-09-13T15:00:00.000Z", { status: "lost" }),
    job(9, "2026-09-14T15:00:00.000Z", { status: "spam" }),
    job(10, "not-a-date"),
  ], "2026-09-08T17:00:00.000Z")

  assert.deepEqual(calendar.flatMap((day) => day.jobs.map((item) => item.id)), [1, 2, 3])
  assert.equal(calendar[0].dateKey, "2026-09-01")
  assert.equal(calendar[29].dateKey, "2026-09-30")
})

test("jobs are ordered by scheduled time with a stable id tie-break", () => {
  const calendar = buildMonthJobCalendar([
    job(3, "2026-09-08T15:00:00.000Z"),
    job(2, "2026-09-08T14:00:00.000Z"),
    job(1, "2026-09-08T14:00:00.000Z"),
  ], "2026-09-08T12:00:00.000Z")
  assert.deepEqual(calendar.find((day) => day.dateKey === "2026-09-08")?.jobs.map((item) => item.id), [1, 2, 3])
})

test("day selection returns populated and explicit empty agendas and recovers to month start when missing", () => {
  const calendar = buildMonthJobCalendar([
    job(1, "2026-09-10T15:00:00.000Z"),
    job(2, "2026-09-10T16:00:00.000Z"),
  ], "2026-09-08T12:00:00.000Z")
  assert.deepEqual(selectedCalendarDay(calendar, "2026-09-10")?.jobs.map((item) => item.id), [1, 2])
  assert.deepEqual(selectedCalendarDay(calendar, "2026-09-09")?.jobs, [])
  assert.equal(selectedCalendarDay(calendar, "2026-08-31")?.dateKey, "2026-09-01")
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
  assert.equal(calendarNavigationIndex(0, "Home", 30, 7, 2), 0)
  assert.equal(calendarNavigationIndex(0, "End", 30, 7, 2), 4)
  assert.equal(calendarNavigationIndex(0, "ArrowDown", 30, 7, 2), 7)
  assert.equal(calendarNavigationIndex(7, "ArrowUp", 30, 7, 2), 0)
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
