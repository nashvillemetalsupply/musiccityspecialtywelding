import Link from "next/link"
import { randomUUID } from "node:crypto"
import { notFound } from "next/navigation"
import "./job.css"
import { dbConfigured, getSql } from "@/lib/db"
import { LEAD_STATUSES } from "@/lib/leads"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getLead } from "@/lib/ops-data"
import { listLeadMessages } from "@/lib/messages"
import { listCommitments } from "@/lib/commitments"
import { listActiveClaims } from "@/lib/claims"
import { listJobLineItems } from "@/lib/job-line-items"
import { formatLineItemsText, lineItemsTotalCents } from "@/lib/job-line-items.mjs"
import { listLeadCalls } from "@/lib/calls"
import { listLeadEventPage, listLeadEvents as listUnifiedEvents } from "@/lib/events"
import { canAccessInternalTests, listOperators } from "@/lib/operators"
import { twilioSmsConfigured } from "@/lib/twilio"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { getMessagingConsentState } from "@/lib/messaging-consent"
import { isReservedShopPhone, normalizePhone } from "@/lib/people"
import { LatePromiseMessage } from "./voice-draft"
import { normalizePage } from "@/lib/pagination"
import { readableEmailText } from "@/lib/gmail-plaintext.mjs"
import { getActiveGlassLinkState } from "@/lib/glass"
import { buildSheetsEnabled } from "@/lib/build-sheets-access"
import { glassUrl } from "@/lib/glass-delivery"
import { shopClaimLabel, shopClaimText, shopDeliveryLabel, shopEventLabel, shopJobStatusLabel, shopSourceLabel } from "@/lib/shop-language"
import { strongestEmailReceiptStatus } from "@/lib/email-provider-truth.mjs"
import { isSafeRasterImage } from "@/lib/media-safety"
import { projectClaimForRole, projectCommitmentForRole, projectEventForRole, redactCrewText } from "@/lib/visibility"
import { OpsLoginForm } from "../../login-form"
import { DoneStamp } from "./done-stamp"
import { PaymentForm } from "./payment-form"
import { HandoffControl } from "./handoff-control"
import { SpikeReply } from "./spike-reply"
import { GlassControl } from "./glass-control"
import { TrackedCallButton } from "../../tracked-call-button"
import { SafeSubmitButton } from "../../safe-action-controls"
import { recordVerbalTextConsent } from "./message-actions"
import { confirmPromise, handlePromise, keepPromise, publishPromiseToGlass, rejectPromise } from "./promise-actions"
import { acceptQuoteCapture, correctClaim, rejectQuoteCapture } from "./claim-actions"
import {
  acknowledgeDeliveryFailure,
  assignLeadOperator,
  captureLeadContact,
  classifyLeadAttachment,
  deleteTestLead,
  logInteraction,
  markFirstResponse,
  markReviewRequested,
  recordInvoice,
  routeConversationToJob,
  resolveIdentityConflict,
  saveEstimate,
  saveJobLineItems,
  saveNotes,
  saveOutcome,
  setPhotoShared,
  setJobTravelerStage,
  setFollowUp,
  updateLeadStatus,
} from "../../actions"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  if (!dbConfigured()) return { title: "Job · MCSW Jobs" }
  const operator = await getAuthenticatedOperator()
  if (!operator) return { title: "Sign in · MCSW Jobs" }
  const leadId = Number((await params).id)
  if (!Number.isInteger(leadId) || leadId <= 0) return { title: "Job not found · MCSW Jobs" }
  const lead = await getLead(leadId, operator.role, { includeTests: canAccessInternalTests(operator.role) })
  const name = lead ? `${lead.first_name} ${lead.last_name}`.trim() : "Job not found"
  return { title: `${name} · MCSW Jobs` }
}


function formatCentral(iso: string | null) {
  if (!iso) return "Not recorded"
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function centsToDollars(cents: number | null) {
  return cents === null ? "" : (Number(cents) / 100).toFixed(2)
}

function money(cents: unknown) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return ""
  const decimals = Math.abs(n) % 100 === 0 ? 0 : 2
  return (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: 2 })
}

function displayPhone(phone: string) {
  const value = phone.replace(/\D/g, "").slice(-10)
  return value.length === 10 ? `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6)}` : phone
}

function claimDisplayKey(predicate: string, value: unknown) {
  const normalized = shopClaimText(value).replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US")
  return `${predicate.trim().toLocaleLowerCase("en-US")}:${normalized}`
}

function isPast(iso: string) {
  return new Date(iso).getTime() < Date.now()
}

function receiptMoment(detail: Record<string, unknown> | null) {
  const segments = Array.isArray(detail?.segments) ? detail.segments as Array<Record<string, unknown>> : []
  const start = Number(segments[0]?.start)
  return Number.isFinite(start) && start > 0 ? Math.max(0, Math.floor(start) - 1) : 0
}

function visibleEventText(text: string, role: "owner" | "crew") {
  return readableEmailText(text) || (role === "owner" ? "Recorded without a text body." : "Crew-safe copy is still being filed.")
}

type SpikeAttachment = { pathname?: unknown; name?: unknown; contentType?: unknown; sensitivity?: unknown }

type SpikeItem =
  | { kind: "call"; at: string; id: string; call: Awaited<ReturnType<typeof listLeadCalls>>[number] }
  | { kind: "message"; at: string; id: string; message: Awaited<ReturnType<typeof listLeadMessages>>[number] }
  | { kind: "event"; at: string; id: string; event: Awaited<ReturnType<typeof listUnifiedEvents>>[number] }

type UnifiedEvent = Awaited<ReturnType<typeof listUnifiedEvents>>[number]
type LeadCall = Awaited<ReturnType<typeof listLeadCalls>>[number]

function callMoment(event: UnifiedEvent | undefined, direction?: string) {
  const segments = Array.isArray(event?.detail?.segments) ? event.detail.segments as Array<Record<string, unknown>> : []
  const wanted = direction === "we_promised" ? "shop" : direction === "they_promised" ? "customer" : ""
  const segment = segments.find((item) => !wanted || String(item.label ?? "").toLowerCase() === wanted) ?? segments[0]
  const start = Number(segment?.start)
  return Number.isFinite(start) && start > 0 ? Math.max(0, Math.floor(start) - 1) : 0
}

function SourceCallAudio({ event, calls, direction }: { event?: UnifiedEvent; calls: LeadCall[]; direction?: string }) {
  const sid = typeof event?.detail?.callSid === "string" ? event.detail.callSid : ""
  const call = sid ? calls.find((item) => item.twilio_sid === sid) : undefined
  if (!call?.recording_url) return null
  return <audio controls preload="none" src={`/api/ops/call/${call.id}#t=${callMoment(event, direction)}`} />
}

function spikeAttachments(value: unknown): Array<{ pathname: string; name: string; contentType: string; sensitivity: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const attachment = item as SpikeAttachment
    if (typeof attachment.pathname !== "string") return []
    return [{
      pathname: attachment.pathname,
      name: typeof attachment.name === "string" ? attachment.name : "attachment",
      contentType: typeof attachment.contentType === "string" ? attachment.contentType : "application/octet-stream",
      sensitivity: typeof attachment.sensitivity === "string" ? attachment.sensitivity : "unclassified",
    }]
  })
}

