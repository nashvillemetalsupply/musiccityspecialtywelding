"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useActionState, useState } from "react"
import "./intake.css"
import { SafeActionButton, SafeSubmitButton } from "../safe-action-controls"
import { VoiceCaptureButton } from "../voice-capture-button"
import { changeCallDraftDispositionAction, saveInlineJobAction, undoInlineJobAction, type InlineJobSaveState } from "./actions"
import { LiveCallSketch } from "@/components/call-sketch/live-call-sketch"

type IntakeSource = "phone-in" | "walk-in"
type Fields = { name: string; phone: string; need: string }
const initialSaveState: InlineJobSaveState = { status: "idle" }

function callLabel(status: string) {
  if (["no-answer", "busy", "failed", "canceled"].includes(status)) return "Missed call"
  if (["answered", "completed"].includes(status)) return "Call finished"
  if (status === "ringing") return "On the phone now"
  return "Phone call"
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function InlineJobIntake({
  intakeKey,
  owner,
  voiceReady,
  initialSource = "phone-in",
  pendingTotal = 0,
  draft,
}: {
  intakeKey: string
  owner: boolean
  voiceReady: boolean
  initialSource?: IntakeSource
  pendingTotal?: number
  draft?: {
    publicId: string
    name: string
    phone: string
    need: string
    callStatus: string
    createdAt: string
    lastError: string
  }
}) {
  const router = useRouter()
  const [source, setSource] = useState<IntakeSource>(initialSource)
  const [manualIntakeKey, setManualIntakeKey] = useState(intakeKey)
  const [ignoredCallPublicId, setIgnoredCallPublicId] = useState("")
  const activeDraft = draft?.publicId === ignoredCallPublicId ? undefined : draft
  const callIdentity = activeDraft?.publicId ?? `manual:${manualIntakeKey}`
  const serverCallFields = { name: activeDraft?.name ?? "", phone: activeDraft?.phone ?? "", need: activeDraft?.need ?? "" }
  const [callEdit, setCallEdit] = useState<{ identity: string; fields: Fields } | null>(null)
  const callFields = callEdit?.identity === callIdentity ? callEdit.fields : serverCallFields
  const [walkInFields, setWalkInFields] = useState<Fields>({ name: "", phone: "", need: "" })
  const [moreOpen, setMoreOpen] = useState(false)
  const [dismissedCall, setDismissedCall] = useState<{ publicId: string; fields: Fields } | null>(null)
  const [actionError, setActionError] = useState("")
  const [hiddenReceiptKey, setHiddenReceiptKey] = useState("")
  const [saveState, saveAction, savePending] = useActionState(saveInlineJobAction, initialSaveState)
  const inbound = Boolean(activeDraft && source === "phone-in")
  const fields = source === "phone-in" ? callFields : walkInFields
  const setFields = (next: (current: Fields) => Fields) => {
    if (source === "phone-in") setCallEdit((current) => ({
      identity: callIdentity,
      fields: next(current?.identity === callIdentity ? current.fields : serverCallFields),
    }))
    else setWalkInFields(next)
  }
  const canSave = Boolean(fields.name.trim() && fields.need.trim())

  function switchSource(next: IntakeSource) {
    setSource(next)
    setDismissedCall(null)
    setActionError("")
  }

  async function changeDisposition(intent: "dismiss" | "restore") {
    setActionError("")
    const targetPublicId = intent === "restore" ? dismissedCall?.publicId ?? "" : activeDraft?.publicId ?? ""
    const targetFields = intent === "restore" ? dismissedCall?.fields ?? fields : fields
    if (!targetPublicId || source !== "phone-in") {
      setDismissedCall(intent === "dismiss" ? { publicId: "", fields: targetFields } : null)
      return
    }
    const data = new FormData()
    data.set("draftId", targetPublicId)
    data.set("intent", intent)
    try {
      const result = await changeCallDraftDispositionAction(data)
      if (result.status === "unchanged") throw new Error("That call changed on another device. Reload MCSW Jobs.")
      setDismissedCall(result.status === "dismissed" ? { publicId: targetPublicId, fields: targetFields } : null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The call could not be updated.")
    }
  }

  async function undoSavedJob() {
    if (saveState.status !== "saved") return
    setActionError("")
    const data = new FormData()
    data.set("leadId", String(saveState.leadId))
    data.set("source", saveState.source)
    data.set("intakeRef", saveState.intakeRef)
    try {
      await undoInlineJobAction(data)
      setHiddenReceiptKey(saveState.receiptKey)
      if (saveState.source === "manual") {
        const nextKey = crypto.randomUUID()
        setManualIntakeKey(nextKey)
        const restored = { name: saveState.name, phone: saveState.phone, need: saveState.need }
        if (source === "phone-in") setCallEdit({ identity: `manual:${nextKey}`, fields: restored })
        else setWalkInFields(restored)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The saved job could not be undone.")
    }
  }

  function continueAfterSaved() {
    if (saveState.status !== "saved") return
    setHiddenReceiptKey(saveState.receiptKey)
    setActionError("")
    if (saveState.source === "call") {
      setIgnoredCallPublicId(saveState.intakeRef)
      router.refresh()
      return
    }
    const nextKey = crypto.randomUUID()
    setManualIntakeKey(nextKey)
    if (source === "phone-in") setCallEdit({ identity: `manual:${nextKey}`, fields: { name: "", phone: "", need: "" } })
    else setWalkInFields({ name: "", phone: "", need: "" })
  }

  function continueAfterDismissed() {
    if (!dismissedCall) return
    setIgnoredCallPublicId(dismissedCall.publicId)
    setDismissedCall(null)
    setActionError("")
    router.refresh()
  }

  const savedJob = saveState.status === "saved" && saveState.receiptKey !== hiddenReceiptKey
    ? saveState
    : null

  if (savedJob) {
    const firstName = savedJob.name.trim().split(/\s+/)[0] || "customer"
    const callHref = `tel:${savedJob.phone.replace(/[^\d+]/g, "")}`
    return <section className="card intake intake-result" aria-live="polite">
      <div>
        <p className="t-caption intake-kicker">Job saved</p>
        <h1>{savedJob.name}</h1>
        <p>{savedJob.need}</p>
      </div>
      {actionError && <p className="intake-alert" role="alert">{actionError}</p>}
      <div className={`intake-actions${savedJob.phone ? "" : " is-single"}`}>
        {savedJob.phone && <a className="btn btn--sm btn--go" href={callHref} aria-label={`Call ${firstName}`}>Call customer</a>}
        <Link className="btn btn--sm btn--edge" href={`/ops/leads/${savedJob.leadId}`}>Open Job</Link>
        <SafeActionButton className="btn btn--sm btn--edge" busyLabel="Undoing..." onAction={undoSavedJob}>Undo</SafeActionButton>
        <button type="button" className="btn btn--sm btn--edge" onClick={continueAfterSaved}>{savedJob.source === "call" && draft?.publicId && draft.publicId !== savedJob.intakeRef ? "Next call" : "Done"}</button>
      </div>
    </section>
  }

  if (dismissedCall) return <section className="card intake intake-result" aria-live="polite">
    <p className="t-caption intake-kicker">Call cleared</p>
    <h1>No job was created.</h1>
    <p>{dismissedCall.fields.name.trim() || "The caller"} can be restored if that was a mistake.</p>
    {actionError && <p className="intake-alert" role="alert">{actionError}</p>}
    <div className="intake-actions is-single">
      <SafeActionButton className="btn btn--sm btn--edge" busyLabel="Restoring…" onAction={() => changeDisposition("restore")}>Undo</SafeActionButton>
      <button type="button" className="btn btn--sm btn--edge" onClick={continueAfterDismissed}>{draft?.publicId && draft.publicId !== dismissedCall.publicId ? "Next call" : "Done"}</button>
    </div>
  </section>

  return <section className="card intake" aria-labelledby="jobs-home-intake-title">
    <header className="intake-head">
      <div>
        {source === "phone-in" && activeDraft && <p className="t-caption intake-kicker">{`${callLabel(activeDraft.callStatus)} · ${formatTime(activeDraft.createdAt)}`}</p>}
        <h1 className="t-title" id="jobs-home-intake-title">{source === "phone-in" ? "Phone call" : "Walk-in"}</h1>
      </div>
      <div className="intake-links">
        {source === "phone-in" && pendingTotal > 1 && <Link className="btn btn--sm btn--edge" href="/board/calls">{pendingTotal - 1} more {pendingTotal - 1 === 1 ? "call" : "calls"}</Link>}
        {owner && <Link className="btn btn--sm btn--edge intake-sketch-link" href="/ops/call-sketch" aria-label="Open the Call Sketch practice workspace">Call Sketch</Link>}
        <button type="button" className="btn btn--sm btn--edge" onClick={() => switchSource(source === "phone-in" ? "walk-in" : "phone-in")}>{source === "phone-in" ? "Walk-in" : "Phone call"}</button>
      </div>
    </header>

    {(activeDraft?.lastError || actionError || saveState.status === "error") && <p className="intake-alert" role="alert">{actionError || (saveState.status === "error" ? saveState.message : activeDraft?.lastError)}</p>}

    {owner && inbound && <LiveCallSketch draftId={activeDraft!.publicId} />}

    <form action={saveAction} className="intake-form" aria-busy={savePending}>
      {inbound ? <input type="hidden" name="draftId" value={activeDraft!.publicId} /> : <>
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="intakeKey" value={manualIntakeKey} />
      </>}

      <div className="intake-person">
        <label className="intake-name">
          <span className="intake-sr-only">Customer or company name</span>
          <input
            name="firstName"
            value={fields.name}
            onChange={(event) => setFields((current) => ({ ...current, name: event.target.value }))}
            placeholder="Name or company"
            autoComplete="name"
            required
            aria-required="true"
          />
        </label>
        <div className={`intake-phone${source === "walk-in" ? " is-walk-in" : ""}`}>
          <span>{source === "phone-in" ? "called from" : "Phone (optional)"}</span>
          <label>
            <span className="intake-sr-only">Phone number</span>
            <input
              name="phone"
              value={fields.phone}
              onChange={(event) => setFields((current) => ({ ...current, phone: event.target.value }))}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={source === "walk-in" ? "(615) 555-0123" : undefined}
            />
          </label>
        </div>
      </div>

      <label className="intake-need">
        <span>Needs</span>
        <textarea
          name="message"
          value={fields.need}
          onChange={(event) => setFields((current) => ({ ...current, need: event.target.value }))}
          placeholder={source === "walk-in" ? "What did they bring in?" : "Gate, trailer, repair, fabrication…"}
          rows={2}
          required
          aria-required="true"
        />
      </label>

      <div className="intake-tools">
        <VoiceCaptureButton
          available={voiceReady}
          className="btn btn--sm btn--edge intake-tool"
          idleLabel="Speak"
          recoveryKey={`home-intake:${activeDraft?.publicId ?? manualIntakeKey}`}
          onTranscript={(transcript) => setFields((current) => ({ ...current, need: [current.need.trim(), transcript.trim()].filter(Boolean).join(" ") }))}
          onError={setActionError}
        />
        <button type="button" className="btn btn--sm btn--edge intake-tool" aria-expanded={moreOpen} aria-controls="jobs-inline-more" onClick={() => setMoreOpen((current) => !current)}>{moreOpen ? "Close details" : "More details"}</button>
      </div>

      {moreOpen && <div className="intake-more" id="jobs-inline-more">
        <label><span>Service</span><select name="service" defaultValue=""><option value="">Not set</option><option>Mobile Welding (On-Site)</option><option>Trailer / Truck Welding Repair</option><option>Equipment &amp; Structural Repair</option><option>Architectural Welding &amp; Fabrication</option><option>Specialty Fabrication</option><option>Aluminum / Boat Welding</option><option>Not Sure / Other</option></select></label>
        <label><span>How they found us</span><select name="referral" defaultValue=""><option value="">Not asked</option><option>Google</option><option>Repeat customer</option><option>Referral</option><option>Facebook or Instagram</option><option>Other</option></select></label>
      </div>}

      <div className="intake-actions">
        {source === "walk-in" ? <button type="button" className="btn btn--sm btn--edge" onClick={() => switchSource("phone-in")}>Cancel</button> : owner || !activeDraft ? <SafeActionButton className="btn btn--sm btn--edge" busyLabel="Clearing…" onAction={() => changeDisposition("dismiss")}>Not a job</SafeActionButton> : <span />}
        <SafeSubmitButton className="btn btn--sm btn--go" pendingLabel="Saving job…" disabled={!canSave}>Save Job</SafeSubmitButton>
      </div>
    </form>
  </section>
}
