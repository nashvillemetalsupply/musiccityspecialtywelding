"use server"

import { put } from "@vercel/blob"
import { createHash } from "node:crypto"
import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { Resend } from "resend"
import { getSql } from "@/lib/db"
import { brandedEmail, escapeHtml } from "@/lib/email-templates"
import { createLead, LEAD_STATUSES, recordLeadEvent, type LeadStatus } from "@/lib/leads"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import type { Operator } from "@/lib/operators"
import { getShopPhone } from "@/lib/shop-contact"
import { processEvent } from "@/lib/extract"
import { notifyAll } from "@/lib/notify"
import { recordEvent } from "@/lib/events"
import { createOrReuseQuoteGlassLink } from "@/lib/glass"
import { deliverGlassClipboard, glassUrl as customerGlassUrl } from "@/lib/glass-delivery"
import { redactCrewText } from "@/lib/visibility"
import { fileIdentityConflict, findOrCreatePerson, isReservedShopPhone, normalizeEmail, normalizePhone } from "@/lib/people"

async function sendCustomerEmail(options: {
  leadId: number
  personId: number | null
  operator: Operator
  to: string
  subject: string
  text: string
  headline: string
  bodyHtml: string
  idempotencyKey: string
}): Promise<boolean> {
  const intent = options.idempotencyKey.slice(0, 180)
  const sql = getSql()
  let eventId = await recordEvent({ kind: "email.out", actorType: "operator", actorId: options.operator.id, leadId: options.leadId, personId: options.personId, externalId: intent, body: options.text, detail: { subject: options.subject, to: options.to, deliveryStatus: "pending" } })
  if (!eventId) {
    const prior = (await sql`SELECT id FROM events WHERE kind = 'email.out' AND external_id = ${intent}::text LIMIT 1`) as { id: number }[]
    eventId = Number(prior[0]?.id) || null
    if (eventId) {
      const receipt = (await sql`
        SELECT kind FROM events
        WHERE kind = ANY(ARRAY['email.accepted','email.delivered']::text[])
          AND detail->>'sourceEventId' = ${String(eventId)}::text
        ORDER BY id DESC LIMIT 1`) as { kind: string }[]
      if (receipt[0]) return true
    }
  }
  if (!eventId) return false
  const recordDeliveryProblem = async (kind: "email.failed" | "email.unknown", message: string) => {
    const problemEventId = await recordEvent({
      kind,
      actorType: "system",
      leadId: options.leadId,
      personId: options.personId,
      externalId: `${kind === "email.failed" ? "failed" : "unknown"}:${intent}`,
      body: message,
      crewBody: kind === "email.failed" ? "Customer email did not send." : "Customer email delivery was not confirmed.",
      detail: { sourceEventId: eventId },
    })
    await notifyAll({
      priority: "digest",
      stock: "red",
      title: kind === "email.failed" ? "Customer email failed" : "Check customer email delivery",
      body: message,
      crewBody: kind === "email.failed" ? "Customer email did not send." : "Customer email delivery needs an owner check.",
      url: `/ops/leads/${options.leadId}#spike`,
      sourceEventId: problemEventId || eventId,
    })
  }
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.QUOTE_FROM_EMAIL
  if (!apiKey || !from) {
    await recordDeliveryProblem("email.failed", "Customer email is not configured.")
    return false
  }
  const resend = new Resend(apiKey)
  let providerData: { id: string } | null = null
  let providerErrorMessage = ""
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: brandedEmail({
        preheader: options.subject,
        headline: options.headline,
        bodyHtml: options.bodyHtml,
        ctaLabel: "Call the shop, open 24 hours",
        ctaUrl: getShopPhone().href,
      }),
    }, { idempotencyKey: intent })
    providerData = data
    providerErrorMessage = error?.message ?? ""
  } catch (error) {
    console.error("Customer email error:", error)
    const message = error instanceof Error ? error.message : "Email provider response was lost."
    await recordDeliveryProblem("email.unknown", message)
    return false
  }
  if (providerErrorMessage || !providerData?.id) {
    await recordDeliveryProblem("email.failed", providerErrorMessage || "Email provider did not accept the message.")
    return false
  }
  await recordEvent({ kind: "email.accepted", actorType: "system", leadId: options.leadId, personId: options.personId, externalId: providerData.id, body: "Email accepted by the delivery provider.", crewBody: "Email accepted by the delivery provider.", detail: { sourceEventId: eventId, providerEmailId: providerData.id } })
  return true
}

async function requireOperator(): Promise<Operator> {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Not signed in.")
  return operator
}

function actorId(operator: Operator) {
  return String(operator.id)
}

function requireOwner(operator: Operator) {
  if (operator.role !== "owner") throw new Error("Owner access is required for money and shop controls.")
}

function parseLeadId(value: FormDataEntryValue | null): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid lead id.")
  return id
}

function parseDollarsToCents(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").replace(/[$,\s]/g, "")
  if (!raw) return null
  const dollars = Number(raw)
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 10_000_000) {
    throw new Error("Invalid dollar amount.")
  }
  return Math.round(dollars * 100)
}

// Phone-in and walk-in leads enter the same pipeline as website leads. The
// first response is already made by definition, so speed-to-lead stays honest.
export async function createManualLeadRecord(
  formData: FormData,
  options: { deferExtraction?: boolean } = {},
) {
  const operator = await requireOperator()
  const firstName = String(formData.get("firstName") ?? "").trim().slice(0, 120)
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40)
  const service = String(formData.get("service") ?? "").trim().slice(0, 120)
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000)
  const referral = String(formData.get("referral") ?? "").trim().slice(0, 160)
  const intakeNote = [message, referral ? `Referral: ${referral}` : ""].filter(Boolean).join("\n").slice(0, 2000)
  const sourceChoice = String(formData.get("source") ?? "phone-in").trim().slice(0, 40)
  const intakeKey = String(formData.get("intakeKey") ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)

  if (!["phone-in", "walk-in", "referral-word-of-mouth", "repeat-customer"].includes(sourceChoice)) {
    throw new Error("Invalid source.")
  }
  if (!firstName) throw new Error(sourceChoice === "walk-in" ? "Add the walk-in customer or company name." : "Add the caller or company name.")
  if (!message) throw new Error("Add what the customer needs before saving the job.")

  const { id, publicId, eventId } = await createLead(
    {
      firstName: firstName || (phone ? "Caller" : "Walk-in"),
      lastName: "",
      phone,
      email: "",
      service: service || "Not Sure / Other",
      message: intakeNote,
      preferredContact: "Call",
      photoCount: 0,
      gclid: "",
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmTerm: "",
      utmContent: "",
      landingPage: "",
      referrer: "",
      ip: "",
      userAgent: "ops-dashboard",
      isTest: intakeNote.includes("[INTERNAL TEST]"),
    },
    {
      sourceOverride: sourceChoice,
      actor: actorId(operator),
      firstResponseNow: true,
      intakeKey: intakeKey ? `manual:${intakeKey}` : undefined,
    }
  )
  // A receipt Undo archives the accidental job without erasing its audit
  // trail. Saving the same intake again truthfully reopens that exact record.
  let extractionEventId = eventId
  if (!eventId && intakeKey) {
    const sql = getSql()
    const restored = (await sql`
      UPDATE leads SET
        first_name = ${firstName}::text,
        phone = ${phone}::text,
        service = ${service || "Not Sure / Other"}::text,
        message = ${intakeNote}::text,
        source = ${sourceChoice}::text,
        status = 'contacted', status_reason = '', lost_at = NULL,
        first_response_at = COALESCE(first_response_at, now()),
        first_response_channel = CASE WHEN first_response_channel = '' THEN 'phone' ELSE first_response_channel END,
        updated_at = now()
      WHERE id = ${id}::bigint
        AND intake_key = ${`manual:${intakeKey}`}::text
        AND status = 'lost' AND status_reason = 'Intake undone'
      RETURNING id`) as { id: number }[]
    if (restored[0]) {
      await recordLeadEvent(id, "intake_restored", actorId(operator), { source: sourceChoice })
      const rearmed = (await sql`
        UPDATE events SET processed_at = NULL, extraction_status = 'pending',
          extraction_next_attempt_at = ${options.deferExtraction ? new Date(Date.now() + 11 * 60 * 1000).toISOString() : null}::timestamptz,
          extraction_last_error = '',
          detail = COALESCE(detail, '{}'::jsonb) - 'intakeUndoDeferred'
        WHERE lead_id = ${id}::bigint
          AND detail->>'intakeUndoDeferred' = 'true'
        RETURNING id`) as { id: number }[]
      extractionEventId = Number(rearmed[0]?.id) || null
    }
  }
  if (options.deferExtraction) {
    await getSql()`
      UPDATE events SET extraction_next_attempt_at = now() + interval '11 minutes'
      WHERE lead_id = ${id}::bigint AND processed_at IS NULL
        AND kind = 'form.quote'`
  } else if (extractionEventId) {
    after(() => processEvent(extractionEventId!).catch((error) => console.error("Manual intake extraction failed:", error)))
  }
  revalidatePath("/ops")
  return { leadId: id, publicId, name: firstName, phone, need: message, intakeKey }
}

