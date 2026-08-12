import { randomUUID } from "node:crypto"
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
  if (state === "working-number") return "Working number"
  if (state === "confirmed") return "Confirmed"
  return "Heard on call"
}

function paperworkLabel(status: string) {
  if (status === "old-numbers") return "Old numbers"
  if (status === "needs-update") return "Needs update"
  if (status === "hold") return "Hold — change needs review"
  return "Current"
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
      <Link className="ops-builds-back" href={`/ops/leads/${workspace.lead.id}`}>← Job</Link>
      <span className="ops-builds-test">[INTERNAL TEST] / Owner only</span>
      <div>
        <div>
          <p>Job #{workspace.lead.id}</p>
          <h1>Builds</h1>
          <span>{workspace.lead.first_name} {workspace.lead.last_name}</span>
        </div>
        {latestSheet && <strong className="ops-builds-current">Build Sheet {latestSheet.number}</strong>}
      </div>
    </header>

    <section className="ops-builds-canvas" aria-labelledby="build-canvas-heading">
      <header>
        <div>
          <span>Current locked geometry</span>
          <h2 id="build-canvas-heading">Build canvas</h2>
        </div>
        <p>{latestSheet ? `Build Sheet ${latestSheet.number}` : "No locked source yet"}</p>
      </header>
      {drawing ? <div className="ops-builds-canvas-grid">
        <BuildSheetDrawing drawing={drawing} />
        <dl>
          <div><dt>Finished size</dt><dd>{drawing.width} × {drawing.height} in</dd></div>
          <div><dt>Frame</dt><dd>{drawing.stockSize} in stock · {drawing.railCount} rails</dd></div>
          <div><dt>Hardware</dt><dd>Hinges {drawing.hingeSide} · latch {drawing.latchSide}</dd></div>
          <div><dt>Release</dt><dd>{drawing.fabricationReady ? "Fabrication outputs allowed" : "Preview only"}</dd></div>
        </dl>
      </div> : <div className="ops-builds-canvas-empty">
        <strong>The drawing needs a complete locked geometry.</strong>
        <p>Confirm the finished width, height, stock, rails, hinge side, and latch side. No dimensions are guessed.</p>
      </div>}
    </section>

    <div className="ops-builds-grid">
      <section className="ops-builds-panel" aria-labelledby="draft-heading">
        <header className="ops-builds-panel-head">
          <div>
            <span>Current draft</span>
            <h2 id="draft-heading">{workspace.draft.conflicts.length ? "Doesn't match" : "Build facts"}</h2>
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
                <input type="hidden" name="actionKey" value={randomUUID()} />
                <label><span>Carry a Working number</span><input name="value" type="number" min="0.01" step="0.01" inputMode="decimal" required /></label>
                <SafeSubmitButton pendingLabel="Filing…">Use Working number</SafeSubmitButton>
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
              <blockquote>“{fact.original}” <Link href={sourceHref}>Exact utterance</Link></blockquote>

              <div className="ops-builds-actions">
                {fact.state !== "confirmed" && <form action={decideBuildFactAction}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={fact.id} />
                  <input type="hidden" name="kind" value="confirm" />
                  <input type="hidden" name="actionKey" value={randomUUID()} />
                  <SafeSubmitButton pendingLabel="Confirming…">Confirm</SafeSubmitButton>
                </form>}
                {fact.state === "heard-on-call" && <form action={decideBuildFactAction}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={fact.id} />
                  <input type="hidden" name="kind" value="working" />
                  <input type="hidden" name="actionKey" value={randomUUID()} />
                  <SafeSubmitButton className="ops-builds-quiet" pendingLabel="Filing…">Working number</SafeSubmitButton>
                </form>}
                {fact.state !== "confirmed" && <form action={decideBuildFactAction}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={fact.id} />
                  <input type="hidden" name="kind" value="reject" />
                  <input type="hidden" name="actionKey" value={randomUUID()} />
                  <SafeSubmitButton className="ops-builds-quiet" pendingLabel="Rejecting…">Reject</SafeSubmitButton>
                </form>}
              </div>

              <details className="ops-builds-correct">
                <summary>{typeof fact.value === "number" ? "Correct this number" : "Correct this fact"}</summary>
                <form className="ops-builds-inline-form" action={proposeBuildFactChangeAction}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={fact.id} />
                  <input type="hidden" name="actionKey" value={randomUUID()} />
                  <label><span>New {fact.label.toLowerCase()}</span>{["gate.hinge_side", "gate.latch_side"].includes(fact.factKey)
                    ? <select name="value" defaultValue={String(fact.value)} required><option value="left">Left</option><option value="right">Right</option></select>
                    : <input name="value" type={typeof fact.value === "number" ? "number" : "text"} min={typeof fact.value === "number" ? "0.01" : undefined} step={typeof fact.value === "number" ? "0.01" : undefined} inputMode={typeof fact.value === "number" ? "decimal" : undefined} defaultValue={fact.value} maxLength={typeof fact.value === "string" ? 120 : undefined} required />}</label>
                  <SafeSubmitButton pendingLabel="Filing…">Propose change</SafeSubmitButton>
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
            <input type="hidden" name="actionKey" value={randomUUID()} />
            <SafeSubmitButton disabled={workspace.draft.conflicts.length > 0 || acceptedCount === 0} pendingLabel="Locking…">
              Lock Build Sheet {Number(latestSheet?.number ?? 0) + 1}
            </SafeSubmitButton>
          </form>
        </footer>
      </section>

      <div className="ops-builds-rail">
        <section className="ops-builds-panel" aria-labelledby="sheets-heading">
          <header className="ops-builds-panel-head">
            <div><span>Read-only record</span><h2 id="sheets-heading">Build Sheets</h2></div>
            <strong>{workspace.sheets.length}</strong>
          </header>
          {workspace.sheets.length === 0 ? <p className="ops-builds-empty">No locked Build Sheet yet.</p> : <div className="ops-builds-sheets">
            {[...workspace.sheets].reverse().map((sheet, index) => <article className={index === 0 ? "is-current" : ""} key={sheet.id}>
              <header>
                <div><span>{index === 0 ? "Current" : "History"}</span><h3>Build Sheet {sheet.number}</h3></div>
                <time>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(sheet.lockedAt))}</time>
              </header>
              <dl>{sheet.snapshot.facts.map((fact) => <div key={`${sheet.id}-${fact.factKey}`}><dt>{fact.factKey.split(".").at(-1)?.replaceAll("_", " ")}</dt><dd>{formatValue(fact.value, fact.unit)}{fact.decisionState === "working-number" ? " / Working number" : ""}</dd></div>)}</dl>
              <p>{sheet.snapshot.fabrication.ready ? "Ready for fabrication outputs." : "Preview only — fabrication outputs blocked."}</p>
              <small>Locked by {sheet.lockedBy}. This record cannot be edited.</small>
            </article>)}
          </div>}
        </section>

        <section className="ops-builds-panel" aria-labelledby="paperwork-heading">
          <header className="ops-builds-panel-head">
            <div><span>Source numbers attached</span><h2 id="paperwork-heading">Paperwork</h2></div>
            <strong>{workspace.paperwork.length}</strong>
          </header>
          {workspace.paperwork.length === 0 ? <p className="ops-builds-empty">Lock a Build Sheet to file its drawing and DXF manifest.</p> : <div className="ops-builds-paperwork">
            {workspace.paperwork.map((item) => <article className={`is-${item.status}`} key={item.id}>
              <div><span>{item.label}</span><strong>Build Sheet {item.sourceBuildSheetNumber}</strong></div>
              <em>{paperworkLabel(item.status)}</em>
              {item.reason && <p>{item.reason}</p>}
              {item.issueState === "blocked" && item.status === "current" && <p>Issue blocked until critical numbers are Confirmed.</p>}
              {["drawing", "dxf"].includes(item.kind) && item.status === "current" && item.issueState === "current" && item.sourceBuildSheetNumber === latestSheet?.number && !drawing && <p>Issue blocked until the locked geometry is complete.</p>}
              {["drawing", "dxf"].includes(item.kind) && item.status === "current" && item.issueState === "current" && item.sourceBuildSheetNumber === latestSheet?.number && drawing && <form action={`/api/ops/build-paperwork/${item.id}`} method="post">
                <input type="hidden" name="issueKey" value={randomUUID()} />
                <button type="submit">Issue current {item.kind === "dxf" ? "DXF" : "drawing"}</button>
              </form>}
              <small>Still valid as the record for Build Sheet {item.sourceBuildSheetNumber}.</small>
            </article>)}
          </div>}
        </section>
      </div>
    </div>
  </main>
}
