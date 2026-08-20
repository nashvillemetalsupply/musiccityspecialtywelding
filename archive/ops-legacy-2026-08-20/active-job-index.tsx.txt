import Link from "next/link"
import type { BoardJobRow, JobBoardStage } from "@/lib/ops-data"
import { ActiveJobControls } from "./active-job-controls"
import { TrackedCallButton } from "./tracked-call-button"

const stageLabels: Record<BoardJobRow["board_stage"], string> = {
  attention: "Needs Attention",
  shop: "In Shop",
  waiting: "Waiting",
  ready: "Ready",
}

function boardPageHref(stage: JobBoardStage, query: string, page: number) {
  const params = new URLSearchParams()
  if (stage !== "board") params.set("stage", stage)
  if (query.trim()) params.set("q", query.trim())
  if (page > 1) params.set("page", String(page))
  const suffix = params.toString()
  return `/ops${suffix ? `?${suffix}` : ""}#active-jobs`
}

function JobRow({
  lead,
  priorJobs = 0,
  trackedCallsReady,
  textReady,
}: {
  lead: BoardJobRow
  priorJobs?: number
  trackedCallsReady: boolean
  textReady: boolean
}) {
  const phoneReady = Boolean(lead.phone && !lead.phone_is_placeholder)
  const customerName = `${lead.first_name} ${lead.last_name}`.trim() || "Customer"
  const nameIsEmail = customerName.includes("@")
  const lifecycle = `${lead.board_reason}${priorJobs > 0 ? ` · ${priorJobs} prior ${priorJobs === 1 ? "job" : "jobs"}` : ""}`

  return <article className={`jobs-row${lead.board_stage === "attention" ? " is-attention" : ""}${lead.is_test ? " is-test" : ""}`}>
    <div className="jobs-row-copy">
      <div className="jobs-row-heading">
        <strong>{nameIsEmail ? "Customer" : customerName}</strong>
        <span className="jobs-row-lifecycle" title={lifecycle}>{lifecycle}</span>
      </div>
      <div className="jobs-row-detail">
        <strong className="jobs-row-stage">{stageLabels[lead.board_stage]}</strong>
        <p>{lead.message.trim() || lead.service}</p>
      </div>
    </div>
    <div className="jobs-row-actions" aria-label={`Actions for ${customerName}`}>
      {phoneReady && (trackedCallsReady
        ? <TrackedCallButton compact leadId={lead.id} phone={lead.phone} />
        : <a className="jobs-row-button" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>Call</a>)}
      {textReady && <Link className="jobs-row-button" href={`/ops/leads/${lead.id}?replyChannel=text#spike`}>Text</Link>}
      <Link className="jobs-row-button" href={`/ops/leads/${lead.id}`}>Open</Link>
    </div>
  </article>
}

export function ActiveJobIndex({
  leads,
  counts,
  repeatCounts,
  stage,
  query,
  page,
  pageSize,
  resultTotal,
  hasOlder,
  trackedCallsReady,
  textReadyLeadIds,
}: {
  leads: BoardJobRow[]
  counts: Record<JobBoardStage, number>
  repeatCounts: Map<number, number>
  stage: JobBoardStage
  query: string
  page: number
  pageSize: number
  resultTotal: number
  hasOlder: boolean
  trackedCallsReady: boolean
  textReadyLeadIds?: Set<number>
}) {
  const pageCount = Math.max(1, Math.ceil(resultTotal / pageSize))
  const start = resultTotal === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, resultTotal)

  return <section className="jobs-panel jobs-active" id="active-jobs" aria-labelledby="active-jobs-title">
    <header className="jobs-section-header">
      <div><h2 id="active-jobs-title">Active Jobs</h2></div>
      <strong className="jobs-section-count" aria-label={`${counts.board} total`}>{counts.board} total</strong>
    </header>
    <ActiveJobControls stage={stage} query={query} counts={counts} />
    <p className="jobs-results-summary" aria-live="polite">{resultTotal > 0
      ? `Showing ${start}-${end} of ${resultTotal}`
      : query ? `No jobs match “${query}”.` : "No jobs in this view."}</p>
    {leads.length === 0
      ? <div className="jobs-index-empty">
          <strong>No jobs found.</strong>
          <span>{query ? "Try a customer name or job type." : "New jobs will appear here after intake."}</span>
          {query && <Link href="/ops#active-jobs">Clear search</Link>}
        </div>
      : <div className="jobs-list">{leads.map((lead) => <JobRow
          key={lead.id}
          lead={lead}
          trackedCallsReady={trackedCallsReady}
          textReady={textReadyLeadIds?.has(lead.id) ?? false}
          priorJobs={Math.max(0, Number(repeatCounts.get(lead.person_id ?? 0) ?? 1) - 1)}
        />)}</div>}
    <nav className="jobs-index-pages" aria-label="Active Jobs pages">
      <span>Page {Math.min(page, pageCount)} of {pageCount}</span>
      {page > 1
        ? <Link href={boardPageHref(stage, query, page - 1)}>Previous</Link>
        : <span className="is-disabled" aria-disabled="true">Previous</span>}
      {hasOlder
        ? <Link href={boardPageHref(stage, query, page + 1)}>Next</Link>
        : <span className="is-disabled" aria-disabled="true">Next</span>}
    </nav>
  </section>
}
