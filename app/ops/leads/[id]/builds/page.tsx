import { Check, CircleCheck, CirclePause, History, PencilLine, RefreshCcw, X } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { SafeSubmitButton } from "@/app/ops/safe-action-controls"
import { BuildSheetDrawing } from "@/components/build-sheets/build-sheet-drawing"
import { buildSheetsEnabled } from "@/lib/build-sheets-access"
import { getBuildsWorkspace } from "@/lib/build-sheets"
import { projectBuildDrawing, type BuildDrawingProjection } from "@/lib/build-sheets-continuation.mjs"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import {
  addWorkingBuildFactAction,
  decideBuildFactAction,
  lockBuildSheetAction,
  proposeBuildFactChangeAction,
} from "./actions"
import { ActionKeyField } from "./action-key"
import "./builds.css"

export const dynamic = "force-dynamic"

type Params = Promise<{ id: string }>

function formatValue(value: number | string, unit: string) {
  if (!unit) return String(value)
  if (unit === "in") return `${value}\u2033`
  return `${value} ${unit}`
}

function stateLabel(state: string) {
  if (state === "still-need") return "Still need"
  if (state === "working-number") return "Shop estimate"
  if (state === "confirmed") return "Confirmed"
  return "Heard on call"
}

function paperworkLabel(status: string) {
  if (status === "old-numbers") return "Old numbers"
  if (status === "needs-update") return "Needs update"
  if (status === "hold") return "Hold — change needs review"
  return "Current"
}

function paperworkNote(status: string, sourceBuildSheetNumber: number) {
  if (status === "current") return ""
  if (status === "old-numbers") return "Historical record only. Do not build from these numbers."
  if (status === "needs-update") return "Historical record. Update the source facts before using it."
  if (status === "hold") return "Wait for owner review. This is not current for fabrication."
  return `Source record for Build Sheet ${sourceBuildSheetNumber}.`
}

function PaperworkStatusIcon({ status }: { status: string }) {
  if (status === "old-numbers") return <History aria-hidden="true" />
  if (status === "needs-update") return <RefreshCcw aria-hidden="true" />
  if (status === "hold") return <CirclePause aria-hidden="true" />
  return <CircleCheck aria-hidden="true" />
}

const workingNumberKeys = new Set([
  "gate_leaf.finished_width",
  "gate_leaf.finished_height",
  "frame.stock_size",
  "frame.rail_count",
])

