"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import type { CalendarDay } from "@/lib/job-calendar-data"
import { calendarNavigationIndex, selectedCalendarDay } from "@/lib/job-calendar.mjs"
import styles from "./job-calendar.module.css"

const DAY_NAME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "short",
})

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "long",
  year: "numeric",
})

const FULL_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
})

const JOB_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
})

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function dateFromKey(dateKey: string) {
  // Noon UTC is safely inside the same civil date in Central time, including
  // both DST transition weekends.
  return new Date(`${dateKey}T12:00:00.000Z`)
}

export function JobCalendar({ days, todayDateKey }: { days: CalendarDay[]; todayDateKey: string }) {
  const [selectedDateKey, setSelectedDateKey] = useState(() => (
    days.some((day) => day.dateKey === todayDateKey) ? todayDateKey : days[0]?.dateKey ?? ""
  ))
  const dayButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  if (days.length < 28 || days.length > 31) return null
  const scheduledCount = days.reduce((total, day) => total + day.jobs.length, 0)
  const firstDate = dateFromKey(days[0].dateKey)
  const selectedDay = selectedCalendarDay(days, selectedDateKey) ?? days[0]
  const selectedDate = dateFromKey(selectedDay.dateKey)
  const selectedFullDate = FULL_DATE.format(selectedDate)
  const leadingBlankCount = firstDate.getUTCDay()
  const trailingBlankCount = (7 - ((leadingBlankCount + days.length) % 7)) % 7

  function moveSelection(index: number, event: React.KeyboardEvent<HTMLButtonElement>) {
    const nextIndex = calendarNavigationIndex(index, event.key, days.length, 7, leadingBlankCount)
    if (nextIndex === null) return
    event.preventDefault()
    setSelectedDateKey(days[nextIndex].dateKey)
    dayButtonRefs.current[nextIndex]?.focus()
  }

  return <section className={`card ${styles.calendar}`} aria-labelledby="job-calendar-title">
    <header className={styles.header}>
      <div>
        <h2 className="t-title" id="job-calendar-title">{MONTH_YEAR.format(firstDate)} schedule</h2>
        <p>Full month · Central time · active scheduled jobs</p>
      </div>
      <span className={styles.total}>{scheduledCount} {scheduledCount === 1 ? "job" : "jobs"}</span>
    </header>

    <p className={styles.instruction} id="job-calendar-instructions">
      Use arrow keys to move by day or week. Home and End move within a row.
    </p>
    <div className={styles.grid} role="group" aria-label={`${MONTH_YEAR.format(firstDate)} calendar`} aria-describedby="job-calendar-instructions">
      <div className={styles.weekdays} aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className={styles.days}>
      {Array.from({ length: leadingBlankCount }, (_, index) => <span className={styles.blankDay} aria-hidden="true" key={`leading-${index}`} />)}
      {days.map((day, index) => {
        const date = dateFromKey(day.dateKey)
        const fullDate = FULL_DATE.format(date)
        const selected = day.dateKey === selectedDay.dateKey
        const isToday = day.dateKey === todayDateKey
        const jobLabel = day.jobs.length === 0
          ? "no jobs scheduled"
          : `${day.jobs.length} ${day.jobs.length === 1 ? "job" : "jobs"} scheduled`
        return <button
          className={`${styles.dayButton}${isToday ? ` ${styles.today}` : ""}${day.jobs.length ? ` ${styles.busy}` : ""}`}
          key={day.dateKey}
          type="button"
          ref={(element) => { dayButtonRefs.current[index] = element }}
          aria-label={`${isToday ? "Today, " : ""}${fullDate}, ${jobLabel}`}
          aria-pressed={selected}
          aria-controls="job-calendar-agenda"
          tabIndex={selected ? 0 : -1}
          onClick={() => setSelectedDateKey(day.dateKey)}
          onKeyDown={(event) => moveSelection(index, event)}
        >
          <span>{isToday ? "Today" : DAY_NAME.format(date)}</span>
          <time dateTime={day.dateKey}>{date.getUTCDate()}</time>
          <b aria-hidden="true">{day.jobs.length || "—"}</b>
        </button>
      })}
      {Array.from({ length: trailingBlankCount }, (_, index) => <span className={styles.blankDay} aria-hidden="true" key={`trailing-${index}`} />)}
      </div>
    </div>

    <div className={styles.agenda} id="job-calendar-agenda" aria-live="polite">
      <div className={styles.agendaHeader}>
        <h3>{selectedDay.dateKey === todayDateKey ? "Today" : DAY_NAME.format(selectedDate)}</h3>
        <span>{selectedFullDate} · Central time</span>
      </div>
      {selectedDay.jobs.length === 0
        ? <p className={styles.empty}>Nothing scheduled.</p>
        : <ul className={styles.jobs} aria-label={`Jobs scheduled ${selectedFullDate}`}>
            {selectedDay.jobs.map((job) => <li key={job.id}>
              <Link href={`/ops/leads/${job.id}`} aria-label={`Open ${job.customer}, scheduled ${selectedFullDate} at ${JOB_TIME.format(new Date(job.scheduledAt))}`}>
                <span className={styles.jobTop}>
                  <strong>{job.customer}</strong>
                  <time dateTime={job.scheduledAt}>{JOB_TIME.format(new Date(job.scheduledAt))}</time>
                </span>
                <span className={styles.service}>{job.service || "Service not recorded"}</span>
                <span className={styles.jobNumber}>{job.publicId}</span>
              </Link>
            </li>)}
          </ul>}
    </div>
  </section>
}
