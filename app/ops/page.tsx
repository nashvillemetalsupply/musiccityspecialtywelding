import Link from "next/link"
import { randomUUID } from "node:crypto"
import { dbConfigured, getSql } from "@/lib/db"
import { getEvent } from "@/lib/events"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { countUnreadWire, listWire } from "@/lib/notify"
import { normalizePage } from "@/lib/pagination"
import { listRegularAccounts, listWallCommitments } from "@/lib/wall-data"
import {
  getNeedsNow,
  getRepeatJobCounts,
  getTodayLeadSummary,
  JOB_BOARD_STAGES,
  listBoardJobs,
  type JobBoardStage,
  type TodayLeadSummary,
} from "@/lib/ops-data"
import { listPendingCallIntakes, type CallIntakeDraft } from "@/lib/job-intake"
import { projectEventForRole } from "@/lib/visibility"
import { listOperators, operatorPunchSelector } from "@/lib/operators"
import { twilioSmsConfigured, twilioVoiceConfigured } from "@/lib/twilio"
import { shopEventLabel } from "@/lib/shop-language"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { getMessagingConsentState } from "@/lib/messaging-consent"
import { OpsLoginForm } from "./login-form"
import { ActiveJobIndex } from "./active-job-index"
import { InlineJobIntake } from "./intake/inline-job-intake"
import { PaidMoment } from "./paid-moment"
import { TrackedCallButton } from "./tracked-call-button"
import { WireStrip } from "./wire-strip"

export const dynamic = "force-dynamic"

