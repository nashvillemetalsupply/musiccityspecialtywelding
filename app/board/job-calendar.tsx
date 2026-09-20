"use client"

import { useActionState, useRef, useState } from "react"
import Link from "next/link"
import { SafeSubmitButton } from "@/app/ops/safe-action-controls"
import type { CalendarDay } from "@/lib/job-calendar-data"
import { calendarQuickAddIntakeKey } from "@/lib/calendar-quick-add.mjs"
import { calendarNavigationIndex, selectedCalendarDay } from "@/lib/job-calendar.mjs"
import { createCalendarJobAction, type CalendarQuickAddState } from "./calendar-actions"
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

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "short",
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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function dateFromKey(dateKey: string) {
  // Noon UTC is safely inside the same civil date in Central time, including
  // both DST transition weekends.
  return new Date(`${dateKey}T12:00:00.000Z`)
}

const QUICK_ADD_INITIAL: CalendarQuickAddState = { status: "idle" }

export function JobCalendar({
  days,
  todayDateKey,
  quickAddIntakeKey,
}: {
  days: CalendarDay[]
  todayDateKey: string
  quickAddIntakeKey?: string
}) {
  const [selectedDateKey, setSelectedDateKey] = useState(() => (
    days.some((day) => day.dateKey === todayDateKey) ? todayDateKey : days[0]?.dateKey ?? ""
  ))
  const dayButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [quickAddState, quickAddAction, quickAddPending] = useActionState(createCalendarJobAction, QUICK_ADD_INITIAL)
  if (days.length < 28 || days.length > 31) return null
  const scheduledCount = days.reduce((total, day) => total + day.jobs.length, 0)
  const firstDate = dateFromKey(days[0].dateKey)
  const selectedDay = selectedCalendarDay(days, selectedDateKey) ?? days[0]
  const selectedDate = dateFromKey(selectedDay.dateKey)
  const selectedFullDate = FULL_DATE.format(selectedDate)
  const leadingBlankCount = firstDate.getUTCDay()
  const trailingBlankCount = (7 - ((leadingBlankCount + days.length) % 7)) % 7
  const activeIntakeKey = quickAddIntakeKey ? calendarQuickAddIntakeKey(quickAddState, quickAddIntakeKey) : ""

  function moveSelection(index: number, event: React.KeyboardEvent<HTMLButtonElement>) {
    const nextIndex = calendarNavigationIndex(index, event.key, days.length, 7, leadingBlankCount)
    if (nextIndex === null) return
    event.preventDefault()
    setSelectedDateKey(days[nextIndex].dateKey)
    dayButtonRefs.current[nextIndex]?.focus()
  }

  return <section className={`card ${styles.calendar}`} aria-labelledby="job-calendar-title">
    <header className={styles.header}>
      <div className={styles.headerLead}>
        <span className={styles.eyebrow}>Schedule</span>
        <h2 className="t-title" id="job-calendar-title">{MONTH_YEAR.format(firstDate)}</h2>
        <p>Full month · Central time</p>
      </div>
      <div className={styles.headerMeta}>
        <span className={styles.total}><strong>{scheduledCount}</strong><small>{scheduledCount === 1 ? "scheduled job" : "scheduled jobs"}</small></span>
      </div>
    </header>

    <p className={styles.instruction} id="job-calendar-instructions">
      Use arrow keys to move by day or week. Home and End move within a row.
    </p>
    <div className={styles.body}>
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
              <span className={styles.dayName}>{isToday ? "Today" : DAY_NAME.format(date)}</span>
              <time className={styles.dayNumber} dateTime={day.dateKey}>{date.getUTCDate()}</time>
              <b aria-hidden="true">{day.jobs.length || "—"}</b>
            </button>
          })}
          {Array.from({ length: trailingBlankCount }, (_, index) => <span className={styles.blankDay} aria-hidden="true" key={`trailing-${index}`} />)}
        </div>
      </div>

      <div className={styles.agenda} id="job-calendar-agenda" aria-live="polite">
        <div className={styles.agendaHeader}>
          <div>
            <span className={styles.agendaKicker}>{selectedDay.dateKey === todayDateKey ? "Today" : "Selected day"}</span>
            <h3>{MONTH_DAY.format(selectedDate)}</h3>
          </div>
          <span>Central time</span>
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
        {quickAddIntakeKey && <div className={styles.quickAdd}>
          <div className={styles.quickAddHeading}>
            <span className={styles.agendaKicker}>Add appointment</span>
            <h4>Put a job on this day</h4>
          </div>
          <form key={activeIntakeKey} action={quickAddAction} aria-busy={quickAddPending}>
            <input type="hidden" name="intakeKey" value={activeIntakeKey} />
            <div className={styles.whenFields}>
              <label>
                <span>Date</span>
                <input
                  name="scheduledDate"
                  type="date"
                  value={selectedDay.dateKey}
                  required
                  onChange={(event) => {
                    if (days.some((day) => day.dateKey === event.currentTarget.value)) {
                      setSelectedDateKey(event.currentTarget.value)
                    }
                  }}
                />
              </label>
              <label>
                <span>Time <small>Central</small></span>
                <input name="scheduledTime" type="time" defaultValue="08:00" required />
              </label>
            </div>
            <label>
              <span>Name or company</span>
              <input name="firstName" type="text" autoComplete="name" maxLength={120} required />
            </label>
            <label>
              <span>Phone</span>
              <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(615) 555-0123" maxLength={40} required />
            </label>
            <label>
              <span>What do they need?</span>
              <textarea name="message" rows={3} maxLength={2000} placeholder="Repair, fabrication, location, timing..." required />
            </label>
            <SafeSubmitButton className={styles.quickAddButton} pendingLabel="Adding to calendar..." disabled={quickAddPending}>Add to calendar</SafeSubmitButton>
          </form>
          {quickAddState.status === "error" && <p className={styles.quickAddError} role="alert">{quickAddState.message}</p>}
          {quickAddState.status === "partial" && <p className={styles.quickAddError} role="alert">
            {quickAddState.message} <Link href={`/ops/leads/${quickAddState.leadId}`}>Open saved job</Link>
          </p>}
          {quickAddState.status === "saved" && <p className={styles.quickAddSuccess} role="status">
            {quickAddState.customer} was added. <Link href={`/ops/leads/${quickAddState.leadId}`}>Open job</Link>
          </p>}
        </div>}
      </div>
    </div>
  </section>
}