function SpikeAttachments({ items, leadId, role }: { items: Array<{ pathname: string; name: string; contentType: string; sensitivity: string }>; leadId: number; role: "owner" | "crew" }) {
  const visible = role === "owner" ? items : items.filter((item) => item.sensitivity === "drawing" || item.sensitivity === "photo")
  if (!visible.length) return items.length ? <small className="job-owner-note t-caption">Available to the owner only.</small> : null
  return <div className="job-attachments">{visible.map((item) => {
    const href = `/api/ops/attachment?lead=${leadId}&path=${encodeURIComponent(item.pathname)}`
    const isImage = item.contentType.startsWith("image/")
    const isShareablePhoto = isSafeRasterImage(item.contentType)
    const isDrawing = /(?:dxf|dwg|step|stp|iges|igs|drawing|blueprint)/i.test(`${item.contentType} ${item.name}`)
    return <div className="job-attachment" key={item.pathname}>
      <a className={isDrawing ? "is-blueprint" : isImage ? "is-polaroid" : "is-file"} href={href} target="_blank" rel="noreferrer">
        {isImage && <img src={href} alt="Customer upload" />}
        <span>{isDrawing ? "Drawing" : isImage ? "Photo" : "File"}</span>
        <strong>{item.name}</strong>
      </a>
      {role === "owner" && isShareablePhoto && item.sensitivity === "unclassified" && <form action={classifyLeadAttachment} className="job-attachment-review">
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="pathname" value={item.pathname} />
        <small>Owner only until you confirm this is a job photo.</small>
        <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Sharing...">Share with crew</SafeSubmitButton>
      </form>}
    </div>
  })}</div>
}

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ replyTo?: string; replyChannel?: string; activityPage?: string }>

