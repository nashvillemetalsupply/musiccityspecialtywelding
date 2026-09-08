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

const DAY_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
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

function dateFromKey(dateKey: string) {
  // Noon UTC is safely inside the same civil date in Central time, including
  // both DST transition weekends.
  return new Date(`${dateKey}T12:00:00.000Z`)
}

export function JobCalendar({ days }: { days: CalendarDay[] }) {
  const [selectedDateKey, setSelectedDateKey] = useState(() => days[0]?.dateKey ?? "")
  const dayButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  if (days.length !== 30) return null
  const scheduledCount = days.reduce((total, day) => total + day.jobs.length, 0)
  const firstDate = dateFromKey(days[0].dateKey)
  const lastDate = dateFromKey(days[days.length - 1].dateKey)
  const selectedDay = selectedCalendarDay(days, selectedDateKey) ?? days[0]
  const selectedDate = dateFromKey(selectedDay.dateKey)
  const selectedFullDate = FULL_DATE.format(selectedDate)

  function moveSelection(index: number, event: React.KeyboardEvent<HTMLButtonElement>) {
    const nextIndex = calendarNavigationIndex(index, event.key, days.length)
    if (nextIndex === null) return
    event.preventDefault()
    setSelectedDateKey(days[nextIndex].dateKey)
    dayButtonRefs.current[nextIndex]?.focus()
  }

  return <section className={`card ${styles.calendar}`} aria-labelledby="job-calendar-title">
    <header className={styles.header}>
      <div>
        <h2 className="t-title" id="job-calendar-title">30-day schedule</h2>
        <p>{DAY_DATE.format(firstDate)}–{DAY_DATE.format(lastDate)} · Central time · active scheduled jobs</p>
      </div>
      <span className={styles.total}>{scheduledCount} {scheduledCount === 1 ? "job" : "jobs"}</span>
    </header>

    <p className={styles.instruction} id="job-calendar-instructions">
      Use arrow keys to move by day or week. Home and End move within a row.
    </p>
    <div className={styles.grid} role="group" aria-label="Thirty calendar days, today first" aria-describedby="job-calendar-instructions">
      {days.map((day, index) => {
        const date = dateFromKey(day.dateKey)
        const fullDate = FULL_DATE.format(date)
        const selected = day.dateKey === selectedDay.dateKey
        const jobLabel = day.jobs.length === 0
          ? "no jobs scheduled"
          : `${day.jobs.length} ${day.jobs.length === 1 ? "job" : "jobs"} scheduled`
        return <button
          className={`${styles.dayButton}${index === 0 ? ` ${styles.today}` : ""}${day.jobs.length ? ` ${styles.busy}` : ""}`}
          key={day.dateKey}
          type="button"
          ref={(element) => { dayButtonRefs.current[index] = element }}
          aria-label={`${index === 0 ? "Today, " : ""}${fullDate}, ${jobLabel}`}
          aria-pressed={selected}
          aria-controls="job-calendar-agenda"
          tabIndex={selected ? 0 : -1}
          onClick={() => setSelectedDateKey(day.dateKey)}
          onKeyDown={(event) => moveSelection(index, event)}
        >
          <span>{index === 0 ? "Today" : DAY_NAME.format(date)}</span>
          <time dateTime={day.dateKey}>{date.getUTCDate()}</time>
          <b aria-hidden="true">{day.jobs.length || "—"}</b>
        </button>
      })}
    </div>

    <div className={styles.agenda} id="job-calendar-agenda" aria-live="polite">
      <div className={styles.agendaHeader}>
        <h3>{selectedDay.dateKey === days[0].dateKey ? "Today" : DAY_NAME.format(selectedDate)}</h3>
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