export default async function BuildsPage({ params }: { params: Params }) {
  const operator = await getAuthenticatedOperator()
  if (!operator || operator.role !== "owner" || !buildSheetsEnabled()) notFound()
  const { id } = await params
  const leadId = Number(id)
  if (!Number.isInteger(leadId) || leadId <= 0) notFound()
  const workspace = await getBuildsWorkspace(leadId)
  if (!workspace) notFound()

  const conflictClaims = new Set(workspace.draft.conflicts.flatMap((conflict) => conflict.claimIds))
  const acceptedCount = workspace.draft.factRows.filter((fact) => fact.state === "confirmed" || fact.state === "working-number").length
  const latestSheet = workspace.sheets.at(-1)
  let drawing: BuildDrawingProjection | null = null
  if (latestSheet) {
    try {
      drawing = projectBuildDrawing(latestSheet.snapshot)
    } catch {
      drawing = null
    }
  }

  return <main className="ops-builds">
    <header className="ops-builds-header">
      <div>
        <p className="t-caption">Job #{workspace.lead.id}</p>
        <h1 className="t-title">Fabrication</h1>
        <span className="t-caption">{workspace.lead.first_name} {workspace.lead.last_name}</span>
      </div>
    </header>

    <div className="ops-builds-grid">
      <section className="card ops-builds-panel" aria-labelledby="draft-heading">
        <header className="ops-builds-panel-head">
          <div>
            <h2 className="t-sub" id="draft-heading">{workspace.draft.conflicts.length ? "Doesn't match" : "Shop facts"}</h2>
          </div>
          <strong>{workspace.draft.factRows.length} facts</strong>
        </header>

        {workspace.draft.recommendedQuestion && <aside className="ops-builds-question">
          <span>Ask next</span>
          <strong>{workspace.draft.recommendedQuestion.question}</strong>
          <p>{workspace.draft.recommendedQuestion.reason}</p>
        </aside>}

        <div className="ops-builds-facts">
          {workspace.draft.factRows.map((fact, index) => {
            if (!("id" in fact)) return <article className="ops-builds-fact is-missing" key={fact.factKey}>
              <div className="ops-builds-fact-top">
                <div><span>{fact.label}</span><strong>—</strong></div>
                <em>{stateLabel(fact.state)}</em>
              </div>
              {workingNumberKeys.has(fact.factKey) && <form className="ops-builds-inline-form" action={addWorkingBuildFactAction}>
                <input type="hidden" name="leadId" value={leadId} />
                <input type="hidden" name="factKey" value={fact.factKey} />
                <ActionKeyField scope={`working:${leadId}:${fact.factKey}`} />
                <label htmlFor={`build-estimate-${fact.factKey}`}><span>Enter a shop estimate</span><input name="value" id={`build-estimate-${fact.factKey}`} type="number" min="0.01" step="0.01" inputMode="decimal" autoComplete="off" required /></label>
                <SafeSubmitButton className="btn btn--edge" pendingLabel="Filing…">Use estimate</SafeSubmitButton>
              </form>}
            </article>

            const isConflict = conflictClaims.has(Number(fact.id))
            const sourceHref = `/ops/leads/${leadId}#record-${fact.sourceEventId}`
            return <article className={`ops-builds-fact${isConflict ? " is-conflict" : ""}`} key={`${fact.factKey}-${fact.id}-${index}`}>
              <div className="ops-builds-fact-top">
                <div>
                  <span>{fact.label}{isConflict ? " / competing reading" : ""}</span>
                  <strong>{formatValue(fact.value, fact.unit)}</strong>
                </div>
                <em>{stateLabel(fact.state)}</em>
              </div>
              {fact.reference && <p className="ops-builds-reference">Measured {fact.reference}</p>}
              <blockquote>“{fact.original}” <Link href={sourceHref}>From the call</Link></blockquote>

              <div className="ops-builds-actions">
                {fact.state !== "confirmed" && <form action={decideBuildFactAction}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={fact.id} />
                  <input type="hidden" name="kind" value="confirm" />
                  <ActionKeyField scope={`decision:${leadId}:${fact.id}:confirm`} />
                  <SafeSubmitButton className="btn btn--go" pendingLabel="Confirming…">
                    <Check aria-hidden="true" />
                    <span className="ops-builds-action-label">Confirm</span>
                    <span className="ops-builds-action-note" aria-hidden="true">Lock this value</span>
                  </SafeSubmitButton>
                </form>}
                {fact.state === "heard-on-call" && <form action={decideBuildFactAction}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={fact.id} />
                  <input type="hidden" name="kind" value="working" />
                  <ActionKeyField scope={`decision:${leadId}:${fact.id}:working`} />
                  <SafeSubmitButton className="btn btn--edge" pendingLabel="Filing…">
                    <PencilLine aria-hidden="true" />
                    <span className="ops-builds-action-label">Use estimate</span>
                    <span className="ops-builds-action-note" aria-hidden="true">Not fab-ready</span>
                  </SafeSubmitButton>
                </form>}
                {fact.state !== "confirmed" && <form action={decideBuildFactAction}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={fact.id} />
                  <input type="hidden" name="kind" value="reject" />
                  <ActionKeyField scope={`decision:${leadId}:${fact.id}:reject`} />
                  <SafeSubmitButton className="btn btn--edge" pendingLabel="Rejecting…">
                    <X aria-hidden="true" />
                    <span className="ops-builds-action-label">Reject</span>
                    <span className="ops-builds-action-note" aria-hidden="true">Drop this reading</span>
                  </SafeSubmitButton>
                </form>}
              </div>

              <details className="ops-builds-correct">
                <summary>{typeof fact.value === "number" ? "Correct this number" : "Correct this fact"}</summary>
                <form className="ops-builds-inline-form" action={proposeBuildFactChangeAction}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={fact.id} />
                  <ActionKeyField scope={`correction:${leadId}:${fact.id}:${fact.factKey}`} />
                  <label htmlFor={`build-correct-${fact.id}`}><span>New {fact.label.toLowerCase()}</span>{["gate.hinge_side", "gate.latch_side"].includes(fact.factKey)
                    ? <select name="value" id={`build-correct-${fact.id}`} defaultValue={String(fact.value)} required><option value="left">Left</option><option value="right">Right</option></select>
                    : <input name="value" id={`build-correct-${fact.id}`} type={typeof fact.value === "number" ? "number" : "text"} min={typeof fact.value === "number" ? "0.01" : undefined} step={typeof fact.value === "number" ? "0.01" : undefined} inputMode={typeof fact.value === "number" ? "decimal" : undefined} autoComplete="off" defaultValue={fact.value} maxLength={typeof fact.value === "string" ? 120 : undefined} required />}</label>
                  <SafeSubmitButton className="btn btn--edge" pendingLabel="Filing…">Propose change</SafeSubmitButton>
                </form>
              </details>
            </article>
          })}
        </div>

        <footer className="ops-builds-lock">
          <div>
            <span>{workspace.draft.fabrication.ready ? "Fabrication-ready" : "Preview only"}</span>
            <strong>{workspace.draft.fabrication.ready ? "Critical numbers are confirmed." : "Fabrication stays blocked."}</strong>
            {!workspace.draft.fabrication.ready && <p>{workspace.draft.fabrication.blockers[0] ?? "Resolve Doesn't match before locking."}</p>}
          </div>
          <form action={lockBuildSheetAction}>
            <input type="hidden" name="leadId" value={leadId} />
            <ActionKeyField scope={`lock:${leadId}:${latestSheet?.id ?? "draft"}`} />
            <SafeSubmitButton className="btn btn--go" disabled={workspace.draft.conflicts.length > 0 || acceptedCount === 0} pendingLabel="Locking…">
              Lock Build Sheet {Number(latestSheet?.number ?? 0) + 1}
            </SafeSubmitButton>
          </form>
        </footer>

        <section className="ops-builds-canvas" aria-labelledby="build-canvas-heading">
          <header>
            <h2 className="t-sub" id="build-canvas-heading">Build drawing</h2>
            <p>{latestSheet ? `Build Sheet ${latestSheet.number}` : "No locked source yet"}</p>
          </header>
          <div className="ops-builds-canvas-body">
            {drawing ? <div className="ops-builds-canvas-grid">
              <BuildSheetDrawing drawing={drawing} />
              <dl>
                <div><dt>Finished size</dt><dd>{drawing.width} × {drawing.height} in</dd></div>
                <div><dt>Frame</dt><dd>{drawing.stockSize} in stock · {drawing.railCount} rails</dd></div>
                <div><dt>Hardware</dt><dd>Hinges {drawing.hingeSide} · latch {drawing.latchSide}</dd></div>
              </dl>
            </div> : <div className="ops-builds-canvas-empty">
              <strong>The drawing needs a complete locked geometry.</strong>
              <p>Confirm the finished width, height, stock, rails, hinge side, and latch side. No dimensions are guessed.</p>
            </div>}
          </div>
        </section>
      </section>

      <div className="ops-builds-rail">
        <section className="card ops-builds-panel" aria-labelledby="sheets-heading">
          <header className="ops-builds-panel-head">
            <div><span className="t-caption">Read-only record</span><h2 className="t-sub" id="sheets-heading">Locked history</h2></div>
            <strong>{workspace.sheets.length}</strong>
          </header>
          {workspace.sheets.length === 0 ? <p className="ops-builds-empty">No locked Build Sheet yet.</p> : <div className="ops-builds-sheets">
            {[...workspace.sheets].reverse().map((sheet, index) => <article className={index === 0 ? "is-current" : ""} key={sheet.id}>
              <details>
                <summary>
                  <span>
                    <em>{index === 0 ? "Current" : "History"}</em>
                    <strong>Build Sheet {sheet.number}</strong>
                  </span>
                  <time>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(sheet.lockedAt))}</time>
                </summary>
                <div className="ops-builds-sheet-body">
                  <dl>{sheet.snapshot.facts.map((fact) => <div key={`${sheet.id}-${fact.factKey}`}><dt>{fact.factKey.split(".").at(-1)?.replaceAll("_", " ")}</dt><dd>{formatValue(fact.value, fact.unit)}{fact.decisionState === "working-number" ? " / Shop estimate" : ""}</dd></div>)}</dl>
                  <p>{sheet.snapshot.fabrication.ready ? "Ready for fabrication outputs." : "Preview only — fabrication outputs blocked."}</p>
                  <small>Locked by {sheet.lockedBy}. This record cannot be edited.</small>
                </div>
              </details>
            </article>)}
          </div>}
        </section>

        <section className="card ops-builds-panel" aria-labelledby="paperwork-heading">
          <header className="ops-builds-panel-head">
            <div><h2 className="t-sub" id="paperwork-heading">Paperwork</h2></div>
            <strong>{workspace.paperwork.length}</strong>
          </header>
          {workspace.paperwork.length === 0 ? <p className="ops-builds-empty">Lock a Build Sheet to file its drawing and DXF manifest.</p> : <div className="ops-builds-paperwork">
            {workspace.paperwork.map((item) => <article className={`is-${item.status}`} key={item.id}>
              <div><span>{item.label}</span><strong>Build Sheet {item.sourceBuildSheetNumber}</strong></div>
              <em className="ops-builds-paperwork-status">
                <PaperworkStatusIcon status={item.status} />
                <span>{paperworkLabel(item.status)}</span>
              </em>
              {item.reason && <p className="ops-builds-paperwork-reason">{item.reason}</p>}
              {item.issueState === "blocked" && item.status === "current" && <p>Issue blocked until critical numbers are Confirmed.</p>}
              {["drawing", "dxf"].includes(item.kind) && item.status === "current" && item.issueState === "current" && item.sourceBuildSheetNumber === latestSheet?.number && !drawing && <p>Issue blocked until the locked geometry is complete.</p>}
              {["drawing", "dxf"].includes(item.kind) && item.status === "current" && item.issueState === "current" && item.sourceBuildSheetNumber === latestSheet?.number && drawing && <form action={`/api/ops/build-paperwork/${item.id}`} method="post">
                <ActionKeyField name="issueKey" scope={`paperwork:${item.id}:${item.kind}`} />
                <button className="btn btn--edge" type="submit">Issue current {item.kind === "dxf" ? "DXF" : "drawing"}</button>
              </form>}
              {paperworkNote(item.status, item.sourceBuildSheetNumber) && <small>{paperworkNote(item.status, item.sourceBuildSheetNumber)}</small>}
            </article>)}
          </div>}
        </section>
      </div>
    </div>
  </main>
}