function formatCentral(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function ageInWords(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1_440)}d`
}

function hasPassed(iso: string) {
  return new Date(iso).getTime() <= Date.now()
}

function attentionReason(reason: string) {
  const labels: Record<string, string> = {
    "customer text waiting": "Text waiting",
    "customer email waiting": "Email waiting",
    "customer files waiting": "New files waiting",
    "missed call waiting": "Missed call",
    "overdue promise": "Promise overdue",
    "follow-up due": "Follow-up due",
    "no call back yet": "Needs a call",
  }
  return labels[reason] ?? reason
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
  if (digits.length !== 10) return phone || "Number unavailable"
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  })
}

function todaySourceLabel(source: string) {
  const labels: Record<string, string> = {
    "google ads": "Google Ads",
    "phone-in": "Phone call",
    "walk-in": "Walk-in",
    "sms-in": "Text message",
    "email-in": "Email",
    web: "Website",
    referral: "Referral",
    "repeat customer": "Repeat customer",
    unknown: "Unknown",
    other: "Other",
  }
  return labels[source] ?? source.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function responseTime(minutes: number | null) {
  if (minutes === null) return "Not yet"
  if (minutes < 1) return "Under 1 min"
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const remainder = Math.round(minutes % 60)
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function TodaysLeads({ summary }: { summary: TodayLeadSummary }) {
  return <section className="jobs-panel jobs-today-leads" aria-labelledby="today-leads-title">
    <header className="jobs-section-header">
      <div><p className="jobs-kicker">Owner snapshot</p><h2 id="today-leads-title">Today’s Leads</h2></div>
      <strong className="jobs-section-count" aria-label={`${summary.total} leads today`}>{summary.total} total</strong>
    </header>
    <dl className="jobs-today-metrics">
      <div><dt>Need first response</dt><dd>{summary.awaitingFirstResponse}</dd></div>
      <div><dt>Contacted</dt><dd>{summary.contacted}</dd></div>
      <div><dt>Booked</dt><dd>{summary.booked}</dd></div>
      <div><dt>Median response</dt><dd>{responseTime(summary.medianFirstResponseMinutes)}</dd></div>
    </dl>
    <div className="jobs-today-sources">
      <div><strong>Where they came from</strong><Link href="/ops/analytics">View analytics</Link></div>
      {summary.sources.length > 0
        ? <ul>{summary.sources.map((source) => <li key={source.source}><strong>{source.count}</strong><span>{todaySourceLabel(source.source)}</span></li>)}</ul>
        : <p>No leads recorded today.</p>}
    </div>
  </section>
}

function CallDraftRow({ draft }: { draft: CallIntakeDraft }) {
  const missed = ["no-answer", "busy", "failed", "canceled"].includes(draft.call_status)
  return <article className="jobs-call-row">
    <div className="jobs-call-copy">
      <span>{missed ? "Missed call" : draft.call_status === "ringing" ? "On the phone now" : "Call ready"} · {formatTime(draft.created_at)}</span>
      <strong>{draft.caller_name || formatPhone(draft.phone)}</strong>
      <p>{formatPhone(draft.phone)}</p>
    </div>
    <Link className="jobs-row-button jobs-row-button-primary" href={`/ops/intake/${draft.public_id}`}>Finish</Link>
  </article>
}

type SearchParams = Promise<{
  view?: string
  jobs?: string
  calls?: string
  callsPage?: string
  needs?: string
  needsPage?: string
  stage?: string
  status?: string
  tests?: string
  q?: string
  page?: string
  wire?: string
  wirePage?: string
  wireQ?: string
  promisePage?: string
  accountPage?: string
  accountQ?: string
  receipt?: string
  error?: string
}>

export default async function OpsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  if (!dbConfigured()) return <main className="ops-login"><h1>MCSW Jobs</h1><p className="ops-alert">The operations database is not configured.</p></main>
  const operator = await getAuthenticatedOperator()
  if (!operator) {
    const smsLoginReady = twilioSmsConfigured()
    const punchCards = (await listOperators()).map((person) => ({
      selector: operatorPunchSelector(person.id),
      name: person.name.split(/\s+/)[0] || "Crew",
      hasEmail: Boolean(person.email),
      hasSms: smsLoginReady && Boolean(person.cell_phone),
    })).filter((person) => Boolean(person.selector))
    return <OpsLoginForm linkError={params.error === "link"} operators={punchCards} smsReady={smsLoginReady} />
  }

  const allowedViews = new Set(["updates", "promises", "regulars"])
  const view = allowedViews.has(params.view ?? "") ? params.view ?? "" : ""
  const showAllCalls = params.calls === "all"
  const showAllNeeds = params.needs === "all"
  const legacyStage: Record<string, JobBoardStage> = {
    open: "board",
    all: "board",
    new: "attention",
    contacted: "waiting",
    qualified: "waiting",
    quoted: "waiting",
    won: "ready",
  }
  const requestedStage = params.stage ?? legacyStage[params.status ?? ""] ?? "board"
  const stageFilter = JOB_BOARD_STAGES.includes(requestedStage as JobBoardStage)
    ? requestedStage as JobBoardStage
    : "board"
  const includeTests = params.tests === "1"
  const searchQuery = params.q?.trim().slice(0, 80) ?? ""
  const page = normalizePage(params.page)
  const requestedNeedsPage = normalizePage(params.needsPage)
  const callsPage = normalizePage(params.callsPage)
  const [boardPage, needs, callIntakes, todayLeads] = await Promise.all([
    listBoardJobs({ stage: stageFilter, includeTests, query: searchQuery, page, pageSize: 5 }, operator.role),
    getNeedsNow({ page: showAllNeeds ? requestedNeedsPage : 1, pageSize: showAllNeeds ? 50 : 1 }, operator.role),
    listPendingCallIntakes({ page: showAllCalls ? callsPage : 1, pageSize: showAllCalls ? 20 : 3 }),
    operator.role === "owner" ? getTodayLeadSummary() : Promise.resolve(null),
  ])
  const needsPage = needs.page
  const displayLeads = boardPage.items
  const smsReady = twilioSmsConfigured()
  const textReadyPairs = smsReady ? await Promise.all(displayLeads
    .filter((lead) => lead.phone && !lead.phone_is_placeholder)
    .map(async (lead) => [lead.id, await getMessagingConsentState(lead.phone)] as const)) : []
  const textReadyLeadIds = new Set(textReadyPairs.filter(([, consent]) => consent === "granted").map(([leadId]) => leadId))
  const repeatCounts = await getRepeatJobCounts([...displayLeads, ...needs.items].map((lead) => lead.person_id))
  const primaryDraft = callIntakes.items[0]

  let wire: Awaited<ReturnType<typeof listWire>>["items"] = []
  let unreadWireTotal = 0
  let wireHasOlder = false
  const wireHistory = params.wire === "past"
  const requestedWirePage = normalizePage(params.wirePage)
  let wirePage = 1
  const wireQuery = params.wireQ?.trim() ?? ""
  if (view === "updates") {
    const wirePageSize = wireHistory ? 50 : 12
    const [wireResult, unreadTotal] = await Promise.all([
      listWire(operator.id, operator.role, { unreadOnly: !wireHistory, page: requestedWirePage, pageSize: wirePageSize, query: wireQuery }),
      countUnreadWire(operator.id, operator.role),
    ])
    wire = wireResult.items
    wirePage = wireResult.page
    wireHasOlder = wireResult.hasNext
    unreadWireTotal = unreadTotal
  }

  const receiptId = Number(params.receipt)
  const receiptRaw = view === "updates" && Number.isInteger(receiptId) && receiptId > 0 ? await getEvent(receiptId) : null
  const receipt = receiptRaw ? projectEventForRole(receiptRaw, operator.role) : null
  const receiptCall = receipt && typeof receipt.detail?.callSid === "string" ? (await getSql()`SELECT id FROM calls WHERE twilio_sid = ${receipt.detail.callSid}::text LIMIT 1`) as { id: number }[] : []

  const promiseResult = view === "promises"
    ? await listWallCommitments(operator.role, { page: normalizePage(params.promisePage), pageSize: 30 })
    : null
  const promises = promiseResult?.items ?? []
  const promisePage = promiseResult?.page ?? 1
  const promisesHaveOlder = promiseResult?.hasNext ?? false

  const accountQuery = params.accountQ?.trim() ?? ""
  const regularsResult = view === "regulars"
    ? await listRegularAccounts({ page: normalizePage(params.accountPage), pageSize: 30, query: accountQuery })
    : null
  const regulars = regularsResult?.items ?? []
  const accountPage = regularsResult?.page ?? 1
  const regularsHaveOlder = regularsResult?.hasNext ?? false

  const paidSlip = view === "updates" ? wire.find((slip) => slip.source_kind === "invoice.paid") : undefined
  const nextLead = needs.items[0]
  const nextCustomer = nextLead ? `${nextLead.first_name} ${nextLead.last_name}`.trim() || "Customer" : ""
  const nextNeedsReply = Boolean(nextLead && /text|email/i.test(nextLead.reason))
  const nextNeedsCall = Boolean(nextLead && /call back|missed call|follow-up/i.test(nextLead.reason) && nextLead.phone && !nextLead.phone_is_placeholder)
  const nextHeadline = nextNeedsReply
    ? `${nextCustomer} needs a reply.`
    : nextNeedsCall
      ? `${nextCustomer} needs a call.`
      : nextLead?.reason === "overdue promise"
        ? `${nextCustomer} has an overdue promise.`
        : `${nextCustomer} needs attention.`

  return <main className="jobs-app-shell">
    {paidSlip && <PaidMoment slipId={paidSlip.id} title={paidSlip.title} body={paidSlip.body} />}

    {!view && showAllCalls && <section className="jobs-panel jobs-pending jobs-full-list" aria-labelledby="pending-calls-title">
      <header className="jobs-section-header"><div><span>{callIntakes.total} total</span><h1 id="pending-calls-title">Calls to save</h1></div><Link href="/ops">Done</Link></header>
      {callIntakes.items.length === 0 ? <p className="ops-empty">No calls are waiting to be saved.</p> : <div className="jobs-call-list">{callIntakes.items.map((draft) => <CallDraftRow draft={draft} key={draft.id} />)}</div>}
      {callIntakes.total > callIntakes.pageSize && <nav className="ops-pages" aria-label="Calls to save pages">
        {callIntakes.page > 1 ? <Link href={`/ops?calls=all&callsPage=${callIntakes.page - 1}`}>Newer</Link> : <span />}
        <span>Page {callIntakes.page} of {Math.ceil(callIntakes.total / callIntakes.pageSize)}</span>
        {callIntakes.page * callIntakes.pageSize < callIntakes.total ? <Link href={`/ops?calls=all&callsPage=${callIntakes.page + 1}`}>Older</Link> : <span />}
      </nav>}
    </section>}

    {!view && !showAllNeeds && !showAllCalls && <div className="jobs-home-lane">
      <InlineJobIntake
        intakeKey={randomUUID()}
        owner={operator.role === "owner"}
        voiceReady={voiceTranscriptionConfigured()}
        pendingTotal={callIntakes.total}
        draft={primaryDraft ? {
          publicId: primaryDraft.public_id,
          name: primaryDraft.caller_name,
          phone: primaryDraft.phone,
          need: primaryDraft.need,
          callStatus: primaryDraft.call_status,
          createdAt: primaryDraft.created_at,
          lastError: primaryDraft.last_error,
        } : undefined}
      />
      <section className="jobs-panel jobs-next" aria-labelledby="next-move-title">
      <header className="jobs-section-header">
        <div><p className="jobs-kicker">Needs Attention</p><h2 id="next-move-title">Next move</h2></div>
        {needs.total > 1 && <Link href="/ops?needs=all">View {Math.min(3, needs.total)}</Link>}
      </header>
      {nextLead ? <div className="jobs-next-body">
        <div>
          <strong>{nextHeadline}</strong>
          <p>{nextLead.message.trim() || nextLead.service} · {attentionReason(nextLead.reason).toLowerCase()} {ageInWords(nextLead.waiting_since)} ago.</p>
        </div>
        <div className="jobs-next-actions">
          {nextNeedsReply
            ? <Link className="jobs-primary-action" href={`/ops/leads/${nextLead.id}#spike`}>Reply</Link>
            : nextNeedsCall && twilioVoiceConfigured()
              ? <TrackedCallButton compact leadId={nextLead.id} phone={nextLead.phone} />
              : nextNeedsCall
                ? <a className="jobs-primary-action" href={`tel:${nextLead.phone.replace(/[^\d+]/g, "")}`}>Call</a>
                : <Link className="jobs-primary-action" href={`/ops/leads/${nextLead.id}`}>Open job</Link>}
          {(nextNeedsReply || nextNeedsCall) && <Link className="jobs-secondary-action" href={`/ops/leads/${nextLead.id}`}>Open Job</Link>}
        </div>
      </div> : <div className="jobs-next-empty"><strong>You’re caught up.</strong><span>New calls, messages, and due promises will appear here.</span></div>}
      </section>
    </div>}

    {!view && showAllNeeds && !showAllCalls && <section className={`jobs-panel jobs-attention jobs-full-list${needs.items.length === 0 ? " is-empty" : ""}`} aria-labelledby="attention-title">
      <header className="jobs-section-header"><div><span>{needs.total === 0 ? "Clear" : "Oldest first"}</span><h2 id="attention-title">Needs Attention</h2></div><div className="jobs-section-tools"><b aria-label={`${needs.total} total`}>{needs.total}</b>{showAllNeeds ? <Link href="/ops">Done</Link> : needs.total > needs.items.length && <Link href="/ops?needs=all">View all</Link>}</div></header>
      {needs.items.length === 0 ? <p className="jobs-empty">You’re caught up.</p> : <div className="jobs-attention-list">{needs.items.map((lead) => <article className="jobs-attention-row" key={`${lead.id}-${lead.reason}`}>
        <div className="jobs-attention-copy"><span>{attentionReason(lead.reason)} · {ageInWords(lead.waiting_since)}</span><strong>{`${lead.first_name} ${lead.last_name}`.trim() || "Customer"}</strong><p>{lead.message.trim() || lead.service}</p>{lead.person_id && Number(repeatCounts.get(lead.person_id) ?? 0) > 1 && <Link href={`/ops/accounts/${lead.person_id}`}>Repeat customer</Link>}</div>
        <div className="jobs-row-actions">{lead.phone && !lead.phone_is_placeholder && <TrackedCallButton compact leadId={lead.id} phone={lead.phone} />}<Link className="jobs-row-button" href={`/ops/leads/${lead.id}`}>Open</Link></div>
      </article>)}</div>}
      {showAllNeeds && <nav className="ops-pages">{needsPage > 1 && <Link href={`/ops?needs=all&needsPage=${needsPage - 1}`}>Newer</Link>}<span>Page {needsPage}</span>{needsPage * 50 < needs.total && <Link href={`/ops?needs=all&needsPage=${needsPage + 1}`}>Older</Link>}</nav>}
    </section>}

    {!view && !showAllNeeds && !showAllCalls && <div className="jobs-board-lane">
      {todayLeads && <TodaysLeads summary={todayLeads} />}
      <ActiveJobIndex
        leads={displayLeads}
        counts={boardPage.counts}
        repeatCounts={repeatCounts}
        stage={stageFilter}
        query={searchQuery}
        page={boardPage.page}
        pageSize={boardPage.pageSize}
        resultTotal={boardPage.resultTotal}
        hasOlder={boardPage.hasNext}
        trackedCallsReady={twilioVoiceConfigured()}
        textReadyLeadIds={textReadyLeadIds}
      />
    </div>}

    {view === "updates" && <section className="ops-more-view"><header className="ops-page-heading"><h1>Updates</h1><Link href="/ops">Done</Link></header><WireStrip history={wireHistory} unreadTotal={unreadWireTotal} page={wirePage} hasOlder={wireHasOlder} query={wireQuery} slips={wire.map((slip) => ({ id: slip.id, stock: slip.stock, title: slip.title, body: slip.body, url: slip.url, age: ageInWords(slip.created_at), actionKind: slip.action_kind, actionDetail: slip.action_detail }))} />{Number.isInteger(receiptId) && receiptId > 0 && <section className="ops-receipt-drawer" id="receipt"><header><div><span>Source</span><h2>{receipt ? shopEventLabel(receipt.kind) : "Owner-only update"}</h2></div><Link href="/ops?view=updates">Close</Link></header>{receipt ? <><time>{formatCentral(receipt.occurred_at)}</time><p>{receipt.body}</p>{receiptCall[0] && operator.role === "owner" && <audio controls preload="none" src={`/api/ops/call/${receiptCall[0].id}`} />}{receipt.lead_id && <Link href={`/ops/leads/${receipt.lead_id}`}>Open job</Link>}</> : <p>This update is not available in your role.</p>}</section>}</section>}

    {view === "promises" && <section className="ops-more-view ops-promises-view"><header className="ops-page-heading"><h1>Promises</h1><Link href="/ops">Done</Link></header>{promises.length === 0 ? <p className="ops-empty">No open promises.</p> : <div>{promises.map((promise) => <Link className={promise.due_at && hasPassed(promise.due_at) ? "is-overdue" : ""} href={promise.lead_id ? `/ops/leads/${promise.lead_id}#promise-${promise.id}` : "/ops"} key={promise.id}><span>{promise.first_name || "Shop promise"}</span><strong>{promise.summary}</strong><time>{promise.due_at ? formatCentral(promise.due_at) : "Needs a date"}</time></Link>)}</div>}{(promisePage > 1 || promisesHaveOlder) && <nav className="ops-pages">{promisePage > 1 && <Link href={`/ops?view=promises&promisePage=${promisePage - 1}`}>Newer</Link>}<span>Page {promisePage}</span>{promisesHaveOlder && <Link href={`/ops?view=promises&promisePage=${promisePage + 1}`}>Older</Link>}</nav>}</section>}

    {view === "regulars" && <section className="ops-more-view ops-regulars-view"><header className="ops-page-heading"><h1>Regular Customers</h1><Link href="/ops">Done</Link></header><form action="/ops" method="get"><input type="hidden" name="view" value="regulars" /><label htmlFor="regular-search">Search customers</label><input id="regular-search" name="accountQ" defaultValue={accountQuery} /><button type="submit">Search</button></form>{regulars.length === 0 ? <p className="ops-empty">No customers found.</p> : <div>{regulars.map((account) => <Link href={`/ops/accounts/${account.person_id}`} key={account.person_id}><strong>{account.label}</strong><span>{account.live_count ? `${account.live_count} active` : `${account.job_count} jobs`}</span></Link>)}</div>}{(accountPage > 1 || regularsHaveOlder) && <nav className="ops-pages">{accountPage > 1 && <Link href={`/ops?view=regulars&accountPage=${accountPage - 1}${accountQuery ? `&accountQ=${encodeURIComponent(accountQuery)}` : ""}`}>Newer</Link>}<span>Page {accountPage}</span>{regularsHaveOlder && <Link href={`/ops?view=regulars&accountPage=${accountPage + 1}${accountQuery ? `&accountQ=${encodeURIComponent(accountQuery)}` : ""}`}>Older</Link>}</nav>}</section>}

  </main>
}
