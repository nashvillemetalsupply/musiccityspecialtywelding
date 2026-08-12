import Link from "next/link"
import { randomUUID } from "node:crypto"
import { notFound } from "next/navigation"
import { dbConfigured, getSql } from "@/lib/db"
import { LEAD_STATUSES } from "@/lib/leads"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getLead } from "@/lib/ops-data"
import { listLeadMessages } from "@/lib/messages"
import { listCommitments } from "@/lib/commitments"
import { listActiveClaims } from "@/lib/claims"
import { listLeadCalls } from "@/lib/calls"
import { listLeadEventPage, listLeadEvents as listUnifiedEvents } from "@/lib/events"
import { listOperators } from "@/lib/operators"
import { twilioSmsConfigured } from "@/lib/twilio"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { getMessagingConsentState } from "@/lib/messaging-consent"
import { isReservedShopPhone } from "@/lib/people"
import { normalizePage } from "@/lib/pagination"
import { readableEmailText } from "@/lib/gmail-plaintext.mjs"
import { getActiveGlassLinkState } from "@/lib/glass"
import { buildSheetsEnabled } from "@/lib/build-sheets-access"
import { glassUrl } from "@/lib/glass-delivery"
import { shopClaimLabel, shopClaimText, shopDeliveryLabel, shopEventLabel, shopJobStatusLabel, shopSourceLabel } from "@/lib/shop-language"
import { projectClaimForRole, projectCommitmentForRole, projectEventForRole, redactCrewText } from "@/lib/visibility"
import { OpsLoginForm } from "../../login-form"
import { DoneStamp } from "./done-stamp"
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
  deleteTestLead,
  logInteraction,
  markFirstResponse,
  markReviewRequested,
  recordInvoice,
  resolveIdentityConflict,
  saveEstimate,
  saveNotes,
  saveOutcome,
  setPhotoShared,
  setJobTravelerStage,
  setFollowUp,
  updateLeadStatus,
} from "../../actions"