export async function createManualLead(formData: FormData) {
  const result = await createManualLeadRecord(formData)
  redirect(`/ops/leads/${result.leadId}`)
}

// A transient provider outage should be resolvable, not a permanent red flag.
export async function acknowledgeDeliveryFailure(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))

  const sql = getSql()
  const rows = (await sql`
    UPDATE leads SET email_delivery_status = 'resolved', updated_at = now()
    WHERE id = ${leadId}::bigint AND email_delivery_status = 'failed'
    RETURNING id`) as { id: number }[]
  if (rows.length) {
    await recordLeadEvent(leadId, "delivery_acknowledged", actorId(operator), null)
  }
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function updateLeadStatus(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const status = String(formData.get("status") ?? "") as LeadStatus
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500)

  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Invalid status.")
  }
  if (status === "won") throw new Error("Use Swipe to Finish to complete work.")
  if (operator.role !== "owner" && (status === "lost" || status === "spam")) {
    throw new Error("Only the owner can remove work from Active Jobs.")
  }
  if ((status === "lost" || status === "spam") && !reason) {
    throw new Error("A reason is required to mark a lead lost or spam.")
  }

  const sql = getSql()
  await sql`
    UPDATE leads SET
      status = ${status}::text,
      status_reason = ${reason}::text,
      first_response_at = CASE
        WHEN ${status}::text IN ('contacted', 'qualified', 'quoted', 'won')
          AND first_response_at IS NULL THEN now()
        ELSE first_response_at END,
      first_response_channel = CASE
        WHEN ${status}::text IN ('contacted', 'qualified', 'quoted', 'won')
          AND first_response_at IS NULL AND first_response_channel = ''
          THEN 'ops-dashboard'
        ELSE first_response_channel END,
      quoted_at = CASE WHEN ${status}::text = 'quoted' AND quoted_at IS NULL THEN now() ELSE quoted_at END,
      won_at = CASE WHEN ${status}::text = 'won' AND won_at IS NULL THEN now() ELSE won_at END,
      lost_at = CASE WHEN ${status}::text = 'lost' AND lost_at IS NULL THEN now() ELSE lost_at END,
      updated_at = now()
    WHERE id = ${leadId}::bigint`
  if (status === "spam") {
    await sql`
      UPDATE notifications n SET
        read_at = COALESCE(n.read_at, now()),
        delivery_status = CASE
          WHEN n.sent_at IS NULL AND n.delivery_status IN ('pending','sending','retry') THEN 'filed'
          ELSE n.delivery_status END,
        delivery_next_attempt_at = NULL,
        interrupt_reserved_at = NULL,
        delivery_error = CASE
          WHEN n.sent_at IS NULL THEN 'Suppressed after the work order was marked Not a job.'
          ELSE n.delivery_error END
      FROM events e
      WHERE e.id = n.source_event_id AND e.lead_id = ${leadId}::bigint`
  }
  await recordLeadEvent(leadId, "status_changed", actorId(operator), { status, reason: reason || null })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function markFirstResponse(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const channel = String(formData.get("channel") ?? "phone").trim().slice(0, 40) || "phone"

  const sql = getSql()
  await sql`
    UPDATE leads SET
      first_response_at = COALESCE(first_response_at, now()),
      first_response_channel = CASE
        WHEN first_response_channel = '' THEN ${channel}::text
        ELSE first_response_channel END,
      status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
      updated_at = now()
    WHERE id = ${leadId}::bigint`
  await recordLeadEvent(leadId, "first_response", actorId(operator), { channel })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function saveEstimate(formData: FormData) {
  const operator = await requireOperator()
  requireOwner(operator)
  const leadId = parseLeadId(formData.get("leadId"))
  const cents = parseDollarsToCents(formData.get("estimate"))
  const emailIt = String(formData.get("emailEstimate") ?? "") === "on"
  const sendGlass = String(formData.get("sendGlass") ?? "") === "on"

  const sql = getSql()
  await sql`
    UPDATE leads SET
      estimate_value_cents = ${cents}::bigint,
      quoted_at = CASE WHEN ${cents}::bigint IS NOT NULL AND quoted_at IS NULL THEN now() ELSE quoted_at END,
      status = CASE WHEN ${cents}::bigint IS NOT NULL AND status IN ('new', 'contacted', 'qualified')
        THEN 'quoted' ELSE status END,
      updated_at = now()
    WHERE id = ${leadId}::bigint`
  await recordLeadEvent(leadId, "estimate_saved", actorId(operator), { cents })

  const quoteRecipients = (emailIt || sendGlass) && cents !== null ? (await sql`
    SELECT first_name, email, phone, service, is_test, person_id FROM leads WHERE id = ${leadId}::bigint`) as {
    first_name: string
    email: string
    phone: string
    service: string
    is_test: boolean
    person_id: number | null
  }[] : []
  const quoteLead = quoteRecipients[0]
  let glassToken = ""
  let glassUrl = ""
  if (sendGlass && cents !== null && quoteLead) {
    glassToken = await createOrReuseQuoteGlassLink(leadId, operator.id)
    glassUrl = customerGlassUrl(glassToken)
    await recordEvent({ kind: "glass.created", actorType: "operator", actorId: operator.id, leadId, personId: quoteLead.person_id, body: "Customer Page created with the quote", crewBody: "Customer Page created with the quote" })
  }

  // Owner-controlled quote email — only when explicitly ticked.
  if (emailIt && cents !== null) {
    const rows = (await sql`
      SELECT first_name, email, service, is_test, person_id FROM leads WHERE id = ${leadId}::bigint`) as {
      first_name: string
      email: string
      service: string
      is_test: boolean
      person_id: number | null
    }[]
    const lead = rows[0]
    if (lead?.email && !lead.is_test) {
      const decimals = Math.abs(cents) % 100 === 0 ? 0 : 2
      const amount = (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: 2 })
      const sent = await sendCustomerEmail({
        leadId, personId: lead.person_id, operator,
        idempotencyKey: `quote-email:${leadId}:${cents}`,
        to: lead.email,
        subject: `Your estimate from Music City Specialty Welding: ${amount}`,
        text: [
          `Hey ${lead.first_name},`,
          ``,
          `Here's your estimate for the ${lead.service} work we talked about: ${amount}.`,
          ``,
          `That's for the scope as we understand it today. If anything about the job changes, the number can too, and we'll tell you before we touch anything.`,
          ``,
          `Ready to get it on the schedule, or got questions? Call us any time, day or night: ${getShopPhone().display}.`,
          glassUrl ? `Track this job: ${glassUrl}` : ``,
          ``,
          `Music City Specialty Welding · Lebanon, TN`,
        ].join("\n"),
        headline: `Your estimate: ${amount}`,
        bodyHtml: [
          `Here's your estimate for the <strong>${escapeHtml(lead.service)}</strong> work: <strong style="font-size:22px;">${amount}</strong>.`,
          `That's for the scope as we understand it today. If the job changes, the number can too, and we'll tell you before we touch anything.`,
          `Ready to put it on the schedule, or got questions? Call <strong>${escapeHtml(getShopPhone().display)}</strong> any time. We're open 24 hours.`,
          glassUrl ? `Your Customer Page: <a href="${escapeHtml(glassUrl)}">view job status</a>.` : "",
        ].join("<br /><br />"),
      })
      await recordLeadEvent(leadId, "estimate_emailed", actorId(operator), { cents, sent })
    }
  }

  if (sendGlass && glassToken && quoteLead && !quoteLead.is_test) {
    await deliverGlassClipboard({ token: glassToken, leadId, operatorId: operator.id })
  }

  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function saveOutcome(formData: FormData) {
  const operator = await requireOperator()
  requireOwner(operator)
  const leadId = parseLeadId(formData.get("leadId"))
  const revenueCents = parseDollarsToCents(formData.get("revenue"))
  const sendThanks = String(formData.get("sendThanks") ?? "") === "on"

  const sql = getSql()
  await sql`
    UPDATE leads SET
      revenue_cents = ${revenueCents}::bigint,
      updated_at = now()
    WHERE id = ${leadId}::bigint`
  await recordLeadEvent(leadId, "outcome_saved", actorId(operator), { revenueCents })

  // Owner-controlled thank-you only after the durable Finish Job receipt.
  if (sendThanks) {
    const rows = (await sql`
      SELECT first_name, email, service, is_test, person_id, completed_at FROM leads WHERE id = ${leadId}::bigint`) as {
      first_name: string
      email: string
      service: string
      is_test: boolean
      person_id: number | null
      completed_at: string | null
    }[]
    const lead = rows[0]
    if (lead?.completed_at && lead.email && !lead.is_test) {
      const sent = await sendCustomerEmail({
        leadId, personId: lead.person_id, operator,
        idempotencyKey: `thanks-email:${leadId}`,
        to: lead.email,
        subject: "Job's done. Thanks for trusting the shop",
        text: [
          `Hey ${lead.first_name},`,
          ``,
          `Your ${lead.service} work is wrapped up. Thanks for trusting a local shop with it.`,
          ``,
          `Keep our number: ${getShopPhone().display}. Metal breaks at the worst times, and we answer 24 hours a day.`,
          ``,
          `If anything about the work ever isn't right, call us first. We stand behind what we weld.`,
          ``,
          `Music City Specialty Welding · 533 W Baddour Pkwy, Lebanon, TN`,
        ].join("\n"),
        headline: `Job's done, ${escapeHtml(lead.first_name)}.`,
        bodyHtml: [
          `Your <strong>${escapeHtml(lead.service)}</strong> work is wrapped. Thanks for trusting a local shop with it.`,
          `Keep our number. Metal breaks at the worst times, and we answer 24 hours a day.`,
          `If anything about the work ever isn't right, call us first. <strong>We stand behind what we weld.</strong>`,
        ].join("<br /><br />"),
      })
      await recordLeadEvent(leadId, "thankyou_emailed", actorId(operator), { sent })
    }
  }

  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

// Invoices are MADE in QuickBooks; the board tracks and chases them.
// Recording the QB number + due date puts the unpaid invoice on the radar;
// DONE and PAID remain separate truths; saving revenue never closes the work.
export async function recordInvoice(formData: FormData) {
  const operator = await requireOperator()
  requireOwner(operator)
  const leadId = parseLeadId(formData.get("leadId"))
  const clear = String(formData.get("clear") ?? "") === "1"
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim().slice(0, 60)
  const invoiceTotalCents = parseDollarsToCents(formData.get("invoiceTotal"))
  const rawPayUrl = String(formData.get("invoicePayUrl") ?? "").trim().slice(0, 1000)
  const dueDays = Number(formData.get("dueDays") ?? 14)

  const sql = getSql()
  const current = (await sql`
    SELECT invoice_number, paid_at, paid_amount_cents
    FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as Array<{
    invoice_number: string
    paid_at: string | null
    paid_amount_cents: number | null
  }>
  if (!current[0]) throw new Error("Work order not found.")
  const invoiceChanged = clear || (
    current[0].invoice_number !== "" &&
    current[0].invoice_number.trim().toLowerCase() !== invoiceNumber.toLowerCase()
  )
  if (invoiceChanged && (current[0].paid_at || Number(current[0].paid_amount_cents ?? 0) > 0)) {
    throw new Error("This invoice has payment receipts. Relink those receipts before changing its number.")
  }
  let invoicePayUrl = ""
  if (rawPayUrl) {
    const parsed = new URL(rawPayUrl)
    if (parsed.protocol !== "https:" || !(parsed.hostname === "intuit.com" || parsed.hostname.endsWith(".intuit.com"))) throw new Error("Use the HTTPS QuickBooks/Intuit payment link.")
    invoicePayUrl = parsed.toString()
  }
  if (clear) {
    await sql`
      WITH cleared AS (
        UPDATE leads SET invoice_number = '', invoiced_at = NULL, invoice_due_at = NULL, invoice_pay_url = '', invoice_total_cents = NULL,
          updated_at = now()
        WHERE id = ${leadId}::bigint
        RETURNING id
      )
      UPDATE invoice_identities SET released_at = COALESCE(released_at, now())
      WHERE lead_id IN (SELECT id FROM cleared) AND released_at IS NULL`
    await recordLeadEvent(leadId, "invoice_cleared", actorId(operator), null)
  } else {
    if (!invoiceNumber) throw new Error("Invoice number is required.")
    if (![0, 7, 14, 30].includes(dueDays)) throw new Error("Invalid due terms.")
    const duplicates = (await sql`
      SELECT id FROM leads
      WHERE id <> ${leadId}::bigint
        AND invoice_number <> ''
        AND lower(btrim(invoice_number)) = lower(btrim(${invoiceNumber}::text))
      LIMIT 1`) as { id: number }[]
    if (duplicates[0]) throw new Error(`Invoice #${invoiceNumber} is already attached to another work order.`)
    const normalizedInvoice = invoiceNumber.trim().toLowerCase()
    const claimed = (await sql`
      INSERT INTO invoice_identities (normalized_number, invoice_number, lead_id)
      VALUES (${normalizedInvoice}::text, ${invoiceNumber}::text, ${leadId}::bigint)
      ON CONFLICT (normalized_number) WHERE released_at IS NULL DO UPDATE
        SET invoice_number = EXCLUDED.invoice_number
        WHERE invoice_identities.lead_id = EXCLUDED.lead_id
      RETURNING id, lead_id`) as { id: number; lead_id: number }[]
    if (!claimed[0]) {
      const existingClaim = (await sql`
        SELECT lead_id FROM invoice_identities
        WHERE normalized_number = ${normalizedInvoice}::text AND released_at IS NULL LIMIT 1`) as { lead_id: number }[]
      if (Number(existingClaim[0]?.lead_id) !== leadId) {
        throw new Error(`Invoice #${invoiceNumber} is already reserved by another work order.`)
      }
    }
    const claimId = Number(claimed[0]?.id)
    if (!claimId) throw new Error("Invoice ownership could not be recorded.")
    const dueAt = new Date(Date.now() + dueDays * 24 * 3600_000).toISOString()
    await sql`
      WITH changed AS (
        UPDATE leads SET
          invoice_number = ${invoiceNumber}::text,
          invoiced_at = COALESCE(invoiced_at, now()),
          invoice_due_at = ${dueAt}::timestamptz,
          invoice_pay_url = ${invoicePayUrl}::text,
          invoice_total_cents = ${invoiceTotalCents}::bigint,
          updated_at = now()
        WHERE id = ${leadId}::bigint
        RETURNING id
      )
      UPDATE invoice_identities SET released_at = now(), superseded_by = ${claimId}::bigint
      WHERE lead_id IN (SELECT id FROM changed) AND released_at IS NULL AND id <> ${claimId}::bigint`
    await recordLeadEvent(leadId, "invoice_recorded", actorId(operator), {
      invoiceNumber,
      dueDays,
      invoicePayUrl: invoicePayUrl || null,
      invoiceTotalCents,
    })
  }
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function resolveIdentityConflict(formData: FormData) {
  const operator = await requireOperator()
  requireOwner(operator)
  const conflictId = Number(formData.get("conflictId"))
  const personId = Number(formData.get("personId"))
  if (!Number.isInteger(conflictId) || conflictId <= 0 || !Number.isInteger(personId) || personId < 0) throw new Error("Invalid identity choice.")
  const sql = getSql()
  const resolution = personId === 0 ? "kept_separate" : `person:${personId}`
  const rows = (await sql`
    WITH target AS (
      SELECT c.id, c.lead_id, c.is_test
      FROM person_identity_conflicts c
      LEFT JOIN people p ON p.id = ${personId}::bigint
      WHERE c.id = ${conflictId}::bigint AND c.status = 'open' AND c.lead_id IS NOT NULL
        AND (${personId}::bigint = 0 OR (
          ${personId}::bigint = ANY(c.person_ids) AND p.id IS NOT NULL
          AND p.merged_into IS NULL AND p.is_test = c.is_test
        ))
    ), receipt AS (
      INSERT INTO events (kind, actor_type, actor_id, lead_id, external_id, body, detail)
      SELECT 'identity.conflict.resolved'::text, 'operator'::text, ${actorId(operator)}::text,
        t.lead_id, ${`identity-resolved:${conflictId}`}::text,
        ${personId === 0 ? "Customer identities kept separate" : "Customer identity selected"}::text,
        jsonb_build_object('conflictId', t.id, 'personId', ${personId}::bigint, 'resolution', ${resolution}::text)
      FROM target t
      ON CONFLICT DO NOTHING
      RETURNING lead_id
    ), resolved AS (
      UPDATE person_identity_conflicts c SET status = 'resolved', resolution = ${resolution}::text,
        resolved_at = now(), resolved_by = ${operator.id}::bigint
      FROM target t WHERE c.id = t.id AND EXISTS (SELECT 1 FROM receipt)
      RETURNING c.lead_id
    )
    UPDATE leads l SET person_id = CASE WHEN ${personId}::bigint = 0 THEN NULL ELSE ${personId}::bigint END,
      updated_at = now()
    WHERE l.id IN (SELECT lead_id FROM resolved)
    RETURNING l.id`) as { id: number }[]
  if (!rows[0]) throw new Error("That identity conflict is already resolved or no longer valid.")
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${rows[0].id}`)
}

export async function saveNotes(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 8000)

  const sql = getSql()
  if (operator.role === "owner") {
    await sql`UPDATE leads SET notes = ${notes}::text, updated_at = now() WHERE id = ${leadId}::bigint`
  } else {
    await sql`UPDATE leads SET crew_notes = ${notes}::text, updated_at = now() WHERE id = ${leadId}::bigint`
  }
  const eventId = await recordLeadEvent(leadId, "notes_saved", actorId(operator), { note: notes })
  if (eventId && operator.role === "crew") {
    await sql`UPDATE events SET crew_body = ${notes}::text WHERE id = ${eventId}::bigint`
  } else if (eventId && notes) {
    after(() => processEvent(eventId).catch((error) => console.error("Shop-note extraction failed:", error)))
  }
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function markReviewRequested(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const received = String(formData.get("received") ?? "") === "on"

  const sql = getSql()
  await sql`
    UPDATE leads SET
      review_requested_at = COALESCE(review_requested_at, now()),
      review_received = ${received}::boolean,
      updated_at = now()
    WHERE id = ${leadId}::bigint`
  await recordLeadEvent(leadId, "review_tracked", actorId(operator), { received })
  revalidatePath(`/ops/leads/${leadId}`)
}

// Quick interaction log: one entry per call/text/email touch. Also counts as
// the first response when none is recorded yet.
export async function logInteraction(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const channel = String(formData.get("channel") ?? "phone").trim().slice(0, 40) || "phone"
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000)

  const sql = getSql()
  await sql`
    UPDATE leads SET
      first_response_at = COALESCE(first_response_at, now()),
      first_response_channel = CASE
        WHEN first_response_channel = '' THEN ${channel}::text
        ELSE first_response_channel END,
      status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
      updated_at = now()
    WHERE id = ${leadId}::bigint`
  const eventId = await recordLeadEvent(leadId, "interaction", actorId(operator), { channel, note: note || null })
  if (eventId && operator.role === "crew") {
    await sql`UPDATE events SET crew_body = ${note || `${channel} contact logged`}::text WHERE id = ${eventId}::bigint`
  } else if (eventId && note) {
    after(() => processEvent(eventId).catch((error) => console.error("Interaction extraction failed:", error)))
  }
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

// A tiny contact jig, not a customer profile form: catch the number once and
// every tracked Call/Text/HANDLE IT path starts working from the shop line.
export async function captureLeadContact(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const rawPhone = String(formData.get("phone") ?? "").trim()
  const rawEmail = String(formData.get("email") ?? "").trim()
  const sql = getSql()
  const leads = (await sql`
    SELECT id, first_name, last_name, phone, email, person_id, is_test
    FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as Array<{
      id: number; first_name: string; last_name: string; phone: string; email: string; person_id: number | null; is_test: boolean
    }>
  const lead = leads[0]
  if (!lead) throw new Error("Job not found.")

  const submittedPhone = normalizePhone(rawPhone)
  if (rawPhone && (!submittedPhone || isReservedShopPhone(submittedPhone))) throw new Error("Enter the customer's real mobile number.")
  const submittedEmail = normalizeEmail(rawEmail)
  if (rawEmail && !submittedEmail) throw new Error("Enter a valid customer email.")
  const currentPhone = isReservedShopPhone(lead.phone) ? "" : normalizePhone(lead.phone)
  const nextPhone = submittedPhone || currentPhone
  const nextEmail = submittedEmail || normalizeEmail(lead.email)
  if (!nextPhone && !nextEmail) throw new Error("Catch a phone number or email.")

  const person = await findOrCreatePerson({
    phone: nextPhone,
    email: nextEmail,
    displayName: `${lead.first_name} ${lead.last_name}`.trim(),
    isTest: lead.is_test,
    leadId,
  })
  if (!person) throw new Error("Those details match two customers. Use the customer check to choose safely.")

  if (lead.person_id && Number(lead.person_id) !== Number(person.id)) {
    const current = (await sql`
      SELECT phones, emails FROM people WHERE id = ${lead.person_id}::bigint AND merged_into IS NULL LIMIT 1`) as Array<{ phones: string[]; emails: string[] }>
    if ((current[0]?.phones.length ?? 0) > 0 || (current[0]?.emails.length ?? 0) > 0) {
      await fileIdentityConflict({ phone: nextPhone, email: nextEmail, isTest: lead.is_test, personIds: [Number(lead.person_id), Number(person.id)], leadId })
      throw new Error("Those details belong to another customer. Use the customer check to choose safely.")
    }
  }

  const detail = { phone: nextPhone || null, email: nextEmail || null, personId: Number(person.id), operatorName: operator.name }
  await sql`
    WITH target AS (
      UPDATE leads SET
        person_id = ${Number(person.id)}::bigint,
        phone = ${nextPhone}::text,
        phone_is_placeholder = ${!nextPhone}::boolean,
        email = ${nextEmail}::text,
        updated_at = now()
      WHERE id = ${leadId}::bigint
      RETURNING id, person_id
    ), legacy_receipt AS (
      INSERT INTO lead_events (lead_id, actor, type, detail)
      SELECT id, ${actorId(operator)}::text, 'contact_captured'::text, ${JSON.stringify(detail)}::jsonb
      FROM target RETURNING id, created_at
    )
    INSERT INTO events (
      occurred_at, kind, actor_type, actor_id, lead_id, person_id,
      external_id, body, crew_body, detail
    )
    SELECT lr.created_at, 'contact.captured'::text, 'operator'::text,
      ${String(operator.id)}::text, t.id, t.person_id,
      ('lead_event:' || lr.id::text), 'Customer contact caught'::text,
      'Customer contact caught'::text, ${JSON.stringify({ ...detail, legacyType: "contact_captured" })}::jsonb
    FROM legacy_receipt lr CROSS JOIN target t`
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function setFollowUp(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const clear = String(formData.get("clear") ?? "") === "1"
  const quick = String(formData.get("quick") ?? "").trim()
  const when = String(formData.get("when") ?? "").trim()

  let followUp: string | null = null
  if (!clear) {
    if (quick) {
      const hours = { "4h": 4, "1d": 24, "3d": 72, "1w": 168 }[quick]
      if (!hours) throw new Error("Invalid quick follow-up option.")
      followUp = new Date(Date.now() + hours * 3600_000).toISOString()
    } else if (when) {
      const parsed = new Date(when)
      if (Number.isNaN(parsed.getTime())) throw new Error("Invalid follow-up date.")
      followUp = parsed.toISOString()
    } else {
      throw new Error("Pick a follow-up time.")
    }
  }

  const sql = getSql()
  await sql`
    UPDATE leads SET next_follow_up_at = ${followUp}::timestamptz, updated_at = now()
    WHERE id = ${leadId}::bigint`
  await recordLeadEvent(leadId, clear ? "follow_up_cleared" : "follow_up_set", actorId(operator), {
    at: followUp,
  })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

// Glove-first completion path. No money is required and no confirmation modal
// stands between the crew and a durable DONE event.
export async function markLeadComplete(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000)
  const noteSource = String(formData.get("noteSource") ?? "typed") === "voice" ? "voice" : "typed"
  const photo = formData.get("photo")
  const voiceNote = formData.get("voiceNote")
  if (photo instanceof File && photo.size > 0 && (photo.size > 12 * 1024 * 1024 || !photo.type.startsWith("image/"))) {
    throw new Error("Closeout photos must be an image under 12 MB.")
  }
  if (voiceNote instanceof File && voiceNote.size > 0 && (voiceNote.size > 8 * 1024 * 1024 || !voiceNote.type.startsWith("audio/"))) {
    throw new Error("Closeout voice notes must be audio under 8 MB.")
  }
  const sql = getSql()
  const before = (await sql`
    SELECT status, public_id, first_name, service, person_id, is_test,
      glass_caption_draft, won_at, assigned_operator_id
    FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as {
      status: LeadStatus
      public_id: string
      first_name: string
      service: string
      person_id: number | null
      is_test: boolean
      glass_caption_draft: string
      won_at: string | null
      assigned_operator_id: number | null
    }[]
  if (!before[0]) throw new Error("Job not found.")
  const deliveryCommitments = (await sql`
    SELECT id FROM commitments
    WHERE lead_id = ${leadId}::bigint
      AND status = 'open'
      AND direction = 'we_promised'
      AND summary ~* '(ready|finish|finished|complete|completed|done|weld|repair|install|deliver|delivery|pick[ -]?up)'
    ORDER BY created_at ASC`) as { id: number }[]
  const closedCommitmentIds = deliveryCommitments.map((item) => Number(item.id))
  const completionDetail = {
    note: note || null,
    noteSource,
    previousStatus: before[0].status,
    previousCaption: before[0].glass_caption_draft,
    previousWonAt: before[0].won_at,
    previousAssignedOperatorId: before[0].assigned_operator_id,
    operatorName: operator.name,
    closedCommitmentIds,
  }
  const completion = (await sql`
    WITH target AS (
      SELECT id, person_id FROM leads
      WHERE id = ${leadId}::bigint AND completed_at IS NULL
      FOR UPDATE
    ), legacy_receipt AS (
      INSERT INTO lead_events (lead_id, actor, type, detail)
      SELECT id, ${actorId(operator)}::text, 'completed'::text, ${JSON.stringify(completionDetail)}::jsonb
      FROM target RETURNING id, created_at
    ), immutable_receipt AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, person_id,
        external_id, body, detail
      )
      SELECT lr.created_at, 'job.completed'::text, 'operator'::text,
        ${String(operator.id)}::text, t.id, t.person_id,
        ('lead_event:' || lr.id::text), ${note}::text, ${JSON.stringify({ ...completionDetail, legacyType: "completed" })}::jsonb
      FROM legacy_receipt lr CROSS JOIN target t
      RETURNING id
    ), lead_update AS (
      UPDATE leads l SET
        completed_at = now(), status = 'won', won_at = COALESCE(l.won_at, now()),
        handed_off_at = NULL,
        assigned_operator_id = COALESCE(l.assigned_operator_id, ${operator.id}::bigint),
        updated_at = now()
      FROM target t CROSS JOIN immutable_receipt r
      WHERE l.id = t.id RETURNING l.id
    ), glass_update AS (
      UPDATE glass_links g SET expires_at = COALESCE(g.expires_at, now() + interval '90 days')
      FROM immutable_receipt r
      WHERE g.lead_id = ${leadId}::bigint AND g.revoked_at IS NULL RETURNING g.token_hash
    ), promise_update AS (
      UPDATE commitments c SET
        status = 'kept',
        status_changed_at = now(),
        status_source_event_id = r.id,
        confirmed_by = COALESCE(confirmed_by, ${operator.id}::bigint)
      FROM immutable_receipt r
      WHERE c.lead_id = ${leadId}::bigint
        AND c.id = ANY(${closedCommitmentIds}::bigint[]) AND c.status = 'open'
      RETURNING c.id
    ), wire_receipts AS (
      INSERT INTO notifications (
        operator_id, priority, stock, title, body, url, source_event_id,
        owner_only, dedupe_key
      )
      SELECT o.id, 'digest'::text, 'white'::text,
        ${`${operator.name || "The crew"} closed ${before[0].first_name}'s job`}::text,
        CASE WHEN o.role = 'owner'::text
          THEN ${note || `${before[0].service} marked finished.`}::text
          ELSE ${`${before[0].first_name}'s job marked finished.`}::text
        END,
        ${`/ops/leads/${leadId}#spike`}::text, r.id, false,
        ('completion:' || r.id::text)
      FROM immutable_receipt r CROSS JOIN operators o
      WHERE o.active = true AND ${!before[0].is_test}::boolean
      ON CONFLICT (operator_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
      RETURNING id
    )
    SELECT id FROM immutable_receipt`) as { id: number }[]
  const completionEventId = completion[0] ? Number(completion[0].id) : null
  if (!completionEventId) {
    revalidatePath(`/ops/leads/${leadId}`)
    return
  }
  if (note) {
    after(() => processEvent(completionEventId).catch((error) => console.error("DONE note extraction failed:", error)))
  }

  if (voiceNote instanceof File && voiceNote.size > 0) {
    try {
      const extension = voiceNote.type.includes("ogg") ? "ogg" : voiceNote.type.includes("mp4") ? "m4a" : "webm"
      const blob = await put(`leads/${before[0].public_id}/voice/${completionEventId}.${extension}`, voiceNote, { access: "private", contentType: voiceNote.type, allowOverwrite: true })
      await sql`
        UPDATE events SET detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ voicePath: blob.pathname, voiceContentType: voiceNote.type })}::jsonb
        WHERE id = ${completionEventId}::bigint`
    } catch (error) {
      console.error("Closeout voice-note storage failed after durable DONE:", error)
    }
  }

  if (photo instanceof File && photo.size > 0) {
    try {
      const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "closeout.jpg"
      const blob = await put(`leads/${before[0].public_id}/closeout/${completionEventId}-${safeName}`, photo, {
        access: "private",
        contentType: photo.type,
        allowOverwrite: true,
      })
      const photoRecord = {
        pathname: blob.pathname,
        contentType: photo.type,
        size: photo.size,
        name: photo.name,
        // Raw crew closeout speech is never customer copy. Extraction creates
        // a separate DLP-checked caption revision after the durable DONE row.
        shared: false,
        caption: "",
        sensitivity: "photo",
        sourceCompletionEventId: completionEventId,
      }
      await sql`
        UPDATE leads SET
          photos = COALESCE(photos, '[]'::jsonb) || ${JSON.stringify([photoRecord])}::jsonb,
          photo_count = photo_count + 1,
          updated_at = now()
        WHERE id = ${leadId}::bigint`
      await recordLeadEvent(leadId, "photo_added", actorId(operator), {
        pathname: blob.pathname,
        closeout: true,
        shared: photoRecord.shared,
        sourceCompletionEventId: completionEventId,
      })
    } catch (error) {
      console.error("Closeout photo failed after durable DONE:", error)
      if (!before[0].is_test) {
        await notifyAll({ priority: "digest", stock: "red", title: `${before[0].first_name} is DONE — photo needs another try`, body: "The closeout was saved. The photo was not.", url: `/ops/leads/${leadId}`, sourceEventId: completionEventId })
      }
    }
  }
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

// Optional closeout narration and photo are a resumable addendum. DONE itself
// has already landed before this action starts.
export async function addLeadCompletionNote(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000)
  const noteSource = String(formData.get("noteSource") ?? "typed") === "voice" ? "voice" : "typed"
  const photo = formData.get("photo")
  const voiceNote = formData.get("voiceNote")
  const voiceIntentId = String(formData.get("voiceIntentId") ?? "").trim()
  const hasVoiceIntent = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(voiceIntentId)
  if (voiceIntentId && !hasVoiceIntent) throw new Error("That saved voice note is not valid.")
  if (!note && !(photo instanceof File && photo.size > 0) && !(voiceNote instanceof File && voiceNote.size > 0) && !hasVoiceIntent) return
  if (photo instanceof File && photo.size > 0 && (photo.size > 12 * 1024 * 1024 || !photo.type.startsWith("image/"))) throw new Error("Closeout photos must be an image under 12 MB.")
  if (voiceNote instanceof File && voiceNote.size > 0 && (voiceNote.size > 8 * 1024 * 1024 || !voiceNote.type.startsWith("audio/"))) throw new Error("Closeout voice notes must be audio under 8 MB.")
  const sql = getSql()
  const rows = (await sql`
    SELECT l.public_id, l.first_name, l.person_id, l.is_test, completion.id AS completion_event_id
    FROM leads l JOIN LATERAL (
      SELECT id FROM events WHERE lead_id = l.id AND kind = 'job.completed'
      ORDER BY occurred_at DESC, id DESC LIMIT 1
    ) completion ON true
    WHERE l.id = ${leadId}::bigint AND l.completed_at IS NOT NULL LIMIT 1`) as Array<{
      public_id: string; first_name: string; person_id: number | null; is_test: boolean; completion_event_id: number
    }>
  const lead = rows[0]
  if (!lead) throw new Error("Stamp DONE before adding the closeout note.")
  const recoveredVoice = hasVoiceIntent ? (await sql`
    SELECT blob_path, content_type FROM voice_transcription_intents
    WHERE id = ${voiceIntentId}::text AND operator_id = ${operator.id}::bigint
      AND lead_id = ${leadId}::bigint AND recovery_key = ${`done:${leadId}`}::text
      AND status = 'completed' AND blob_path <> '' LIMIT 1`) as Array<{ blob_path: string; content_type: string }> : []
  if (hasVoiceIntent && !recoveredVoice[0]) throw new Error("That saved voice note does not belong to this closeout.")
  const signature = createHash("sha256").update(JSON.stringify({ note, noteSource, voiceIntentId, voiceSize: voiceNote instanceof File ? voiceNote.size : 0, photoName: photo instanceof File ? photo.name : "", photoSize: photo instanceof File ? photo.size : 0 })).digest("hex")
  const externalId = `completion-addendum:${lead.completion_event_id}:${signature}`
  let noteEventId = await recordEvent({ kind: noteSource === "voice" ? "note.voice" : "note.text", actorType: "operator", actorId: operator.id, leadId, personId: lead.person_id, externalId, body: note || "Closeout media filed", crewBody: redactCrewText(note || "Closeout media filed"), detail: { noteSource, completionEventId: lead.completion_event_id, operatorName: operator.name, voiceIntentId: hasVoiceIntent ? voiceIntentId : null } })
  if (!noteEventId) {
    const prior = (await sql`SELECT id FROM events WHERE kind = ${noteSource === "voice" ? "note.voice" : "note.text"}::text AND external_id = ${externalId}::text LIMIT 1`) as { id: number }[]
    noteEventId = Number(prior[0]?.id) || null
  }
  if (!noteEventId) throw new Error("The closeout addendum could not be filed.")
  if (voiceNote instanceof File && voiceNote.size > 0) {
    const existing = (await sql`SELECT detail->>'voicePath' AS path FROM events WHERE id = ${noteEventId}::bigint LIMIT 1`) as { path: string | null }[]
    if (!existing[0]?.path) {
      const extension = voiceNote.type.includes("ogg") ? "ogg" : voiceNote.type.includes("mp4") ? "m4a" : "webm"
      const blob = await put(`leads/${lead.public_id}/voice/${noteEventId}.${extension}`, voiceNote, { access: "private", contentType: voiceNote.type, allowOverwrite: true })
      await sql`UPDATE events SET detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ voicePath: blob.pathname, voiceContentType: voiceNote.type })}::jsonb WHERE id = ${noteEventId}::bigint`
    }
  } else if (recoveredVoice[0]) {
    await sql`UPDATE events SET detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ voicePath: recoveredVoice[0].blob_path, voiceContentType: recoveredVoice[0].content_type, recoveredVoiceIntentId: voiceIntentId })}::jsonb WHERE id = ${noteEventId}::bigint`
  }
  if (photo instanceof File && photo.size > 0) {
    const exists = (await sql`
      SELECT EXISTS(SELECT 1 FROM leads l, jsonb_array_elements(COALESCE(l.photos, '[]'::jsonb)) p
        WHERE l.id = ${leadId}::bigint AND p->>'sourceAddendumEventId' = ${String(noteEventId)}::text) AS found`) as { found: boolean }[]
    if (!exists[0]?.found) {
      const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "closeout.jpg"
      const blob = await put(`leads/${lead.public_id}/closeout/${noteEventId}-${safeName}`, photo, { access: "private", contentType: photo.type, allowOverwrite: true })
      const photoRecord = { pathname: blob.pathname, contentType: photo.type, size: photo.size, name: photo.name, sensitivity: "photo", shared: false, caption: "", sourceCompletionEventId: lead.completion_event_id, sourceAddendumEventId: noteEventId }
      await sql`UPDATE leads SET photos = COALESCE(photos, '[]'::jsonb) || ${JSON.stringify([photoRecord])}::jsonb, photo_count = photo_count + 1, updated_at = now() WHERE id = ${leadId}::bigint`
    }
  }
  after(() => processEvent(noteEventId!).catch((error) => console.error("DONE addendum extraction failed:", error)))
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

// Job ownership is operational provenance, never a worker score. Only the
// owner can route work; no page aggregates assignments by crew member.
export async function assignLeadOperator(formData: FormData) {
  const operator = await requireOperator()
  requireOwner(operator)
  const leadId = parseLeadId(formData.get("leadId"))
  const rawAssignee = String(formData.get("assigneeId") ?? "").trim()
  const assigneeId = rawAssignee ? Number(rawAssignee) : null
  if (assigneeId !== null && (!Number.isInteger(assigneeId) || assigneeId <= 0)) {
    throw new Error("Invalid crew member.")
  }

  const sql = getSql()
  let assigneeName = "Unassigned"
  if (assigneeId !== null) {
    const rows = (await sql`
      SELECT name FROM operators
      WHERE id = ${assigneeId}::bigint AND active = true
      LIMIT 1`) as { name: string }[]
    if (!rows[0]) throw new Error("Crew member is not active.")
    assigneeName = rows[0].name
  }

  await sql`
    UPDATE leads SET assigned_operator_id = ${assigneeId}::bigint, updated_at = now()
    WHERE id = ${leadId}::bigint`
  await recordLeadEvent(leadId, "assigned", actorId(operator), {
    operatorId: assigneeId,
    operatorName: assigneeName,
  })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function setJobTravelerStage(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const stage = String(formData.get("stage") ?? "")
  if (stage !== "scheduled" && stage !== "work_started") throw new Error("Unknown job status.")
  const sql = getSql()
  if (stage === "scheduled") {
    await sql`
      UPDATE leads SET scheduled_at = COALESCE(scheduled_at, now()), updated_at = now()
      WHERE id = ${leadId}::bigint`
  } else {
    await sql`
      UPDATE leads SET
        scheduled_at = COALESCE(scheduled_at, now()),
        work_started_at = COALESCE(work_started_at, now()),
        updated_at = now()
      WHERE id = ${leadId}::bigint`
  }
  await recordLeadEvent(leadId, stage === "scheduled" ? "scheduled" : "work_started", actorId(operator), {
    station: stage,
    operatorName: operator.name,
  })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function setPhotoShared(formData: FormData) {
  const operator = await requireOperator()
  requireOwner(operator)
  const leadId = parseLeadId(formData.get("leadId"))
  const pathname = String(formData.get("pathname") ?? "").slice(0, 600)
  const caption = String(formData.get("caption") ?? "").trim().slice(0, 300)
  const shared = String(formData.get("shared") ?? "") === "1"
  if (!pathname || pathname.includes("..")) throw new Error("Photo not found.")
  const sql = getSql()
  const rows = (await sql`SELECT photos, glass_caption_approved_at FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as { photos: Array<Record<string, unknown>>; glass_caption_approved_at: string | null }[]
  const photos = Array.isArray(rows[0]?.photos) ? rows[0].photos : []
  const wasShared = photos.some((photo) => photo.pathname === pathname && photo.shared === true)
  const matched = photos.some((photo) => photo.pathname === pathname)
  if (!matched) throw new Error("Photo not found.")
  const updated = photos.map((photo) => photo.pathname === pathname ? { ...photo, shared, caption: caption || photo.caption || "" } : photo)
  await sql`
    UPDATE leads SET
      photos = ${JSON.stringify(updated)}::jsonb,
      glass_caption_approved_at = CASE
        WHEN ${shared && !wasShared}::boolean THEN COALESCE(glass_caption_approved_at, now())
        ELSE glass_caption_approved_at
      END,
      updated_at = now()
    WHERE id = ${leadId}::bigint`
  if (shared && !wasShared) {
    const approvedCaption = String(updated.find((photo) => photo.pathname === pathname)?.caption ?? "")
    const captionHash = createHash("sha256").update(approvedCaption).digest("hex")
    const prior = (await sql`
      SELECT 1 FROM glass_photo_approvals
      WHERE lead_id = ${leadId}::bigint AND pathname = ${pathname}::text
      LIMIT 1`) as { "?column?": number }[]
    const approval = (await sql`
      INSERT INTO glass_photo_approvals (lead_id, pathname, caption_hash, approved_by)
      VALUES (${leadId}::bigint, ${pathname}::text, ${captionHash}::text, ${operator.id}::bigint)
      ON CONFLICT (lead_id, pathname, caption_hash) DO NOTHING RETURNING id`) as { id: number }[]
    if (approval[0] && !prior[0]) await sql`
      UPDATE operators SET glass_clean_approvals = glass_clean_approvals + 1
      WHERE id = ${operator.id}::bigint`
  }
  await recordLeadEvent(leadId, shared ? "glass_photo_shared" : "glass_photo_hidden", actorId(operator), { pathname, caption })
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function undoLeadComplete(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const sql = getSql()
  const rows = (await sql`
    SELECT e.id, e.detail, l.first_name, l.is_test FROM events e
    JOIN leads l ON l.id = e.lead_id
    WHERE e.lead_id = ${leadId}::bigint
      AND e.kind = 'job.completed'
      AND e.occurred_at >= now() - interval '10 seconds'
      AND l.completed_at IS NOT NULL
    ORDER BY e.occurred_at DESC LIMIT 1`) as { id: number; detail: Record<string, unknown> | null; first_name: string; is_test: boolean }[]
  const previous = String(rows[0]?.detail?.previousStatus ?? "quoted") as LeadStatus
  if (!rows[0] || !(LEAD_STATUSES as readonly string[]).includes(previous)) {
    revalidatePath(`/ops/leads/${leadId}`)
    return
  }
  const undoDetail = { restoredStatus: previous, completionEventId: rows[0].id }
  await sql`
    WITH target AS (
      SELECT id, person_id FROM leads
      WHERE id = ${leadId}::bigint AND completed_at IS NOT NULL
      FOR UPDATE
    ), legacy_receipt AS (
      INSERT INTO lead_events (lead_id, actor, type, detail)
      SELECT id, ${actorId(operator)}::text, 'completion_undone'::text, ${JSON.stringify(undoDetail)}::jsonb
      FROM target RETURNING id, created_at
    ), immutable_receipt AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, person_id,
        external_id, body, detail
      )
      SELECT lr.created_at, 'job.completion-undone'::text, 'operator'::text,
        ${String(operator.id)}::text, t.id, t.person_id,
        ('lead_event:' || lr.id::text), 'Job finish undone'::text,
        ${JSON.stringify({ ...undoDetail, legacyType: "completion_undone" })}::jsonb
      FROM legacy_receipt lr CROSS JOIN target t
      RETURNING id
    ), lead_update AS (
      UPDATE leads l SET
        completed_at = NULL,
        handed_off_at = NULL,
        status = ${previous}::text,
        won_at = ${typeof rows[0].detail?.previousWonAt === "string" ? rows[0].detail.previousWonAt : null}::timestamptz,
        assigned_operator_id = ${typeof rows[0].detail?.previousAssignedOperatorId === "number" ? rows[0].detail.previousAssignedOperatorId : null}::bigint,
        glass_caption_draft = ${typeof rows[0].detail?.previousCaption === "string" ? rows[0].detail.previousCaption : ""}::text,
        photos = COALESCE((
          SELECT jsonb_agg(
            CASE WHEN photo->>'sourceCompletionEventId' = ${String(rows[0].id)}::text
              THEN photo || '{"shared":false,"completionUndone":true}'::jsonb
              ELSE photo END
          ) FROM jsonb_array_elements(COALESCE(l.photos, '[]'::jsonb)) photo
        ), '[]'::jsonb),
        updated_at = now()
      FROM target t CROSS JOIN immutable_receipt r
      WHERE l.id = t.id RETURNING l.id
    ), glass_update AS (
      UPDATE glass_links g SET expires_at = NULL
      FROM lead_update u
      WHERE g.lead_id = u.id AND g.revoked_at IS NULL
        AND g.expires_at > now() + interval '89 days'
      RETURNING g.token_hash
    ), kept_promises AS (
      UPDATE commitments c SET
        status = 'open', status_changed_at = now(), status_source_event_id = r.id
      FROM immutable_receipt r
      WHERE c.lead_id = ${leadId}::bigint AND c.status = 'kept'
        AND c.status_source_event_id = ${rows[0].id}::bigint
      RETURNING c.id
    ), completion_promises AS (
      UPDATE commitments c SET
        status = 'canceled', status_changed_at = now(), status_source_event_id = r.id
      FROM immutable_receipt r
      WHERE c.lead_id = ${leadId}::bigint AND c.source_event_id = ${rows[0].id}::bigint
        AND c.status = 'open'
      RETURNING c.id
    ), old_wire AS (
      UPDATE notifications n SET
            title = 'Job finish undone', body = 'The job is open again.',
        stock = 'manila', coalesced = true
      FROM immutable_receipt r
      WHERE n.source_event_id = ${rows[0].id}::bigint
      RETURNING n.id
    ), undo_wire AS (
      INSERT INTO notifications (
        operator_id, priority, stock, title, body, url, source_event_id,
        owner_only, dedupe_key
      )
      SELECT o.id, 'digest'::text, 'manila'::text,
        ${`${rows[0].first_name || "Job"} is active again`}::text,
        ${`${operator.name || "Crew"} undid the finish.`}::text,
        ${`/ops/leads/${leadId}`}::text, r.id, false,
        ('completion-undo:' || r.id::text)
      FROM immutable_receipt r CROSS JOIN operators o
      WHERE o.active = true AND ${!rows[0].is_test}::boolean
      ON CONFLICT (operator_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
      RETURNING id
    )
    SELECT id FROM immutable_receipt`
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

// Test cleanup is a tombstone, not a physical delete: immutable events keep
// their foreign-key receipt and normal views already exclude is_test rows.
export async function deleteTestLead(formData: FormData) {
  const operator = await requireOperator()
  requireOwner(operator)
  const leadId = parseLeadId(formData.get("leadId"))

  const sql = getSql()
  const rows = (await sql`
    UPDATE leads SET status = 'spam', status_reason = 'archived internal test', updated_at = now()
    WHERE id = ${leadId}::bigint AND is_test = true
    RETURNING id`) as { id: number }[]
  if (!rows.length) throw new Error("Only internal test leads can be archived.")
  await recordLeadEvent(leadId, "test_archived", actorId(operator), { reason: "QA cleanup" })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}