export default async function LeadDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params
  const query = await searchParams
  const leadId = Number(id)
  const requestedActivityPage = normalizePage(query.activityPage)
  if (!Number.isInteger(leadId) || leadId <= 0) notFound()

  if (!dbConfigured()) {
    return (
      <div className="job-page job-state-page">
        <h1>Shop operations</h1>
        <p className="job-alert job-alert--stop">The operations database is not configured.</p>
      </div>
    )
  }

  const operator = await getAuthenticatedOperator()
  if (!operator) return <OpsLoginForm linkError={false} />

  const includeTests = canAccessInternalTests(operator.role)
  const lead = await getLead(leadId, operator.role, { includeTests })
  if (!lead) notFound()
  const [messages, promises, claims, calls, unifiedEvents, activityPage, operators, lineItems, attachmentClassifications, routingChoices] = await Promise.all([
    listLeadMessages(leadId),
    listCommitments({ leadId, status: "open", includeTests }),
    listActiveClaims("lead", leadId),
    listLeadCalls(leadId),
    listUnifiedEvents(leadId, 300),
    listLeadEventPage(leadId, requestedActivityPage, 25, operator.role),
    listOperators(),
    listJobLineItems(leadId, operator.role, includeTests),
    getSql()`SELECT blob_path, sensitivity FROM ingest_attachments
      WHERE lead_id = ${leadId}::bigint AND status = 'stored'`,
    operator.role === "owner" && lead.service === "Needs job match" && !lead.routed_to_lead_id && lead.person_id
      ? getSql()`SELECT id, service, message FROM leads
          WHERE person_id = ${lead.person_id}::bigint AND id <> ${lead.id}::bigint
            AND is_test = ${lead.is_test}::boolean
            AND completed_at IS NULL AND status NOT IN ('lost','spam')
            AND routed_to_lead_id IS NULL AND service <> 'Needs job match'
          ORDER BY updated_at DESC LIMIT 20`
      : Promise.resolve([]),
  ])
  const attachmentSensitivity = new Map((attachmentClassifications as Array<{ blob_path: string; sensitivity: string }>).map((item) => [item.blob_path, item.sensitivity]))
  const fileChoices = routingChoices as Array<{ id: number; service: string; message: string }>
  const routedToLeadId = Number(lead.routed_to_lead_id) || null
  const needsJobMatch = lead.service === "Needs job match" && !routedToLeadId
  const activityPageNumber = activityPage.page

  const completionReceipts = lead.completed_at ? (await getSql()`
      SELECT e.id, e.occurred_at
      FROM events e
      WHERE e.lead_id = ${lead.id}::bigint
        AND e.kind = 'job.completed'
        AND e.occurred_at <= ${lead.completed_at}::timestamptz
      ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1`) as Array<{
        id: number
        occurred_at: string
      }> : []
  const handoffReceipts = lead.handed_off_at ? (await getSql()`
    SELECT e.id, e.occurred_at, e.actor_id
    FROM events e
    WHERE e.lead_id = ${lead.id}::bigint
      AND e.kind = 'job.handed-off'
      AND e.occurred_at = ${lead.handed_off_at}::timestamptz
    ORDER BY e.id DESC LIMIT 1`) as Array<{
      id: number
      occurred_at: string
      actor_id: string
    }> : []
  const completionReceipt = completionReceipts[0] ?? null
  const completionUndoUntil = completionReceipt
    && !isPast(new Date(new Date(completionReceipt.occurred_at).getTime() + 10_000).toISOString())
      ? new Date(new Date(completionReceipt.occurred_at).getTime() + 10_000).toISOString()
      : null
  const handoffReceipt = handoffReceipts[0] ?? null
  const handoffUndoUntil = handoffReceipt
    && handoffReceipt.actor_id === String(operator.id)
    && !isPast(new Date(new Date(handoffReceipt.occurred_at).getTime() + 10_000).toISOString())
      ? new Date(new Date(handoffReceipt.occurred_at).getTime() + 10_000).toISOString()
      : null

  const requestedReplyPersonId = Number(query.replyTo)
  const replyTargets = Number.isInteger(requestedReplyPersonId) && requestedReplyPersonId > 0 ? (await getSql()`
    SELECT target.id, target.display_name, target.phones[1] AS phone, target.emails[1] AS email
    FROM people target
    LEFT JOIN people primary_person ON primary_person.id = ${lead.person_id}::bigint
    WHERE target.id = ${requestedReplyPersonId}::bigint
      AND target.merged_into IS NULL
      AND target.is_test = ${lead.is_test}::boolean
      AND (
        target.id = ${lead.person_id}::bigint
        OR (primary_person.account_key <> '' AND target.account_key = primary_person.account_key)
      )
    LIMIT 1`) as { id: number; display_name: string; phone: string | null; email: string | null }[] : []
  const replyTarget = replyTargets[0] ?? null
  const replyTargetPhone = normalizePhone(replyTarget?.phone ?? "")
  const replyTargetConsent = replyTargetPhone ? await getMessagingConsentState(replyTargetPhone) : "unknown"

  const identityConflicts = operator.role === "owner" ? (await getSql()`
    SELECT c.id, c.phone, c.email,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.display_name, 'company', p.company,
        'phones', p.phones, 'emails', p.emails
      ) ORDER BY p.created_at) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb) AS people
    FROM person_identity_conflicts c
    LEFT JOIN people p ON p.id = ANY(c.person_ids) AND p.merged_into IS NULL
    WHERE c.lead_id = ${lead.id}::bigint AND c.status = 'open'
    GROUP BY c.id
    ORDER BY c.created_at DESC`) as Array<{
      id: number
      phone: string
      email: string
      people: Array<{ id: number; name: string; company: string; phones: string[]; emails: string[] }>
    }> : []

  const assignedOperator = operators.find((item) => item.id === lead.assigned_operator_id)
  const customerPhone = normalizePhone(lead.phone)
  const hasCustomerPhone = Boolean(customerPhone && !lead.phone_is_placeholder && !isReservedShopPhone(customerPhone))
  const smsServiceReady = twilioSmsConfigured()
  const voiceReady = voiceTranscriptionConfigured()
  const consentState = hasCustomerPhone ? await getMessagingConsentState(customerPhone) : "unknown"
  const customerTextReady = smsServiceReady && consentState === "granted"
  const targetTextReady = smsServiceReady && replyTargetConsent === "granted"
  let activeGlassUrl = ""
  let activeGlassError = ""
  let activeGlassNeedsReplacement = false
  if (operator.role === "owner") {
    try {
      const activeGlass = await getActiveGlassLinkState(lead.id)
      activeGlassUrl = activeGlass.token ? glassUrl(activeGlass.token) : ""
      activeGlassNeedsReplacement = activeGlass.needsReplacement
      if (activeGlass.needsReplacement) {
        activeGlassError = "This older Customer Page cannot be recovered safely. Replace it before sharing the link again."
      }
    } catch {
      activeGlassError = "The active Customer Page could not be verified. Check setup before sharing it."
    }
  }
  const safeUnifiedEvents = unifiedEvents.map((event) => projectEventForRole(event, operator.role)).filter((event): event is NonNullable<typeof event> => Boolean(event))
  const safeActivityItems = activityPage.items.map((event) => projectEventForRole(event, operator.role)).filter((event): event is NonNullable<typeof event> => Boolean(event))
  const recentActivity = [...safeUnifiedEvents].reverse().slice(0, 3)
  const activityPages = Math.max(1, Math.ceil(activityPage.total / activityPage.pageSize))
  const safePromises = promises.map((item) => projectCommitmentForRole(item, operator.role))
  const safeClaims = claims.map((claim) => projectClaimForRole(claim, operator.role)).filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))

  const responseMinutes = lead.first_response_at
    ? Math.round(
        (new Date(lead.first_response_at).getTime() - new Date(lead.created_at).getTime()) / 60000
      )
    : null
  const sourceEventById = new Map(safeUnifiedEvents.map((event) => [event.id, event]))
  const sourceCallBySid = new Map(calls.map((call) => [call.twilio_sid, call]))
  // The immutable claim journal may contain the same extracted fact from
  // several calls or emails. The work-order summary is a projection, not the
  // journal: show each normalized fact once, and do not repeat the service
  // already printed at the top of this card.
  const visibleClaimKeys = new Set([claimDisplayKey("service", lead.service)])
  const memoryClaims = safeClaims
    .filter((claim) => !["quoted_price_cents", "build_fact"].includes(claim.predicate))
    .filter((claim) => {
      const key = claimDisplayKey(claim.predicate, claim.value)
      if (visibleClaimKeys.has(key)) return false
      visibleClaimKeys.add(key)
      return true
    })
    .slice(0, 6)
  const visibleJobStatus = lead.status === "spam" || lead.status === "lost"
    ? shopJobStatusLabel(lead.status)
    : lead.handed_off_at
    ? "Closed"
    : lead.completed_at
      ? "Ready"
    : lead.work_started_at
      ? "In Shop"
      : shopJobStatusLabel(lead.status)
  const lastCustomerEvent = [...safeUnifiedEvents].reverse().find((event) =>
    event.actor_type === "customer" || ["sms.in", "email.in", "call.transcript", "form.quote"].includes(event.kind)
  )
  const spikeEvents = safeUnifiedEvents.filter((event) => ["email.in", "email.out", "email.attachments", "note.voice", "job.completed"].includes(event.kind))
  const spikeItems: SpikeItem[] = [
    ...calls.map((call) => ({ kind: "call" as const, at: call.started_at, id: `call-${call.id}`, call })),
    ...messages.map((message) => ({ kind: "message" as const, at: message.sent_at, id: `message-${message.id}`, message })),
    ...spikeEvents.map((event) => ({ kind: "event" as const, at: event.occurred_at, id: `event-${event.id}`, event })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  const emailReceipts = new Map<number, Array<{ kind: string; providerType: string | null }>>()
  for (const event of safeUnifiedEvents) {
    const sourceId = Number(event.detail?.sourceEventId)
    if (!Number.isInteger(sourceId) || sourceId <= 0 || !["email.accepted", "email.failed", "email.unknown", "email.delivered"].includes(event.kind)) continue
    const receipts = emailReceipts.get(sourceId) ?? []
    receipts.push({ kind: event.kind, providerType: typeof event.detail?.providerType === "string" ? event.detail.providerType : null })
    emailReceipts.set(sourceId, receipts)
  }
  const emailDelivery = new Map<number, "failed" | "unknown" | "accepted" | "delivered">()
  for (const [sourceId, receipts] of emailReceipts) {
    const status = strongestEmailReceiptStatus(receipts)
    if (status) emailDelivery.set(sourceId, status)
  }

  return (
    <div className="job-page">
      <section className="card job-lead" aria-labelledby="work-order-title">
      <header className="job-head">
        <div>
          <span className="job-back t-caption">
            <Link href="/ops">Back to Jobs</Link>
          </span>
          <h1 className="t-title" id="work-order-title">
            {lead.first_name} {lead.last_name}
            {lead.is_test && <em className="chip chip--warn job-test-flag">Test</em>}
          </h1>
          <p className="job-meta t-caption">
            Job <strong>#{lead.id}</strong>, opened {formatCentral(lead.created_at)}
          </p>
          {operator.role === "owner" && lead.is_test && buildSheetsEnabled() && <Link className="btn btn--sm btn--edge job-builds" href={`/ops/leads/${lead.id}/builds`} aria-label={`Open Fabrication workspace for Job #${lead.id}`}>
            <strong>Fabrication</strong>
            <span aria-hidden="true">Open →</span>
          </Link>}
        </div>
        <div className={`chip job-status is-${lead.status}`}>{needsJobMatch ? "Needs job match" : routedToLeadId ? "Filed" : visibleJobStatus}</div>
      </header>

      {routedToLeadId && <p className="job-alert job-alert--success job-routing-done">
        Conversation filed to <Link href={`/ops/leads/${routedToLeadId}#spike`}>Job #{routedToLeadId}</Link>. New messages will stay with the matched job while it is active.
      </p>}
      {needsJobMatch && operator.role === "owner" && <section className="job-routing" aria-labelledby="job-routing-title">
        <div><span>One quick decision</span><h2 className="t-sub" id="job-routing-title">Which job are these messages about?</h2><p>The text stayed separate so it could not land on the wrong work order.</p></div>
        {fileChoices.length ? <form action={routeConversationToJob}>
          <input type="hidden" name="sourceLeadId" value={lead.id} />
          <label htmlFor="job-route-target">File conversation under<select id="job-route-target" name="targetLeadId" required defaultValue="">
            <option value="" disabled>Choose the correct job</option>
            {fileChoices.map((choice) => <option value={choice.id} key={choice.id}>Job #{choice.id} · {choice.service} · {choice.message.slice(0, 70)}</option>)}
          </select></label>
          <SafeSubmitButton className="btn btn--sm btn--go" pendingLabel="Filing...">File messages to job</SafeSubmitButton>
        </form> : <p className="job-alert job-alert--stop">No other active job is available. Open the correct job first, then return here.</p>}
      </section>}

      <div className="job-contact">
        <div>
          <span>Contact</span>
          <strong>{lead.phone_is_placeholder || !lead.phone
            ? "Customer number not caught"
            : hasCustomerPhone
              ? displayPhone(customerPhone)
              : "Customer number incomplete"}</strong>
          <small>{assignedOperator?.name || (lead.assigned_operator_id === operator.id ? operator.name : "Not assigned")}</small>
          {lead.person_id && Number(lead.person_job_count ?? 0) > 1 && <Link className="btn btn--sm btn--edge job-repeat" href={`/ops/accounts/${lead.person_id}`}>Repeat customer, {Number(lead.person_job_count) - 1} prior jobs</Link>}
          {lead.email && <Link className="btn btn--sm btn--edge job-email" href="?replyChannel=email#job-reply">Email</Link>}
        </div>
        {!needsJobMatch && !routedToLeadId && <nav className="job-action-spine" aria-label="Job actions">
          {hasCustomerPhone && <TrackedCallButton leadId={lead.id} phone={customerPhone} label="Call" />}
          {customerTextReady && <Link className="btn btn--sm btn--edge" href="?replyChannel=text#job-reply">Text</Link>}
          <Link className="btn btn--sm btn--edge" href="#onsite-payment">Take payment</Link>
          <Link className="btn btn--sm btn--edge" href="#finish-close">{lead.handed_off_at ? "Job closed" : lead.completed_at ? "Close job" : "Finish work"}</Link>
        </nav>}
      </div>

      {!needsJobMatch && !routedToLeadId && <details className="job-contact-edit" open={!hasCustomerPhone && !lead.email}>
        <summary>{hasCustomerPhone || lead.email ? "Edit contact" : "Add contact"}</summary>
        <form action={captureLeadContact}>
          <input type="hidden" name="leadId" value={lead.id} />
          <label htmlFor="job-contact-phone">Mobile number<input id="job-contact-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={!lead.phone_is_placeholder ? lead.phone : ""} placeholder="(615) 555-0123" aria-describedby="job-contact-hint" /></label>
          <label htmlFor="job-contact-email">Email<input id="job-contact-email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={lead.email} placeholder="customer@company.com" aria-describedby="job-contact-hint" /></label>
          <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Save contact</SafeSubmitButton>
        </form>
        <small id="job-contact-hint">The customer record is checked before saving.</small>
      </details>}

      {!needsJobMatch && !routedToLeadId && smsServiceReady && hasCustomerPhone && consentState === "unknown" && operator.role === "owner" && <details className="job-consent" id="text-permission">
        <summary>Enable customer texting</summary>
        <p>Before recording permission, tell the customer: “You agree to receive recurring customer-care and job-update text messages from Music City Specialty Welding about this job. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is optional and is not a condition of purchase.” Use this only after the customer clearly says yes.</p>
        <form action={recordVerbalTextConsent}>
          <input type="hidden" name="leadId" value={lead.id} />
          <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Recording…">Customer said yes</SafeSubmitButton>
        </form>
      </details>}
      {!needsJobMatch && !routedToLeadId && smsServiceReady && hasCustomerPhone && consentState === "revoked" && <p className="job-alert job-alert--stop" id="text-permission">Customer opted out. Text stays off until the customer sends START.</p>}

      {!needsJobMatch && !routedToLeadId && identityConflicts.map((conflict, conflictIndex) => <section className="job-identity" id={conflictIndex === 0 ? "identity-jig" : `identity-jig-${conflict.id}`} key={conflict.id}>
        <div><span>Customer check · owner</span><h2 className="t-sub">Two customer records disagree</h2><p>The job stayed separate. Choose only when the activity record makes it clear.</p></div>
        <div className="job-identity-choices">
          {conflict.people.map((person) => <form action={resolveIdentityConflict} key={person.id}>
            <input type="hidden" name="conflictId" value={conflict.id} />
            <input type="hidden" name="personId" value={person.id} />
            <strong>{person.name || person.company || `Customer #${person.id}`}</strong>
            <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Use this customer</SafeSubmitButton>
            <small>{person.company || person.emails[0] || person.phones[0] || "Existing customer"}</small>
          </form>)}
          <form action={resolveIdentityConflict}>
            <input type="hidden" name="conflictId" value={conflict.id} />
            <input type="hidden" name="personId" value="0" />
          <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Keep separate</SafeSubmitButton>
            <small>Neither record is this customer.</small>
          </form>
        </div>
      </section>)}

      </section>

      <div className="job-flow">
      <section className="card job-summary" aria-label="Job summary">
        <header><h2 className="t-sub">Job Summary</h2></header>
        <div className="job-brief">
          <strong>{lead.service}</strong>
          <p>{lead.message.trim() || "The job need has not been written down yet."}</p>
        </div>

        {Array.isArray(lead.photos) && lead.photos.length > 0 && <div className="job-photos">
          {lead.photos.map((photo) => {
            const glassPhoto = photo as typeof photo & { shared?: boolean; caption?: string }
            return <figure key={photo.pathname}>
              <a href={`/api/ops/photo?lead=${lead.id}&path=${encodeURIComponent(photo.pathname)}`} target="_blank" rel="noreferrer">
                <img src={`/api/ops/photo?lead=${lead.id}&path=${encodeURIComponent(photo.pathname)}`} alt={`Job photo ${photo.name}`} loading="lazy" />
              </a>
              {operator.role === "owner" && <form action={setPhotoShared}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="pathname" value={photo.pathname} /><input name="caption" type="text" autoComplete="off" defaultValue={glassPhoto.caption ?? lead.glass_caption_draft} placeholder="Customer caption" aria-label="Customer photo caption" /><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving..." name="shared" value={glassPhoto.shared ? "0" : "1"}>{glassPhoto.shared ? "Hide from Customer Page" : "Add to Customer Page"}</SafeSubmitButton></form>}
            </figure>
          })}
        </div>}

        {memoryClaims.length > 0 && <div className="job-facts">
          {memoryClaims.map((claim) => {
            const source = sourceEventById.get(claim.source_event_id)
            return <article className={`job-fact${claim.confidence < 0.6 ? " is-pencil" : ""}`} id={`jig-claim-${claim.id}`} key={claim.id}>
              <span>{shopClaimLabel(claim.predicate)}</span>
              <strong>{shopClaimText(claim.value)}</strong>
              <small>{claim.confidence < 0.6 ? "Needs a quick check" : "Source saved"}</small>
              {source && <details><summary>Show source</summary><p>{visibleEventText(source.body || source.kind, operator.role)}</p><time>{formatCentral(source.occurred_at)}</time>{operator.role === "owner" && <SourceCallAudio event={source} calls={calls} />}</details>}
              <details className="job-fact-edit"><summary>Edit detail</summary><form action={correctClaim}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="claimId" value={claim.id} /><input name="value" type="text" autoComplete="off" defaultValue={shopClaimText(claim.value)} aria-label={`Correct ${shopClaimLabel(claim.predicate)}`} /><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Save correction</SafeSubmitButton></form></details>
            </article>
          })}
        </div>}
      </section>

      {safePromises.length > 0 && <section className="card job-promises" aria-label="Job promises">
        <header><h2 className="t-sub">Promises</h2><span>{safePromises.length} open</span></header>
        <div>{safePromises.map((promise) => (
          <article id={`promise-${promise.id}`} className={`job-promise${promise.confidence < 0.6 ? " is-pencil" : ""}`} key={promise.id}>
            <span>{promise.direction === "we_promised" ? "We told them" : "They told us"}</span>
            <strong>{promise.summary}</strong>
            <time>{promise.due_at ? formatCentral(promise.due_at) : "No date caught"}</time>
            {sourceEventById.get(promise.source_event_id) && <Link className="btn btn--sm btn--edge job-promise-source" href={`#e${promise.source_event_id}`}>Show source, {formatCentral(sourceEventById.get(promise.source_event_id)!.occurred_at)}</Link>}
            <div className="job-actions">
              {promise.confidence < 0.6 && <form action={confirmPromise}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Confirm</SafeSubmitButton></form>}
              <form action={keepPromise}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Mark kept</SafeSubmitButton></form>
              <form action={rejectPromise}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Removing...">Not a promise</SafeSubmitButton></form>
              {operator.role === "owner" && promise.direction === "we_promised" && promise.due_at && <form action={publishPromiseToGlass}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Adding...">Add to Customer Page</SafeSubmitButton></form>}
            </div>
            {promise.due_at && isPast(promise.due_at) && customerTextReady && <details className="job-handle"><summary>Handle it</summary><form action={handlePromise}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><LatePromiseMessage leadId={lead.id} commitmentId={promise.id} fallback={`Running behind on your ${lead.service.toLowerCase()}. I’m sorry.`} /><input name="reason" type="text" autoComplete="off" defaultValue="Running behind — new date confirmed with the shop." aria-label="Reason shown on Customer Page" /><label htmlFor={`promise-due-${promise.id}`}>New promise<select id={`promise-due-${promise.id}`} name="quickDue" defaultValue="tomorrow-am"><option value="tomorrow-am">Tomorrow morning</option><option value="two-days-am">In two mornings</option><option value="next-monday-am">Next Monday morning</option></select></label><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Sending...">Text + update date</SafeSubmitButton></form></details>}
            {promise.due_at && isPast(promise.due_at) && !customerTextReady && <p className="job-empty t-caption">Texting is unavailable until the customer has consented.</p>}
          </article>
        ))}</div>
      </section>}

      <section className="card job-thread" id="spike" aria-label="Customer thread">
        <header><h2 className="t-sub">Calls &amp; Messages</h2></header>
        <div className="job-thread-stack">
          {spikeItems.length === 0 && <p className="job-empty t-caption">No calls or messages yet.</p>}
          {spikeItems.map((item) => {
            if (item.kind === "call") {
              const call = item.call
              return <article className="job-call" key={item.id}><div><strong>{call.direction === "out" ? "Shop call" : "Customer call"}</strong><span>{formatCentral(call.started_at)}{call.duration_sec ? `, ${Math.max(1, Math.round(call.duration_sec / 60))} min` : ""}</span></div>{call.recording_url && operator.role === "owner" && <audio controls preload="none" src={`/api/ops/call/${call.id}`} />}{call.transcript && <details><summary>Show transcript</summary><p>{operator.role === "owner" ? call.transcript : redactCrewText(call.crew_transcript || "MCSW Jobs is preparing the crew-safe transcript.")}</p></details>}</article>
            }
            if (item.kind === "message") {
              const message = item.message
              return <article className={`job-message is-${message.direction}${["failed", "undelivered"].includes(message.status) ? " is-failed" : ""}`} key={item.id}><span>{message.direction === "in" ? lead.first_name || "Customer" : "Shop"}</span><p>{(operator.role === "owner" ? message.body : redactCrewText(message.crew_body || "MCSW Jobs is preparing the crew-safe message.")) || `${message.media.length} attachment(s)`}</p><SpikeAttachments items={spikeAttachments(message.media).map((item) => ({ ...item, sensitivity: attachmentSensitivity.get(item.pathname) || item.sensitivity }))} leadId={lead.id} role={operator.role} /><time>{formatCentral(message.sent_at)}{message.direction === "out" ? `, ${shopDeliveryLabel(message.status)}` : ""}</time></article>
            }
            const event = item.event
            if (event.kind === "job.completed" || event.kind === "note.voice") {
              const byline = typeof event.detail?.operatorName === "string" ? event.detail.operatorName : operators.find((person) => String(person.id) === event.actor_id)?.name || "Crew"
              return <article className="job-call is-closeout" key={item.id}><div><strong>{event.detail?.noteSource === "voice" || event.kind === "note.voice" ? "Voice note" : "Work finished"}</strong><span>{byline}, {formatCentral(event.occurred_at)}</span></div>{operator.role === "owner" && typeof event.detail?.voicePath === "string" && <audio controls preload="none" src={`/api/ops/voice-note?event=${event.id}`} />}<p>{visibleEventText(event.body, operator.role)}</p></article>
            }
            const delivery = event.kind === "email.out" ? emailDelivery.get(Number(event.id)) ?? (event.detail?.deliveryStatus === "delivered" ? "delivered" : "pending") : null
            return <article className={`job-letter is-${event.kind === "email.out" ? "out" : "in"}${delivery === "failed" ? " is-failed" : ""}`} key={item.id}><span>{event.kind === "email.out" ? `Shop email, ${shopDeliveryLabel(delivery ?? "pending")}` : event.kind === "email.attachments" ? "Attachments" : event.kind === "email.failed" ? "Email failed" : "Customer email"}</span><p>{visibleEventText(event.body, operator.role)}</p><SpikeAttachments items={spikeAttachments(event.detail?.attachments).map((item) => ({ ...item, sensitivity: attachmentSensitivity.get(item.pathname) || item.sensitivity }))} leadId={lead.id} role={operator.role} /><time>{formatCentral(event.occurred_at)}</time></article>
          })}
        </div>
        {!needsJobMatch && !routedToLeadId && (customerTextReady || Boolean(lead.email) || targetTextReady || Boolean(replyTarget?.email)) ? <SpikeReply
          leadId={lead.id}
          hasEmail={Boolean(lead.email)}
          hasPhone={customerTextReady}
          targetPersonId={replyTarget?.id ?? null}
          targetName={replyTarget?.display_name || ""}
          targetHasPhone={targetTextReady}
          targetHasEmail={Boolean(replyTarget?.email)}
          voiceReady={voiceReady}
          focusOnMount={query.replyChannel === "text" || query.replyChannel === "email"}
          initialChannel={query.replyChannel === "text" && (replyTarget ? targetTextReady : customerTextReady) ? "text" : query.replyChannel === "email" && (replyTarget?.email || lead.email) ? "email" : replyTarget && !targetTextReady && replyTarget.email ? "email" : !replyTarget && (!customerTextReady || lastCustomerEvent?.kind === "email.in" || lead.preferred_contact.toLowerCase() === "email") ? "email" : "text"}
        /> : <p className="job-empty t-caption">{needsJobMatch ? "Choose the correct job before replying." : routedToLeadId ? `Continue this conversation in Job #${routedToLeadId}.` : "Add an email address or record text consent before replying."}</p>}
      </section>

      {operator.role === "owner" && !needsJobMatch && !routedToLeadId && <GlassControl
        leadId={lead.id}
        textReady={customerTextReady}
        initialUrl={activeGlassUrl}
        initialError={activeGlassError}
        initialNeedsReplacement={activeGlassNeedsReplacement}
        smsReady={smsServiceReady}
      />}
      </div>

      {!needsJobMatch && !routedToLeadId && <details className="card job-details">
        <summary>
          <span><strong>Job Details</strong><small>Contact, price, status, notes</small></span>
          <b aria-hidden="true" />
        </summary>
        <div className="job-details-body">
      <div className="job-columns">
        <details className="job-ledger" aria-label="Customer and source" name="job-detail-group">
          <summary><span><strong>Customer &amp; Source</strong><small>{lead.email || lead.preferred_contact || "Contact details"}</small></span><b aria-hidden="true" /></summary>
          <div className="job-ledger-body">
          <h2 className="t-sub">Customer</h2>
          <dl>
            <div>
              <dt>Email</dt>
              <dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : "not given"}</dd>
            </div>
            <div><dt>Prefers</dt><dd>{lead.preferred_contact || "Not set"}</dd></div>
            <div>
              <dt>First call-back</dt>
              <dd>
                {lead.first_response_at
                  ? `${formatCentral(lead.first_response_at)}, ${responseMinutes} min (${lead.first_response_channel || "unrecorded"})`
                  : "not yet"}
              </dd>
            </div>
            {lead.next_follow_up_at && (
              <div>
                <dt>Next reminder</dt>
                <dd>{formatCentral(lead.next_follow_up_at)}</dd>
              </div>
            )}
          </dl>

          <h2 className="t-sub">Source</h2>
          <dl>
            <div><dt>Source</dt><dd>{shopSourceLabel(lead.source)}</dd></div>
            {lead.utm_campaign && <div><dt>Campaign</dt><dd>{lead.utm_campaign}</dd></div>}
            <div>
              <dt>Owner email</dt>
              <dd className={lead.email_delivery_status === "failed" ? "is-bad" : ""}>
                {shopDeliveryLabel(lead.email_delivery_status)}
                {lead.email_delivery_error ? `: ${lead.email_delivery_error}` : ""}
                {lead.email_delivery_status === "failed" && (
                  <form action={acknowledgeDeliveryFailure} className="job-inline-ack">
                    <input type="hidden" name="leadId" value={lead.id} />
              <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Mark handled</SafeSubmitButton>
                  </form>
                )}
              </dd>
            </div>
          </dl>
          {operator.role === "owner" && (lead.gclid || lead.landing_page || lead.referrer) && <details className="job-attribution">
            <summary>Ad details</summary>
            <dl>
              {lead.gclid && <div className="job-span"><dt>Click ID</dt><dd className="job-mono">{lead.gclid}</dd></div>}
              {lead.landing_page && <div className="job-span"><dt>Landed on</dt><dd className="job-mono">{lead.landing_page}</dd></div>}
              {lead.referrer && <div className="job-span"><dt>Referred by</dt><dd className="job-mono">{lead.referrer}</dd></div>}
            </dl>
          </details>}
          </div>
        </details>

        <section className="job-command" aria-label="Work the job">

          {operator.role === "owner" && safeClaims.some((claim) => claim.predicate === "quoted_price_cents") && <section className="job-quote-capture" id="quote-capture">
            <span>Suggested quote</span><h2 className="t-sub">Did you quote this?</h2>
            {safeClaims.filter((claim) => claim.predicate === "quoted_price_cents").map((claim) => {
              const value = claim.value as number | { cents?: number }
              const cents = typeof value === "number" ? value : Number(value?.cents)
              return <article key={claim.id}><strong>{Number.isFinite(cents) ? `$${(cents / 100).toLocaleString("en-US")}` : "Dollar amount found"}</strong><div><form action={acceptQuoteCapture}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="claimId" value={claim.id} /><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Mark quoted</SafeSubmitButton></form><form action={rejectQuoteCapture}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="claimId" value={claim.id} /><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Not a quote</SafeSubmitButton></form></div></article>
            })}
          </section>}

          <details className="job-drawer" name="job-command" open={!lead.first_response_at}>
            <summary>
              <span><strong>Contact</strong><small>{lead.first_response_at ? "Call-back logged" : "Call-back needed"}</small></span>
              <b aria-hidden="true" />
            </summary>
            <div className="job-drawer-body">

          {!lead.first_response_at && (
            <form action={markFirstResponse} className="job-form">
              <input type="hidden" name="leadId" value={lead.id} />
              <label htmlFor="response-channel">Called them back via</label>
              <select id="response-channel" name="channel" defaultValue="phone">
                <option value="phone">phone</option>
                <option value="text">text</option>
                <option value="email">email</option>
                <option value="in-person">in person</option>
              </select>
                <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Mark first response</SafeSubmitButton>
            </form>
          )}

          <form action={logInteraction} className="job-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="interaction-channel">Log a touch</label>
            <select id="interaction-channel" name="channel" defaultValue="phone">
              <option value="phone">called</option>
              <option value="text">texted</option>
              <option value="email">emailed</option>
              <option value="voicemail">left voicemail</option>
              <option value="in-person">met in person</option>
            </select>
            <input name="note" type="text" autoComplete="off" placeholder="What happened? (optional)" aria-label="Contact note" />
                <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Save contact</SafeSubmitButton>
          </form>

          <form action={setFollowUp} className="job-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="follow-up-when">Remind me</label>
            <select id="follow-up-when" name="quick" defaultValue="1d">
              <option value="4h">in 4 hours</option>
              <option value="1d">tomorrow</option>
              <option value="3d">in 3 days</option>
              <option value="1w">next week</option>
            </select>
                <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Set reminder</SafeSubmitButton>
            {lead.next_follow_up_at && (
                <SafeSubmitButton name="clear" value="1" className="btn btn--sm btn--edge" pendingLabel="Clearing...">
                Clear reminder
                </SafeSubmitButton>
            )}
          </form>
            </div>
          </details>

          {operator.role === "owner" && <details className="job-drawer" name="job-command">
          <summary>
            <span><strong>Price &amp; Invoice</strong><small>{lead.invoice_number ? `Invoice #${lead.invoice_number}` : lead.estimate_value_cents !== null ? `${money(lead.estimate_value_cents)} estimate` : "No price saved"}</small></span>
            {lead.paid_at && <strong className="chip chip--good job-paid-stamp">PAID</strong>}
            <b aria-hidden="true" />
          </summary>
          <div className="job-drawer-body">
          {lead.paid_at && <p className="job-paid-line t-caption">Payment landed {formatCentral(lead.paid_at)}{lead.invoice_number ? ` · Invoice #${lead.invoice_number}` : ""}</p>}

          <form action={saveEstimate} className="job-form job-money-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <table className="sum-style">
              <tbody>
                <tr><th><label htmlFor="lead-estimate">Estimate ($); saves the job as quoted</label></th><td><input
                  id="lead-estimate"
                  name="estimate"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={centsToDollars(lead.estimate_value_cents)}
                  placeholder="e.g. 1200"
                /></td></tr>
                {lead.email && (
                  <tr><td colSpan={2}><label className="job-check">
                    <input type="checkbox" name="emailEstimate" />
                    email this estimate to the customer
                  </label></td></tr>
                )}
                <tr><td colSpan={2}><label className="job-check">
                  <input type="checkbox" name="sendGlass" disabled={!customerTextReady} />
                  {customerTextReady ? "create the Customer Page and text this quote" : "Customer Page texting requires consent and A2P approval"}
                </label></td></tr>
                <tr className="total"><td colSpan={2}><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Save quote{customerTextReady ? " + send" : ""}</SafeSubmitButton></td></tr>
              </tbody>
            </table>
          </form>

          {/* What is in the price. The board's expand panel reads these lines
              back as the "What is in it" breakdown. The quote itself is the
              field above -- when the lines do not add up to it, both numbers
              are shown and neither is quietly adjusted. */}
          <form action={saveJobLineItems} className="job-form job-money-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <table className="sum-style">
              <tbody>
                <tr><th colSpan={2}><label htmlFor="lead-line-items">
                  What is in the price. One line each: <code>Label | note | amount</code>, or <code>Label | amount</code>.
                </label></th></tr>
                <tr><td colSpan={2}><textarea
                  id="lead-line-items"
                  name="lineItems"
                  rows={6}
                  autoComplete="off"
                  spellCheck={false}
                  defaultValue={formatLineItemsText(lineItems)}
                  placeholder={"Steel | 10 ga galv, 18 pcs | 1860\nCut and form | 6.5 hrs | 780\nGalv touch-up | 180"}
                /></td></tr>
                {lineItems.length > 0 && (
                  <tr><td colSpan={2}><span className="job-current t-caption">
                    {lineItems.length} {lineItems.length === 1 ? "line" : "lines"} adding to {money(lineItemsTotalCents(lineItems))}
                    {lead.estimate_value_cents !== null && lineItemsTotalCents(lineItems) !== lead.estimate_value_cents
                      ? ` · the quote says ${money(lead.estimate_value_cents)}`
                      : ""}
                  </span></td></tr>
                )}
                <tr className="total"><td colSpan={2}><SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Save what is in it</SafeSubmitButton></td></tr>
              </tbody>
            </table>
          </form>

          <form action={saveOutcome} className="job-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-revenue">Final job revenue ($). Finishing the job is separate.</label>
            <input
              id="lead-revenue"
              name="revenue"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={centsToDollars(lead.revenue_cents)}
              placeholder="what it actually paid"
            />
            {lead.email && lead.completed_at && (
              <label className="job-check">
                <input type="checkbox" name="sendThanks" />
                send the thank-you email
              </label>
            )}
            <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Save outcome</SafeSubmitButton>
          </form>

          <form action={recordInvoice} className="job-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="invoice-number">
              QuickBooks invoice. The board watches it until payment is verified.
            </label>
            <input
              id="invoice-number"
              name="invoiceNumber"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={lead.invoice_number}
              placeholder="Invoice # (e.g. 1337)"
            />
            <input name="invoiceTotal" type="text" inputMode="decimal" autoComplete="off" defaultValue={centsToDollars(lead.invoice_total_cents)} placeholder="Invoice total" aria-label="Invoice total" />
            <input name="invoicePayUrl" type="url" inputMode="url" autoComplete="off" spellCheck={false} defaultValue={lead.invoice_pay_url} placeholder="QuickBooks pay link (optional)" aria-label="QuickBooks payment link" />
            <select name="dueDays" defaultValue="14" aria-label="Due terms">
              <option value="0">due on receipt</option>
              <option value="7">net 7</option>
              <option value="14">net 14</option>
              <option value="30">net 30</option>
            </select>
            <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">{lead.invoiced_at ? "Update invoice" : "Invoice is out"}</SafeSubmitButton>
            {lead.invoiced_at && (
              <>
                <span className="job-current t-caption">
                  #{lead.invoice_number} out since {formatCentral(lead.invoiced_at)} · due {formatCentral(lead.invoice_due_at)}
                  {!lead.paid_at && lead.invoice_due_at && isPast(lead.invoice_due_at)
                    ? " · OVERDUE"
                    : ""}
                </span>
            <SafeSubmitButton name="clear" value="1" className="btn btn--sm btn--edge" pendingLabel="Clearing...">Clear</SafeSubmitButton>
              </>
            )}
          </form>

          </div>
          </details>}

          <details className="job-drawer" name="job-command">
          <summary>
            <span><strong>Status &amp; Notes</strong><small>{visibleJobStatus}, notes, review</small></span>
            <b aria-hidden="true" />
          </summary>
          <div className="job-drawer-body">

          {operator.role === "owner" && <form action={assignLeadOperator} className="job-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-assignee">Running this job</label>
            <select id="lead-assignee" name="assigneeId" defaultValue={lead.assigned_operator_id ?? ""}>
              <option value="">Not assigned</option>
              {operators.map((item) => <option value={item.id} key={item.id}>{item.name || item.email}</option>)}
            </select>
          <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Save assignment</SafeSubmitButton>
          </form>}

          <div className="job-traveler" aria-label="Customer job status">
            <span>Job Status</span>
            <form action={setJobTravelerStage}>
              <input type="hidden" name="leadId" value={lead.id} />
              <SafeSubmitButton name="stage" value="scheduled" className={`btn btn--sm btn--edge${lead.scheduled_at ? " is-stamped" : ""}`} pendingLabel="Saving...">{lead.scheduled_at ? "On schedule" : "Mark scheduled"}</SafeSubmitButton>
              <SafeSubmitButton name="stage" value="work_started" className={`btn btn--sm btn--edge${lead.work_started_at ? " is-stamped" : ""}`} pendingLabel="Saving...">{lead.work_started_at ? "On the job" : "Mark work started"}</SafeSubmitButton>
            </form>
          </div>

          {!lead.completed_at && !lead.handed_off_at ? <form action={updateLeadStatus} className="job-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-status">Update job status</label>
            <select id="lead-status" name="status" defaultValue={lead.status}>
            {LEAD_STATUSES.filter((status) => status !== "won" && (operator.role === "owner" || (status !== "lost" && status !== "spam"))).map((status) => (
                <option key={status} value={status}>{shopJobStatusLabel(status)}</option>
              ))}
            </select>
            <input name="reason" type="text" autoComplete="off" placeholder="Reason (required for Did not book or Not a job)" defaultValue={lead.status_reason} aria-label="Reason for Did not book or Not a job" />
            <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Update status</SafeSubmitButton>
          </form> : <p className="job-current t-caption">Finished jobs are locked. Use Undo finish below before changing status.</p>}

          <form action={markReviewRequested} className="job-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label className="job-check">
              <input type="checkbox" name="received" defaultChecked={lead.review_received} />
              review received
            </label>
            <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">
              {lead.review_requested_at ? "Update review tracking" : "Mark review requested"}
            </SafeSubmitButton>
          </form>

          <form action={saveNotes} className="job-form job-notes">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-notes">Notes</label>
            <textarea
              id="lead-notes"
              name="notes"
              rows={5}
              autoComplete="off"
              defaultValue={lead.notes}
              placeholder="Quote numbers, measurements, gate codes, the dog's name…"
            />
          <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Save notes</SafeSubmitButton>
          </form>

          {operator.role === "owner" && lead.is_test && (
            <form action={deleteTestLead} className="job-form">
              <input type="hidden" name="leadId" value={lead.id} />
          <SafeSubmitButton className="btn btn--sm btn--edge job-danger" pendingLabel="Archiving...">Archive this internal test job</SafeSubmitButton>
            </form>
          )}
          </div>
          </details>
        </section>
      </div>
        </div>
      </details>}

      {!needsJobMatch && !routedToLeadId && <><section className="card job-onsite-payment" id="onsite-payment" aria-labelledby="onsite-payment-title">
        <header>
          <div>
            <span>On site</span>
            <h2 className="t-sub" id="onsite-payment-title">Take a card or tap payment</h2>
          </div>
          <strong>QuickBooks GoPayment</strong>
        </header>
        <div className="job-onsite-payment-body">
          <p>
            Open GoPayment, choose <strong>Invoice payment</strong>, then find
            {lead.invoice_number ? <> invoice <strong>#{lead.invoice_number}</strong></> : <> <strong>{lead.first_name} {lead.last_name}</strong></>}.
            QuickBooks handles the card. Shop Brain matches its authenticated receipt when the invoice number belongs to one job; anything unmatched waits in Updates for the owner.
          </p>
          {operator.role === "owner" && !lead.invoice_number && <p className="job-payment-note">
            No invoice number is attached yet. The owner can add it under Job details → Price &amp; invoice, or take a Customer payment in GoPayment and match the receipt afterward.
          </p>}
          <div className="job-onsite-payment-actions">
            <a className="btn btn--sm btn--go" href="https://apps.apple.com/us/app/quickbooks-gopayment-pos/id324389392" target="_blank" rel="noreferrer">Open on iPhone</a>
            <a className="btn btn--sm btn--edge" href="https://play.google.com/store/apps/details?id=com.intuit.intuitgopayment" target="_blank" rel="noreferrer">Open on Android</a>
          </div>
          <small>
            Owner setup once: invite each employee in QuickBooks with a <strong>Take payments only</strong> role. Never share the owner login. No card number enters Shop Brain.
          </small>
          {operator.role === "owner" && <a className="job-payment-manual" href="#job-payment">Record another way</a>}
        </div>
      </section>

      {operator.role === "owner" && <section className="card job-payment" id="job-payment" aria-labelledby="job-payment-title">
        <header>
          <div>
            <span>Cash, check, or outside payment</span>
            <h2 className="t-sub" id="job-payment-title">Record what changed hands</h2>
          </div>
          {Number(lead.paid_amount_cents ?? 0) > 0 && <strong>
            Paid {money(lead.paid_amount_cents)}
            {lead.invoice_total_cents ? ` of ${money(lead.invoice_total_cents)}` : ""}
          </strong>}
        </header>
        <PaymentForm
          leadId={lead.id}
          receiptKey={randomUUID()}
          paidAmountCents={Number(lead.paid_amount_cents ?? 0)}
          invoiceTotalCents={lead.invoice_total_cents === null ? null : Number(lead.invoice_total_cents)}
          paidAt={lead.paid_at}
        />
      </section>}

      <section className="job-finish-close" id="finish-close" aria-labelledby="finish-close-title">
        <header className="job-finish-close-head">
          <span>Final steps</span>
          <h2 className="t-sub" id="finish-close-title">Finish &amp; close</h2>
        </header>
        <DoneStamp leadId={lead.id} completed={Boolean(lead.completed_at)} undoUntil={completionUndoUntil} voiceReady={voiceReady} reviewedCloseout={Boolean(operator.role === "owner" && lead.is_test && buildSheetsEnabled())} closeoutKey={randomUUID()} />
        <HandoffControl
          leadId={lead.id}
          completed={Boolean(lead.completed_at)}
          handedOff={Boolean(lead.handed_off_at)}
          initialHandoffEventId={handoffUndoUntil ? Number(handoffReceipt?.id) : null}
          initialUndoUntil={handoffUndoUntil}
        />
      </section></>}

      <section className="card job-events" aria-label="Recent activity">
        <header><h2 className="t-sub">Recent Activity</h2><strong>{activityPage.total}</strong></header>
        <ol className="job-timeline">
          {recentActivity.map((event) => <li id={`e${event.id}`} key={event.id}>
            <span>{formatCentral(event.occurred_at)}</span>
            <strong>{shopEventLabel(event.kind)}</strong>
            <p>{visibleEventText(event.body, operator.role)}</p>
          </li>)}
          {recentActivity.length === 0 && <li><strong>No activity yet.</strong></li>}
        </ol>
        <details className="job-record" open={activityPageNumber > 1}>
          <summary>Full Record <span>{activityPage.total} items</span></summary>
          <div className="job-record-list">
            {safeActivityItems.map((event) => <article id={`record-${event.id}`} key={event.id}>
              <header><strong>{shopEventLabel(event.kind)}</strong><time>{formatCentral(event.occurred_at)}</time></header>
              <p>{visibleEventText(event.body, operator.role)}</p>
              {operator.role === "owner" && typeof event.detail?.callSid === "string" && sourceCallBySid.get(event.detail.callSid) && <audio controls preload="none" src={`/api/ops/call/${sourceCallBySid.get(event.detail.callSid)!.id}#t=${receiptMoment(event.detail)}`} />}
            </article>)}
          </div>
          {activityPages > 1 && <nav className="job-record-pages" aria-label="Full Record pages">
            {activityPageNumber > 1 ? <Link href={`/ops/leads/${lead.id}?activityPage=${activityPageNumber - 1}#record`}>Newer</Link> : <span />}
            <span>Page {activityPageNumber} of {activityPages}</span>
            {activityPageNumber < activityPages ? <Link href={`/ops/leads/${lead.id}?activityPage=${activityPageNumber + 1}#record`}>Older</Link> : <span />}
          </nav>}
        </details>
      </section>
    </div>
  )
}
