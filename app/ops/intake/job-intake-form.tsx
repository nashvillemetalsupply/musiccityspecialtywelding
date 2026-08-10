import Link from "next/link"
import type { ComponentProps } from "react"
import { createManualLead } from "../actions"
import { SafeSubmitButton } from "../safe-action-controls"
import { dismissCallDraftAction, saveCallDraftAction } from "./actions"

type Source = "phone-in" | "walk-in"

function phoneHref(phone: string) {
  const digits = phone.replace(/\D/g, "")
  return digits ? `tel:+${digits.length === 10 ? `1${digits}` : digits}` : ""
}

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
  const action = (inbound ? saveCallDraftAction : createManualLead) as ComponentProps<"form">["action"]
  const isWalkIn = source === "walk-in"
  return <main className="jobs-intake-page">
    <section className="jobs-intake-stage" aria-labelledby="jobs-intake-title">
      <Link className="jobs-intake-back" href="/ops">← Back to jobs</Link>
      <header className="jobs-intake-heading">
        <span>{inbound ? callState(draft!.callStatus) : "New job"}</span>
        <h1 id="jobs-intake-title">Save the job</h1>
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
        {draft!.phone && <a href={phoneHref(draft!.phone)} aria-label={`Call ${draft!.name || formatPhone(draft!.phone)}`}>Call back</a>}
      </div>}

      {draft?.lastError && <p className="jobs-intake-error" role="alert">{draft.lastError}</p>}

      <form action={action} className="jobs-intake-form">
        {inbound && <input type="hidden" name="draftId" value={draft!.publicId} />}
        {!inbound && <>
          <input type="hidden" name="source" value={source} />
          <input type="hidden" name="intakeKey" value={intakeKey} />
        </>}

        <label className="jobs-intake-need">
          <span>What do they need?</span>
          <textarea
            name="message"
            defaultValue={draft?.need ?? ""}
            placeholder={isWalkIn ? "What did they bring in?" : "Gate, trailer, repair, fabrication…"}
            rows={4}
            required={!inbound}
            autoFocus
          />
          {inbound && <small>Optional if the recorded call already covers it.</small>}
        </label>

        <div className="jobs-intake-person">
          <label>
            <span>Name or company</span>
            <input name="firstName" defaultValue={draft?.name ?? ""} autoComplete="name" placeholder={isWalkIn ? "Who is here?" : "Caller name"} />
          </label>
          <label>
            <span>Phone</span>
            <input name="phone" defaultValue={draft?.phone ?? ""} type="tel" inputMode="tel" autoComplete="tel" placeholder="(615) 555-0123" />
          </label>
        </div>

        <details className="jobs-intake-details">
          <summary>More details</summary>
          <div>
            <label><span>Service</span><select name="service" defaultValue=""><option value="">Not sure yet</option><option>Mobile Welding (On-Site)</option><option>Trailer / Truck Welding Repair</option><option>Equipment &amp; Structural Repair</option><option>Architectural Welding &amp; Fabrication</option><option>Specialty Fabrication</option><option>Aluminum / Boat Welding</option><option>Not Sure / Other</option></select></label>
            <label><span>Referral</span><input name="referral" placeholder="Who sent them?" /></label>
          </div>
        </details>

        <div className="jobs-intake-submit">
          <SafeSubmitButton className="jobs-save-job" pendingLabel="Saving job…">Save Job</SafeSubmitButton>
        </div>
      </form>

      {inbound && owner && <form action={dismissCallDraftAction} className="jobs-intake-dismiss">
        <input type="hidden" name="draftId" value={draft!.publicId} />
        <SafeSubmitButton className="jobs-not-job" pendingLabel="Filing…">Not a job</SafeSubmitButton>
      </form>}
    </section>
  </main>
}
