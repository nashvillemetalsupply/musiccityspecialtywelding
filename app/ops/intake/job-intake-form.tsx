"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useTransition } from "react"
import { createManualLead } from "../actions"
import { SafeSubmitButton } from "../safe-action-controls"
import { dismissCallDraftAction, saveCallDraftAction } from "./actions"

type Source = "phone-in" | "walk-in"

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
  if (digits.length !== 10) return phone
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function callState(status: string) {
  if (["no-answer", "busy", "failed", "canceled"].includes(status)) return "Missed call"
  if (["answered", "completed"].includes(status)) return "Call finished"
  if (status === "ringing") return "Call in progress"
  return "Phone call"
}

export function JobIntakeForm({
  source,
  intakeKey,
  draft,
  owner,
}: {
  source: Source
  intakeKey?: string
  draft?: {
    publicId: string
    name: string
    phone: string
    need: string
    status: string
    callStatus: string
    createdAt: string
    lastError: string
  }
  owner: boolean
}) {
  const inbound = Boolean(draft)
  const action: (formData: FormData) => Promise<void> = inbound ? saveCallDraftAction : createManualLead
  const isWalkIn = source === "walk-in"
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startSubmit] = useTransition()
  // Reflects the fields the browser's own constraint check rejected. No new rules:
  // the only source of truth is the `required` attributes already on the fields.
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const flag = (name: string) => ({
    "aria-invalid": invalid[name] ? ("true" as const) : undefined,
    onInvalid: () => setInvalid((current) => ({ ...current, [name]: true })),
    onInput: () => setInvalid((current) => (current[name] ? { ...current, [name]: false } : current)),
  })

  // After a submit that returned field errors, put the keyboard on the first one.
  useEffect(() => {
    if (!Object.values(invalid).some(Boolean)) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [invalid])

  const needHintId = "jobs-intake-need-hint"
  const errorId = "jobs-intake-error"
  const needDescribedBy = [inbound ? needHintId : "", draft?.lastError ? errorId : ""].filter(Boolean).join(" ")

  return <div className="jobs-intake-page">
    <section className="jobs-intake-stage" aria-labelledby="jobs-intake-title">
      <Link className="jobs-intake-back" href="/ops">← Back to jobs</Link>
      <header className="jobs-intake-heading">
        <span>{inbound ? callState(draft!.callStatus) : "New job"}</span>
        <h1 id="jobs-intake-title">{inbound ? "Save call as job" : "Save the job"}</h1>
        <p>{inbound ? "The call is already safe." : "Capture the part the shop needs."}</p>
      </header>

      {!inbound && <nav className="jobs-intake-source" aria-label="How they reached the shop">
        <Link className={!isWalkIn ? "is-active" : ""} href="/ops/intake/new?source=phone-in">Phone call</Link>
        <Link className={isWalkIn ? "is-active" : ""} href="/ops/intake/new?source=walk-in">Walk-in</Link>
      </nav>}

      {inbound && <div className="jobs-caller-card">
        <div>
          <span>{callState(draft!.callStatus)}</span>
          <strong>{draft!.name || "Caller"}</strong>
          <time>{new Date(draft!.createdAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}</time>
        </div>
        {draft!.phone && <div>
          <strong>{formatPhone(draft!.phone)}</strong>
          <small>Save first so the callback stays with this job.</small>
        </div>}
      </div>}

      {draft?.lastError && <p className="jobs-intake-error" role="alert" id={errorId}>{draft.lastError}</p>}

      <form
        ref={formRef}
        action={(formData: FormData) => startSubmit(async () => { await action(formData) })}
        className="jobs-intake-form"
        aria-busy={pending}
      >
        {inbound && <input type="hidden" name="draftId" value={draft!.publicId} />}
        {!inbound && <>
          <input type="hidden" name="source" value={source} />
          <input type="hidden" name="intakeKey" value={intakeKey} />
        </>}

        <label className="jobs-intake-need" htmlFor="jobs-intake-need">
          <span>What do they need?</span>
          <textarea
            id="jobs-intake-need"
            name="message"
            autoComplete="off"
            defaultValue={draft?.need ?? ""}
            placeholder={isWalkIn ? "What did they bring in?" : "Gate, trailer, repair, fabrication…"}
            rows={4}
            required={!inbound}
            aria-describedby={needDescribedBy || undefined}
            autoFocus
            {...flag("message")}
          />
          {inbound && <small id={needHintId}>Optional if the recorded call already covers it.</small>}
        </label>

        <div className="jobs-intake-person">
          <label htmlFor="jobs-intake-name">
            <span>Name or company</span>
            <input id="jobs-intake-name" name="firstName" type="text" autoComplete="name" spellCheck={false} defaultValue={draft?.name ?? ""} placeholder={isWalkIn ? "Who is here?" : "Caller name"} {...flag("firstName")} />
          </label>
          <label htmlFor="jobs-intake-phone">
            <span>Phone</span>
            <input id="jobs-intake-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={draft?.phone ?? ""} placeholder="(615) 555-0123" {...flag("phone")} />
          </label>
        </div>

        <details className="jobs-intake-details">
          <summary>More details</summary>
          <div>
            <label htmlFor="jobs-intake-service"><span>Service</span><select id="jobs-intake-service" name="service" defaultValue=""><option value="">Not sure yet</option><option>Mobile Welding (On-Site)</option><option>Trailer / Truck Welding Repair</option><option>Equipment &amp; Structural Repair</option><option>Architectural Welding &amp; Fabrication</option><option>Specialty Fabrication</option><option>Aluminum / Boat Welding</option><option>Not Sure / Other</option></select></label>
            <label htmlFor="jobs-intake-referral"><span>Referral</span><input id="jobs-intake-referral" name="referral" type="text" autoComplete="off" placeholder="Who sent them?" /></label>
          </div>
        </details>

        <div className="jobs-intake-submit">
          <SafeSubmitButton className="jobs-save-job" pendingLabel="Saving job…">
            {inbound ? "Save call as job" : "Save job"}
          </SafeSubmitButton>
        </div>
      </form>

      {inbound && owner && <form action={dismissCallDraftAction} className="jobs-intake-dismiss">
        <input type="hidden" name="draftId" value={draft!.publicId} />
        <SafeSubmitButton className="jobs-not-job" pendingLabel="Filing…">Not a job</SafeSubmitButton>
      </form>}
    </section>
  </div>
}
