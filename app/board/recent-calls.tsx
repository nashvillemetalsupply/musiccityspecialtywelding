"use client"

import Link from "next/link"
import { useActionState } from "react"
import { SafeSubmitButton } from "@/app/ops/safe-action-controls"
import { dismissCallFromBoardAction, quickSaveCallAction, type QuickSaveState } from "@/app/ops/intake/actions"
import type { CallSummary } from "@/lib/call-summary-shared"

// The board's own slice of the pending-call queue. Same rows the Calls tab
// reads, ten at most, newest first. The owner asked for this on 2026-09-03
// because saving a call meant leaving the board, opening the call, and typing
// a name before the save button would work. Here it is one tap.
export type BoardCall = {
  publicId: string
  name: string
  phone: string
  need: string
  callStatus: string
  createdAt: string
  // Written after the call by summarizeCallDraft; null until then.
  summary: CallSummary | null
}

const MISSED = ["no-answer", "busy", "failed", "canceled"]

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
  if (digits.length !== 10) return phone || "Number unavailable"
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

const CENTRAL_DAY: Intl.DateTimeFormatOptions = { timeZone: "America/Chicago", month: "short", day: "numeric" }

function formatWhen(iso: string, nowMs: number) {
  const date = new Date(iso)
  const time = date.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })
  const day = date.toLocaleDateString("en-US", CENTRAL_DAY)
  return day === new Date(nowMs).toLocaleDateString("en-US", CENTRAL_DAY) ? time : `${day} · ${time}`
}

const initialState: QuickSaveState = { status: "idle" }

function CallRow({ call, owner, nowMs }: { call: BoardCall; owner: boolean; nowMs: number }) {
  const [state, save, pending] = useActionState(quickSaveCallAction, initialState)
  const who = call.name.trim() || formatPhone(call.phone)
  const kind = MISSED.includes(call.callStatus) ? "Missed" : call.callStatus === "ringing" ? "On the line" : "Finished"
  const summary = call.summary
  const notJob = summary?.is_job === "no"
  // The summary's sentence leads; the draft's own need is the fallback, and a
  // finished call with neither says so rather than showing a blank line.
  const said = summary?.need.trim() || call.need.trim()
  const details = summary ? [...summary.details, summary.where_when ?? ""].filter(Boolean).join(" · ") : ""

  if (state.status === "saved") {
    // The server list drops this row on the next render; until then the row
    // says what happened and where the job went, so a tap never just vanishes.
    return <li className="call-row saved">
      <span className="who">{who}</span>
      <span className="said">Saved as a job. It is at the top of the tracker.</span>
      <span className="do"><Link className="btn btn--sm btn--edge" href={`/ops/leads/${state.leadId}`}>Open job</Link></span>
    </li>
  }

  return <li className={notJob ? "call-row not-job" : "call-row"}>
    <span className="when">{formatWhen(call.createdAt, nowMs)} · {kind}</span>
    <span className="who">{who}{call.name.trim() && <em> {formatPhone(call.phone)}</em>}</span>
    {said
      ? <span className="said">{said}</span>
      : kind === "Finished" && <span className="said quiet">{summary ? "Nothing asked for on this call." : "Not read yet."}</span>}
    {details && <span className="said quiet">{details}</span>}
    {notJob && <span className="flag">Probably not a job{summary?.not_job_reason && ` · ${summary.not_job_reason}`}</span>}
    <span className="do">
      <form action={save}>
        <input type="hidden" name="draftId" value={call.publicId} />
        <SafeSubmitButton className={notJob ? "btn btn--edge" : "btn btn--go"} pendingLabel="Saving…" disabled={pending}>Save as job</SafeSubmitButton>
      </form>
      <Link className="btn btn--edge" href={`/ops/intake/${call.publicId}`}>Review</Link>
      {owner && <form action={dismissCallFromBoardAction}>
        <input type="hidden" name="draftId" value={call.publicId} />
        <SafeSubmitButton className={notJob ? "btn btn--go" : "btn btn--edge"} pendingLabel="Removing…">Not a job</SafeSubmitButton>
      </form>}
    </span>
    {state.status === "error" && <span className="err" role="alert">{state.message}</span>}
  </li>
}

export function RecentCalls({ calls, total, owner, nowMs }: { calls: BoardCall[]; total: number; owner: boolean; nowMs: number }) {
  if (calls.length === 0) return null
  return <details className="calls-drop">
    <summary>
      <span className="n">{total}</span>
      <span>{total === 1 ? "call to save" : "calls to save"}</span>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><path d="M4 6 8 10l4-4"/></svg>
    </summary>
    <ul>
      {calls.map((call) => <CallRow call={call} owner={owner} nowMs={nowMs} key={call.publicId} />)}
    </ul>
    {total > calls.length && <p className="foot"><Link href="/board/calls">All {total} calls</Link></p>}
  </details>
}