export const dynamic = "force-dynamic"

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
  if (!visible.length) return items.length ? <small className="ops-owner-paper">Available to the owner only.</small> : null
  return <div className="ops-spike-attachments">{visible.map((item) => {
    const href = `/api/ops/attachment?lead=${leadId}&path=${encodeURIComponent(item.pathname)}`
    const isImage = item.contentType.startsWith("image/")
    const isDrawing = /(?:dxf|dwg|step|stp|iges|igs|drawing|blueprint)/i.test(`${item.contentType} ${item.name}`)
    return <a className={isDrawing ? "is-blueprint" : isImage ? "is-polaroid" : "is-file"} href={href} target="_blank" rel="noreferrer" key={item.pathname}>
      {isImage && <img src={href} alt="Customer upload" />}
      <span>{isDrawing ? "Drawing" : isImage ? "Photo" : "File"}</span>
      <strong>{item.name}</strong>
    </a>
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
      <main className="ops-login">
        <h1>Shop operations</h1>
        <p className="ops-alert">The operations database is not configured.</p>
      </main>
    )
  }

  const operator = await getAuthenticatedOperator()
  if (!operator) return <OpsLoginForm linkError={false} />

  const [lead, messages, promises, claims, calls, unifiedEvents, activityPage, operators] = await Promise.all([
    getLead(leadId, operator.role),
    listLeadMessages(leadId),
    listCommitments({ leadId, status: "open" }),
    listActiveClaims("lead", leadId),
    listLeadCalls(leadId),
    listUnifiedEvents(leadId, 300),
    listLeadEventPage(leadId, requestedActivityPage, 25, operator.role),
    listOperators(),
  ])
  if (!lead) notFound()
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
  const replyTargetConsent = replyTarget?.phone ? await getMessagingConsentState(replyTarget.phone) : "unknown"

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
  const hasCustomerPhone = Boolean(lead.phone && !lead.phone_is_placeholder && !isReservedShopPhone(lead.phone))
  const smsServiceReady = twilioSmsConfigured()
  const voiceReady = voiceTranscriptionConfigured()
  const consentState = hasCustomerPhone ? await getMessagingConsentState(lead.phone) : "unknown"
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
  const memoryClaims = safeClaims.filter((claim) => !["quoted_price_cents", "build_fact"].includes(claim.predicate)).slice(0, 6)
  const visibleJobStatus = lead.handed_off_at
    ? "Handed Off"
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
  const emailDelivery = new Map<number, "failed" | "delivered">()
  for (const event of safeUnifiedEvents) {
    const sourceId = Number(event.detail?.sourceEventId)
    if (Number.isInteger(sourceId) && sourceId > 0 && (event.kind === "email.failed" || event.kind === "email.delivered")) emailDelivery.set(sourceId, event.kind === "email.failed" ? "failed" : "delivered")
  }

  return (
    <main className="ops-main ops-detail ops-work-order-vnext">
      <section className="ops-work-order-lead" aria-labelledby="work-order-title">
      <header className="ops-header">
        <div>
          <span className="ops-kicker">
            <Link href="/ops">Back to Jobs</Link>
          </span>
          <h1 id="work-order-title">
            {lead.first_name} {lead.last_name}
            {lead.is_test && <em className="ops-test-flag">Test</em>}
          </h1>
          <p className="ops-sub">
            Job <strong>#{lead.id}</strong>, opened {formatCentral(lead.created_at)}
          </p>
          {operator.role === "owner" && lead.is_test && buildSheetsEnabled() && <Link className="ops-builds-link" href={`/ops/leads/${lead.id}/builds`}>Builds</Link>}
        </div>
        <div className={`ops-stamp-ink is-${lead.status} ops-stamp-hero`}>{visibleJobStatus}</div>
      </header>

      <div className="ops-phone-row">
        <div>
          <span>Contact</span>
          <strong>{lead.phone_is_placeholder ? "Customer number not caught" : lead.phone ? displayPhone(lead.phone) : "Customer number not caught"}</strong>
          <small>{assignedOperator?.name || (lead.assigned_operator_id === operator.id ? operator.name : "Not assigned")}</small>
          {lead.person_id && Number(lead.person_job_count ?? 0) > 1 && <Link className="ops-repeat-link" href={`/ops/accounts/${lead.person_id}`}>Repeat customer, {Number(lead.person_job_count) - 1} prior jobs</Link>}
        </div>
        {hasCustomerPhone && <TrackedCallButton leadId={lead.id} phone={lead.phone} label="Call" />}
        {customerTextReady && <Link className="ops-act-text" href="#spike">Text</Link>}
        {lead.email && <Link className="ops-act-mail" href="#spike">Email</Link>}
      </div>

      <details className="ops-contact-jig" open={!hasCustomerPhone && !lead.email}>
        <summary>{hasCustomerPhone || lead.email ? "Edit contact" : "Add contact"}</summary>
        <form action={captureLeadContact}>
          <input type="hidden" name="leadId" value={lead.id} />
          <label>Mobile number<input name="phone" type="tel" inputMode="tel" defaultValue={hasCustomerPhone ? lead.phone : ""} placeholder="(615) 555-0123" /></label>
          <label>Email<input name="email" type="email" inputMode="email" defaultValue={lead.email} placeholder="customer@company.com" /></label>
          <SafeSubmitButton pendingLabel="Saving...">Save contact</SafeSubmitButton>
        </form>
        <small>The customer record is checked before saving.</small>
      </details>

      {smsServiceReady && hasCustomerPhone && consentState === "unknown" && operator.role === "owner" && <details className="ops-text-consent">
        <summary>Enable customer texting</summary>
        <p>Use this only after the customer clearly agrees to receive job-related texts. Message frequency varies; message and data rates may apply. They can reply STOP to opt out or HELP for help.</p>
        <form action={recordVerbalTextConsent}>
          <input type="hidden" name="leadId" value={lead.id} />
          <SafeSubmitButton pendingLabel="Recording…">Customer said yes</SafeSubmitButton>
        </form>
      </details>}
      {smsServiceReady && hasCustomerPhone && consentState === "revoked" && <p className="ops-text-blocked">Customer opted out. Text stays off until the customer sends START.</p>}

      {identityConflicts.map((conflict, conflictIndex) => <section className="ops-identity-jig" id={conflictIndex === 0 ? "identity-jig" : `identity-jig-${conflict.id}`} key={conflict.id}>
        <div><span>Customer check · owner</span><h2>Two customer records disagree</h2><p>The job stayed separate. Choose only when the activity record makes it clear.</p></div>
        <div className="ops-identity-choices">
          {conflict.people.map((person) => <form action={resolveIdentityConflict} key={person.id}>
            <input type="hidden" name="conflictId" value={conflict.id} />
            <input type="hidden" name="personId" value={person.id} />
            <strong>{person.name || person.company || `Customer #${person.id}`}</strong>
            <SafeSubmitButton pendingLabel="Saving...">Use this customer</SafeSubmitButton>
            <small>{person.company || person.emails[0] || person.phones[0] || "Existing customer"}</small>
          </form>)}
          <form action={resolveIdentityConflict}>
            <input type="hidden" name="conflictId" value={conflict.id} />
            <input type="hidden" name="personId" value="0" />
          <SafeSubmitButton className="ops-ghost" pendingLabel="Saving...">Keep separate</SafeSubmitButton>
            <small>Neither record is this customer.</small>
          </form>
        </div>
      </section>)}

      </section>

      <div className="ops-work-order-flow">
      <section className="ops-job-jig" aria-label="Job summary">
        <header><h2>Job Summary</h2></header>
        <div className="ops-job-brief">
          <strong>{lead.service}</strong>
          <p>{lead.message.trim() || "The job need has not been written down yet."}</p>
        </div>

        {Array.isArray(lead.photos) && lead.photos.length > 0 && <div className="ops-photos">
          {lead.photos.map((photo) => {
            const glassPhoto = photo as typeof photo & { shared?: boolean; caption?: string }
            return <figure key={photo.pathname}>
              <a href={`/api/ops/photo?lead=${lead.id}&path=${encodeURIComponent(photo.pathname)}`} target="_blank" rel="noreferrer">
                <img src={`/api/ops/photo?lead=${lead.id}&path=${encodeURIComponent(photo.pathname)}`} alt={`Job photo ${photo.name}`} loading="lazy" />
              </a>
              {operator.role === "owner" && <form action={setPhotoShared}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="pathname" value={photo.pathname} /><input name="caption" defaultValue={glassPhoto.caption ?? lead.glass_caption_draft} placeholder="Customer caption" aria-label="Customer photo caption" /><SafeSubmitButton pendingLabel="Saving..." name="shared" value={glassPhoto.shared ? "0" : "1"}>{glassPhoto.shared ? "Hide from Customer Page" : "Add to Customer Page"}</SafeSubmitButton></form>}
            </figure>
          })}
        </div>}

        {memoryClaims.length > 0 && <div className="ops-jig-stops">
          {memoryClaims.map((claim) => {
            const source = sourceEventById.get(claim.source_event_id)
            return <article className={claim.confidence < 0.6 ? "is-pencil" : ""} id={`jig-claim-${claim.id}`} key={claim.id}>
              <span>{shopClaimLabel(claim.predicate)}</span>
              <strong>{shopClaimText(claim.value)}</strong>
              <small>{claim.confidence < 0.6 ? "Needs a quick check" : "Source saved"}</small>
              {source && <details><summary>Show source</summary><p>{visibleEventText(source.body || source.kind, operator.role)}</p><time>{formatCentral(source.occurred_at)}</time>{operator.role === "owner" && <SourceCallAudio event={source} calls={calls} />}</details>}
              <details className="ops-claim-correct"><summary>Edit detail</summary><form action={correctClaim}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="claimId" value={claim.id} /><input name="value" defaultValue={shopClaimText(claim.value)} aria-label={`Correct ${shopClaimLabel(claim.predicate)}`} /><SafeSubmitButton pendingLabel="Saving...">Save correction</SafeSubmitButton></form></details>
            </article>
          })}
        </div>}
      </section>

      {safePromises.length > 0 && <section className="ops-job-promises" aria-label="Job promises">
        <header><h2>Promises</h2><span>{safePromises.length} open</span></header>
        <div>{safePromises.map((promise) => (
          <article id={`promise-${promise.id}`} className={`ops-promise-tag${promise.confidence < 0.6 ? " is-pencil" : ""}`} key={promise.id}>
            <span>{promise.direction === "we_promised" ? "We told them" : "They told us"}</span>
            <strong>{promise.summary}</strong>
            <time>{promise.due_at ? formatCentral(promise.due_at) : "No date caught"}</time>
            {sourceEventById.get(promise.source_event_id) && <Link className="ops-promise-source" href={`#e${promise.source_event_id}`}>Show source, {formatCentral(sourceEventById.get(promise.source_event_id)!.occurred_at)}</Link>}
            <div className="ops-promise-actions">
              {promise.confidence < 0.6 && <><form action={confirmPromise}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><SafeSubmitButton pendingLabel="Saving...">Confirm</SafeSubmitButton></form><form action={rejectPromise}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><SafeSubmitButton className="ops-ghost" pendingLabel="Saving...">Reject</SafeSubmitButton></form></>}
              <form action={keepPromise}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><SafeSubmitButton className="ops-ghost" pendingLabel="Saving...">Mark kept</SafeSubmitButton></form>
              {operator.role === "owner" && promise.direction === "we_promised" && promise.due_at && <form action={publishPromiseToGlass}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><SafeSubmitButton className="ops-ghost" pendingLabel="Adding...">Add to Customer Page</SafeSubmitButton></form>}
            </div>
            {promise.due_at && isPast(promise.due_at) && customerTextReady && <details className="ops-handle-promise"><summary>Handle it</summary><form action={handlePromise}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="commitmentId" value={promise.id} /><textarea name="body" rows={3} defaultValue={`Running behind on your ${lead.service.toLowerCase()}. I’m sorry.`} aria-label="Message to customer about the delayed promise" /><input name="reason" defaultValue="Running behind — new date confirmed with the shop." aria-label="Reason shown on Customer Page" /><label>New promise<select name="quickDue" defaultValue="tomorrow-am"><option value="tomorrow-am">Tomorrow morning</option><option value="two-days-am">In two mornings</option><option value="next-monday-am">Next Monday morning</option></select></label><SafeSubmitButton pendingLabel="Sending...">Text + update date</SafeSubmitButton></form></details>}
            {promise.due_at && isPast(promise.due_at) && !customerTextReady && <p className="ops-empty-note">Texting is unavailable until the customer has consented.</p>}
          </article>
        ))}</div>
      </section>}

      <section className="ops-spike" id="spike" aria-label="Customer thread">
        <header><h2>Calls &amp; Messages</h2></header>
        <div className="ops-spike-stack">
          {spikeItems.length === 0 && <p className="ops-empty">No calls or messages yet.</p>}
          {spikeItems.map((item) => {
            if (item.kind === "call") {
              const call = item.call
              return <article className="ops-call-cassette" key={item.id}><div><strong>{call.direction === "out" ? "Shop call" : "Customer call"}</strong><span>{formatCentral(call.started_at)}{call.duration_sec ? `, ${Math.max(1, Math.round(call.duration_sec / 60))} min` : ""}</span></div>{call.recording_url && operator.role === "owner" && <audio controls preload="none" src={`/api/ops/call/${call.id}`} />}{call.transcript && <details><summary>Show transcript</summary><p>{operator.role === "owner" ? call.transcript : redactCrewText(call.crew_transcript || "MCSW Jobs is preparing the crew-safe transcript.")}</p></details>}</article>
            }
            if (item.kind === "message") {
              const message = item.message
              return <article className={`ops-message-slip is-${message.direction}${["failed", "undelivered"].includes(message.status) ? " is-failed" : ""}`} key={item.id}><span>{message.direction === "in" ? lead.first_name || "Customer" : "Shop"}</span><p>{(operator.role === "owner" ? message.body : redactCrewText(message.crew_body || "MCSW Jobs is preparing the crew-safe message.")) || `${message.media.length} attachment(s)`}</p><SpikeAttachments items={spikeAttachments(message.media)} leadId={lead.id} role={operator.role} /><time>{formatCentral(message.sent_at)}{message.direction === "out" ? `, ${shopDeliveryLabel(message.status)}` : ""}</time></article>
            }
            const event = item.event
            if (event.kind === "job.completed" || event.kind === "note.voice") {
              const byline = typeof event.detail?.operatorName === "string" ? event.detail.operatorName : operators.find((person) => String(person.id) === event.actor_id)?.name || "Crew"
              return <article className="ops-call-cassette is-closeout" key={item.id}><div><strong>{event.detail?.noteSource === "voice" || event.kind === "note.voice" ? "Voice note" : "Job finished"}</strong><span>{byline}, {formatCentral(event.occurred_at)}</span></div>{operator.role === "owner" && typeof event.detail?.voicePath === "string" && <audio controls preload="none" src={`/api/ops/voice-note?event=${event.id}`} />}<p>{visibleEventText(event.body, operator.role)}</p></article>
            }
            const delivery = event.kind === "email.out" ? emailDelivery.get(Number(event.id)) ?? (event.detail?.deliveryStatus === "delivered" ? "delivered" : "pending") : null
            return <article className={`ops-letter-sheet is-${event.kind === "email.out" ? "out" : "in"}${delivery === "failed" ? " is-failed" : ""}`} key={item.id}><span>{event.kind === "email.out" ? `Shop email, ${shopDeliveryLabel(delivery ?? "pending")}` : event.kind === "email.attachments" ? "Attachments" : event.kind === "email.failed" ? "Email failed" : "Customer email"}</span><p>{visibleEventText(event.body, operator.role)}</p><SpikeAttachments items={spikeAttachments(event.detail?.attachments)} leadId={lead.id} role={operator.role} /><time>{formatCentral(event.occurred_at)}</time></article>
          })}
        </div>
        {(customerTextReady || Boolean(lead.email) || targetTextReady || Boolean(replyTarget?.email)) ? <SpikeReply
          leadId={lead.id}
          hasEmail={Boolean(lead.email)}
          hasPhone={customerTextReady}
          targetPersonId={replyTarget?.id ?? null}
          targetName={replyTarget?.display_name || ""}
          targetHasPhone={targetTextReady}
          targetHasEmail={Boolean(replyTarget?.email)}
          voiceReady={voiceReady}
          initialChannel={query.replyChannel === "email" && replyTarget?.email ? "email" : !targetTextReady && replyTarget?.email ? "email" : !customerTextReady || lastCustomerEvent?.kind === "email.in" || lead.preferred_contact.toLowerCase() === "email" ? "email" : "text"}
        /> : <p className="ops-empty">Add an email address or record text consent before replying.</p>}
      </section>

      {operator.role === "owner" && <GlassControl
        leadId={lead.id}
        textReady={customerTextReady}
        initialUrl={activeGlassUrl}
        initialError={activeGlassError}
        initialNeedsReplacement={activeGlassNeedsReplacement}
        smsReady={smsServiceReady}
      />}
      </div>

      <details className="ops-job-details-shell">
        <summary>
          <span><strong>Job Details</strong><small>Contact, price, status, notes</small></span>
          <b aria-hidden="true" />
        </summary>
        <div className="ops-job-details-body">
      <div className="ops-columns">
        <details className="ops-order" aria-label="Customer and source" name="job-detail-group">
          <summary><span><strong>Customer &amp; Source</strong><small>{lead.email || lead.preferred_contact || "Contact details"}</small></span><b aria-hidden="true" /></summary>
          <div className="ops-order-body">
          <h2>Customer</h2>
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

          <h2>Source</h2>
          <dl>
            <div><dt>Source</dt><dd>{shopSourceLabel(lead.source)}</dd></div>
            {lead.utm_campaign && <div><dt>Campaign</dt><dd>{lead.utm_campaign}</dd></div>}
            <div>
              <dt>Owner email</dt>
              <dd className={lead.email_delivery_status === "failed" ? "is-bad" : ""}>
                {shopDeliveryLabel(lead.email_delivery_status)}
                {lead.email_delivery_error ? `: ${lead.email_delivery_error}` : ""}
                {lead.email_delivery_status === "failed" && (
                  <form action={acknowledgeDeliveryFailure} className="ops-inline-ack">
                    <input type="hidden" name="leadId" value={lead.id} />
              <SafeSubmitButton className="ops-ghost" pendingLabel="Saving...">Mark handled</SafeSubmitButton>
                  </form>
                )}
              </dd>
            </div>
          </dl>
          {operator.role === "owner" && (lead.gclid || lead.landing_page || lead.referrer) && <details className="ops-attribution-drawer">
            <summary>Ad details</summary>
            <dl>
              {lead.gclid && <div className="ops-span"><dt>Click ID</dt><dd className="ops-mono">{lead.gclid}</dd></div>}
              {lead.landing_page && <div className="ops-span"><dt>Landed on</dt><dd className="ops-mono">{lead.landing_page}</dd></div>}
              {lead.referrer && <div className="ops-span"><dt>Referred by</dt><dd className="ops-mono">{lead.referrer}</dd></div>}
            </dl>
          </details>}
          </div>
        </details>

        <section className="ops-tools ops-command-bench" aria-label="Work the job">

          {operator.role === "owner" && safeClaims.some((claim) => claim.predicate === "quoted_price_cents") && <section className="ops-quote-capture" id="quote-capture">
            <span>Suggested quote</span><h2>Did you quote this?</h2>
            {safeClaims.filter((claim) => claim.predicate === "quoted_price_cents").map((claim) => {
              const value = claim.value as number | { cents?: number }
              const cents = typeof value === "number" ? value : Number(value?.cents)
              return <article key={claim.id}><strong>{Number.isFinite(cents) ? `$${(cents / 100).toLocaleString("en-US")}` : "Dollar amount found"}</strong><div><form action={acceptQuoteCapture}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="claimId" value={claim.id} /><SafeSubmitButton pendingLabel="Saving...">Mark quoted</SafeSubmitButton></form><form action={rejectQuoteCapture}><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="claimId" value={claim.id} /><SafeSubmitButton className="ops-ghost" pendingLabel="Saving...">Not a quote</SafeSubmitButton></form></div></article>
            })}
          </section>}

          <details className="ops-tool-drawer" name="job-command" open={!lead.first_response_at}>
            <summary>
              <span><strong>Contact</strong><small>{lead.first_response_at ? "Call-back logged" : "Call-back needed"}</small></span>
              <b aria-hidden="true" />
            </summary>
            <div className="ops-tool-drawer-body">

          {!lead.first_response_at && (
            <form action={markFirstResponse} className="ops-inline-form">
              <input type="hidden" name="leadId" value={lead.id} />
              <label htmlFor="response-channel">Called them back via</label>
              <select id="response-channel" name="channel" defaultValue="phone">
                <option value="phone">phone</option>
                <option value="text">text</option>
                <option value="email">email</option>
                <option value="in-person">in person</option>
              </select>
                <SafeSubmitButton pendingLabel="Saving...">Mark first response</SafeSubmitButton>
            </form>
          )}

          <form action={logInteraction} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="interaction-channel">Log a touch</label>
            <select id="interaction-channel" name="channel" defaultValue="phone">
              <option value="phone">called</option>
              <option value="text">texted</option>
              <option value="email">emailed</option>
              <option value="voicemail">left voicemail</option>
              <option value="in-person">met in person</option>
            </select>
            <input name="note" placeholder="What happened? (optional)" aria-label="Contact note" />
                <SafeSubmitButton pendingLabel="Saving...">Save contact</SafeSubmitButton>
          </form>

          <form action={setFollowUp} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="follow-up-when">Remind me</label>
            <select id="follow-up-when" name="quick" defaultValue="1d">
              <option value="4h">in 4 hours</option>
              <option value="1d">tomorrow</option>
              <option value="3d">in 3 days</option>
              <option value="1w">next week</option>
            </select>
                <SafeSubmitButton pendingLabel="Saving...">Set reminder</SafeSubmitButton>
            {lead.next_follow_up_at && (
                <SafeSubmitButton name="clear" value="1" className="ops-ghost" pendingLabel="Clearing...">
                Clear reminder
                </SafeSubmitButton>
            )}
          </form>
            </div>
          </details>

          {operator.role === "owner" && <details className="ops-tool-drawer" name="job-command">
          <summary>
            <span><strong>Price &amp; Invoice</strong><small>{lead.invoice_number ? `Invoice #${lead.invoice_number}` : lead.estimate_value_cents !== null ? `${money(lead.estimate_value_cents)} estimate` : "No price saved"}</small></span>
            {lead.paid_at && <strong className="ops-paid-stamp">PAID</strong>}
            <b aria-hidden="true" />
          </summary>
          <div className="ops-tool-drawer-body">
          {lead.paid_at && <p className="ops-paid-line">Payment landed {formatCentral(lead.paid_at)}{lead.invoice_number ? ` · Invoice #${lead.invoice_number}` : ""}</p>}

          <form action={saveEstimate} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-estimate">Estimate ($); saves the job as quoted</label>
            <input
              id="lead-estimate"
              name="estimate"
              inputMode="decimal"
              defaultValue={centsToDollars(lead.estimate_value_cents)}
              placeholder="e.g. 1200"
            />
            {lead.email && (
              <label className="ops-check">
                <input type="checkbox" name="emailEstimate" />
                email this estimate to the customer
              </label>
            )}
            <label className="ops-check">
              <input type="checkbox" name="sendGlass" disabled={!customerTextReady} />
              {customerTextReady ? "create the Customer Page and text this quote" : "Customer Page texting requires consent and A2P approval"}
            </label>
            <SafeSubmitButton pendingLabel="Saving...">Save quote{customerTextReady ? " + send" : ""}</SafeSubmitButton>
          </form>

          <form action={saveOutcome} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-revenue">Final job revenue ($). Finishing the job is separate.</label>
            <input
              id="lead-revenue"
              name="revenue"
              inputMode="decimal"
              defaultValue={centsToDollars(lead.revenue_cents)}
              placeholder="what it actually paid"
            />
            {lead.email && lead.completed_at && (
              <label className="ops-check">
                <input type="checkbox" name="sendThanks" />
                send the thank-you email
              </label>
            )}
            <SafeSubmitButton pendingLabel="Saving...">Save outcome</SafeSubmitButton>
          </form>

          <form action={recordInvoice} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="invoice-number">
              QuickBooks invoice. The board watches it until payment is verified.
            </label>
            <input
              id="invoice-number"
              name="invoiceNumber"
              defaultValue={lead.invoice_number}
              placeholder="Invoice # (e.g. 1337)"
            />
            <input name="invoiceTotal" inputMode="decimal" defaultValue={centsToDollars(lead.invoice_total_cents)} placeholder="Invoice total" aria-label="Invoice total" />
            <input name="invoicePayUrl" type="url" defaultValue={lead.invoice_pay_url} placeholder="QuickBooks pay link (optional)" aria-label="QuickBooks payment link" />
            <select name="dueDays" defaultValue="14" aria-label="Due terms">
              <option value="0">due on receipt</option>
              <option value="7">net 7</option>
              <option value="14">net 14</option>
              <option value="30">net 30</option>
            </select>
            <SafeSubmitButton pendingLabel="Saving...">{lead.invoiced_at ? "Update invoice" : "Invoice is out"}</SafeSubmitButton>
            {lead.invoiced_at && (
              <>
                <span className="ops-followup-current">
                  #{lead.invoice_number} out since {formatCentral(lead.invoiced_at)} · due {formatCentral(lead.invoice_due_at)}
                  {!lead.paid_at && lead.invoice_due_at && isPast(lead.invoice_due_at)
                    ? " · OVERDUE"
                    : ""}
                </span>
            <SafeSubmitButton name="clear" value="1" className="ops-ghost" pendingLabel="Clearing...">Clear</SafeSubmitButton>
              </>
            )}
          </form>

          </div>
          </details>}

          <details className="ops-tool-drawer" name="job-command">
          <summary>
            <span><strong>Status &amp; Notes</strong><small>{visibleJobStatus}, notes, review</small></span>
            <b aria-hidden="true" />
          </summary>
          <div className="ops-tool-drawer-body">

          {operator.role === "owner" && <form action={assignLeadOperator} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-assignee">Running this job</label>
            <select id="lead-assignee" name="assigneeId" defaultValue={lead.assigned_operator_id ?? ""}>
              <option value="">Not assigned</option>
              {operators.map((item) => <option value={item.id} key={item.id}>{item.name || item.email}</option>)}
            </select>
          <SafeSubmitButton pendingLabel="Saving...">Save assignment</SafeSubmitButton>
          </form>}

          <div className="ops-traveler-controls" aria-label="Customer job status">
            <span>Job Status</span>
            <form action={setJobTravelerStage}>
              <input type="hidden" name="leadId" value={lead.id} />
              <SafeSubmitButton name="stage" value="scheduled" className={lead.scheduled_at ? "is-stamped" : ""} pendingLabel="Saving...">{lead.scheduled_at ? "On schedule" : "Mark scheduled"}</SafeSubmitButton>
              <SafeSubmitButton name="stage" value="work_started" className={lead.work_started_at ? "is-stamped" : ""} pendingLabel="Saving...">{lead.work_started_at ? "On the job" : "Mark work started"}</SafeSubmitButton>
            </form>
          </div>

          <form action={updateLeadStatus} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-status">Update job status</label>
            <select id="lead-status" name="status" defaultValue={lead.status}>
            {LEAD_STATUSES.filter((status) => status !== "won" && (operator.role === "owner" || (status !== "lost" && status !== "spam"))).map((status) => (
                <option key={status} value={status}>{shopJobStatusLabel(status)}</option>
              ))}
            </select>
            <input name="reason" placeholder="Reason (required when closing or marking Not a job)" defaultValue={lead.status_reason} aria-label="Reason for closing or marking Not a job" />
            <SafeSubmitButton pendingLabel="Saving...">Update status</SafeSubmitButton>
          </form>

          <form action={markReviewRequested} className="ops-inline-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label className="ops-check">
              <input type="checkbox" name="received" defaultChecked={lead.review_received} />
              review received
            </label>
            <SafeSubmitButton pendingLabel="Saving...">
              {lead.review_requested_at ? "Update review tracking" : "Mark review requested"}
            </SafeSubmitButton>
          </form>

          <form action={saveNotes} className="ops-notes-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor="lead-notes">Notes</label>
            <textarea
              id="lead-notes"
              name="notes"
              rows={5}
              defaultValue={lead.notes}
              placeholder="Quote numbers, measurements, gate codes, the dog's name…"
            />
          <SafeSubmitButton pendingLabel="Saving...">Save notes</SafeSubmitButton>
          </form>

          {operator.role === "owner" && lead.is_test && (
            <form action={deleteTestLead} className="ops-inline-form">
              <input type="hidden" name="leadId" value={lead.id} />
          <SafeSubmitButton className="ops-danger" pendingLabel="Archiving...">Archive this internal test job</SafeSubmitButton>
            </form>
          )}
          </div>
          </details>
        </section>
      </div>
        </div>
      </details>

      <DoneStamp leadId={lead.id} completed={Boolean(lead.completed_at)} undoUntil={completionUndoUntil} voiceReady={voiceReady} reviewedCloseout={Boolean(operator.role === "owner" && lead.is_test && buildSheetsEnabled())} closeoutKey={randomUUID()} />

      <HandoffControl
        leadId={lead.id}
        completed={Boolean(lead.completed_at)}
        handedOff={Boolean(lead.handed_off_at)}
        initialHandoffEventId={handoffUndoUntil ? Number(handoffReceipt?.id) : null}
        initialUndoUntil={handoffUndoUntil}
      />

      <section className="ops-card ops-history ops-recent-activity" aria-label="Recent activity">
        <header><h2>Recent Activity</h2><strong>{activityPage.total}</strong></header>
        <ol className="ops-timeline">
          {recentActivity.map((event) => <li id={`e${event.id}`} key={event.id}>
            <span>{formatCentral(event.occurred_at)}</span>
            <strong>{shopEventLabel(event.kind)}</strong>
            <p>{visibleEventText(event.body, operator.role)}</p>
          </li>)}
          {recentActivity.length === 0 && <li><strong>No activity yet.</strong></li>}
        </ol>
        <details className="ops-full-record" open={activityPageNumber > 1}>
          <summary>Full Record <span>{activityPage.total} items</span></summary>
          <div className="ops-full-record-list">
            {safeActivityItems.map((event) => <article id={`record-${event.id}`} key={event.id}>
              <header><strong>{shopEventLabel(event.kind)}</strong><time>{formatCentral(event.occurred_at)}</time></header>
              <p>{visibleEventText(event.body, operator.role)}</p>
              {operator.role === "owner" && typeof event.detail?.callSid === "string" && sourceCallBySid.get(event.detail.callSid) && <audio controls preload="none" src={`/api/ops/call/${sourceCallBySid.get(event.detail.callSid)!.id}#t=${receiptMoment(event.detail)}`} />}
            </article>)}
          </div>
          {activityPages > 1 && <nav className="ops-record-pages" aria-label="Full Record pages">
            {activityPageNumber > 1 ? <Link href={`/ops/leads/${lead.id}?activityPage=${activityPageNumber - 1}#record`}>Newer</Link> : <span />}
            <span>Page {activityPageNumber} of {activityPages}</span>
            {activityPageNumber < activityPages ? <Link href={`/ops/leads/${lead.id}?activityPage=${activityPageNumber + 1}#record`}>Older</Link> : <span />}
          </nav>}
        </details>
      </section>
    </main>
  )
}
