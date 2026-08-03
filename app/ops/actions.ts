"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { Resend } from "resend"
import { getSql } from "@/lib/db"
import { brandedEmail, escapeHtml } from "@/lib/email-templates"
import { createLead, LEAD_STATUSES, recordLeadEvent, type LeadStatus } from "@/lib/leads"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

async function sendCustomerEmail(options: {
  to: string
  subject: string
  text: string
  headline: string
  bodyHtml: string
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.QUOTE_FROM_EMAIL
  if (!apiKey || !from) return false
  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: brandedEmail({
        preheader: options.subject,
        headline: options.headline,
        bodyHtml: options.bodyHtml,
        ctaLabel: "Call the shop — open 24 hours",
        ctaUrl: "tel:6158104910",
      }),
    })
    return !error
  } catch (error) {
    console.error("Customer email error:", error)
    return false
  }
}

async function requireOperator(): Promise<string> {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Not signed in.")
  return operator
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
export async function createManualLead(formData: FormData) {
  const operator = await requireOperator()
  const firstName = String(formData.get("firstName") ?? "").trim().slice(0, 120)
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40)
  const service = String(formData.get("service") ?? "").trim().slice(0, 120)
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000)
  const sourceChoice = String(formData.get("source") ?? "phone-in").trim().slice(0, 40)

  if (!firstName || !phone) throw new Error("Name and phone are required.")
  if (!["phone-in", "walk-in", "referral-word-of-mouth", "repeat-customer"].includes(sourceChoice)) {
    throw new Error("Invalid source.")
  }

  const { id } = await createLead(
    {
      firstName,
      lastName: "",
      phone,
      email: "",
      service: service || "Not Sure / Other",
      message,
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
      isTest: message.includes("[INTERNAL TEST]"),
    },
    { sourceOverride: sourceChoice, actor: operator, firstResponseNow: true }
  )
  revalidatePath("/ops")
  redirect(`/ops/leads/${id}`)
}

// A transient provider outage should be resolvable, not a permanent red flag.
export async function acknowledgeDeliveryFailure(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))

  const sql = getSql()
  const rows = (await sql`
    UPDATE leads SET email_delivery_status = 'resolved', updated_at = now()
    WHERE id = ${leadId} AND email_delivery_status = 'failed'
    RETURNING id`) as { id: number }[]
  if (rows.length) {
    await recordLeadEvent(leadId, "delivery_acknowledged", operator, null)
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
  if ((status === "lost" || status === "spam") && !reason) {
    throw new Error("A reason is required to mark a lead lost or spam.")
  }

  const sql = getSql()
  await sql`
    UPDATE leads SET
      status = ${status},
      status_reason = ${reason},
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
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "status_changed", operator, { status, reason: reason || null })
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
        WHEN first_response_channel = '' THEN ${channel}
        ELSE first_response_channel END,
      status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
      updated_at = now()
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "first_response", operator, { channel })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function saveEstimate(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const cents = parseDollarsToCents(formData.get("estimate"))
  const emailIt = String(formData.get("emailEstimate") ?? "") === "on"

  const sql = getSql()
  await sql`
    UPDATE leads SET
      estimate_value_cents = ${cents}::bigint,
      quoted_at = CASE WHEN ${cents}::bigint IS NOT NULL AND quoted_at IS NULL THEN now() ELSE quoted_at END,
      status = CASE WHEN ${cents}::bigint IS NOT NULL AND status IN ('new', 'contacted', 'qualified')
        THEN 'quoted' ELSE status END,
      first_response_at = CASE WHEN ${cents}::bigint IS NOT NULL
        THEN COALESCE(first_response_at, now()) ELSE first_response_at END,
      first_response_channel = CASE WHEN ${cents}::bigint IS NOT NULL AND first_response_channel = ''
        THEN 'ops-dashboard' ELSE first_response_channel END,
      updated_at = now()
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "estimate_saved", operator, { cents })

  // Owner-controlled quote email — only when explicitly ticked.
  if (emailIt && cents !== null) {
    const rows = (await sql`
      SELECT first_name, email, service, is_test FROM leads WHERE id = ${leadId}`) as {
      first_name: string
      email: string
      service: string
      is_test: boolean
    }[]
    const lead = rows[0]
    if (lead?.email && !lead.is_test) {
      const amount = `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
      const sent = await sendCustomerEmail({
        to: lead.email,
        subject: `Your estimate from Music City Specialty Welding: ${amount}`,
        text: [
          `Hey ${lead.first_name},`,
          ``,
          `Here's your estimate for the ${lead.service} work we talked about: ${amount}.`,
          ``,
          `That's for the scope as we understand it today — if anything about the job changes, the number can too, and we'll tell you before we touch anything.`,
          ``,
          `Ready to get it on the schedule, or got questions? Call us any time, day or night: (615) 810-4910.`,
          ``,
          `Music City Specialty Welding · Lebanon, TN`,
        ].join("\n"),
        headline: `Your estimate: ${amount}`,
        bodyHtml: [
          `Here's your estimate for the <strong>${escapeHtml(lead.service)}</strong> work: <strong style="font-size:22px;">${amount}</strong>.`,
          `That's for the scope as we understand it today — if the job changes, the number can too, and we'll tell you before we touch anything.`,
          `Ready to put it on the schedule, or got questions? Call any time — <strong>(615)&nbsp;810-4910</strong>, open 24 hours.`,
        ].join("<br /><br />"),
      })
      await recordLeadEvent(leadId, "estimate_emailed", operator, { cents, sent })
    }
  }

  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function saveOutcome(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const revenueCents = parseDollarsToCents(formData.get("revenue"))
  const completed = String(formData.get("completed") ?? "") === "on"
  const sendThanks = String(formData.get("sendThanks") ?? "") === "on"

  const sql = getSql()
  await sql`
    UPDATE leads SET
      revenue_cents = ${revenueCents}::bigint,
      status = CASE WHEN ${revenueCents}::bigint IS NOT NULL THEN 'won' ELSE status END,
      won_at = CASE WHEN ${revenueCents}::bigint IS NOT NULL AND won_at IS NULL THEN now() ELSE won_at END,
      completed_at = CASE WHEN ${completed}::boolean AND completed_at IS NULL THEN now() ELSE completed_at END,
      first_response_at = CASE WHEN ${revenueCents}::bigint IS NOT NULL
        THEN COALESCE(first_response_at, now()) ELSE first_response_at END,
      first_response_channel = CASE WHEN ${revenueCents}::bigint IS NOT NULL AND first_response_channel = ''
        THEN 'ops-dashboard' ELSE first_response_channel END,
      updated_at = now()
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "outcome_saved", operator, { revenueCents, completed })

  // Owner-controlled thank-you when the job wraps.
  if (sendThanks && completed) {
    const rows = (await sql`
      SELECT first_name, email, service, is_test FROM leads WHERE id = ${leadId}`) as {
      first_name: string
      email: string
      service: string
      is_test: boolean
    }[]
    const lead = rows[0]
    if (lead?.email && !lead.is_test) {
      const sent = await sendCustomerEmail({
        to: lead.email,
        subject: "Job's done — thanks for trusting the shop",
        text: [
          `Hey ${lead.first_name},`,
          ``,
          `Your ${lead.service} work is wrapped up. Thanks for trusting a local shop with it.`,
          ``,
          `Keep our number — (615) 810-4910. Metal breaks at the worst times, and we answer 24 hours a day.`,
          ``,
          `If anything about the work ever isn't right, call us first. We stand behind what we weld.`,
          ``,
          `Music City Specialty Welding · 533 W Baddour Pkwy, Lebanon, TN`,
        ].join("\n"),
        headline: `Job's done, ${escapeHtml(lead.first_name)}.`,
        bodyHtml: [
          `Your <strong>${escapeHtml(lead.service)}</strong> work is wrapped. Thanks for trusting a local shop with it.`,
          `Keep our number — metal breaks at the worst times, and we answer 24 hours a day.`,
          `If anything about the work ever isn't right, call us first. <strong>We stand behind what we weld.</strong>`,
        ].join("<br /><br />"),
      })
      await recordLeadEvent(leadId, "thankyou_emailed", operator, { sent })
    }
  }

  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function saveNotes(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 8000)

  const sql = getSql()
  await sql`UPDATE leads SET notes = ${notes}, updated_at = now() WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "notes_saved", operator, null)
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
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "review_tracked", operator, { received })
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
        WHEN first_response_channel = '' THEN ${channel}
        ELSE first_response_channel END,
      status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
      updated_at = now()
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, "interaction", operator, { channel, note: note || null })
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
    WHERE id = ${leadId}`
  await recordLeadEvent(leadId, clear ? "follow_up_cleared" : "follow_up_set", operator, {
    at: followUp,
  })
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}

// Deletes are limited to internal test records so real customer history stays immutable.
export async function deleteTestLead(formData: FormData) {
  const operator = await requireOperator()
  const leadId = parseLeadId(formData.get("leadId"))

  const sql = getSql()
  const rows = (await sql`
    DELETE FROM leads WHERE id = ${leadId} AND is_test = true RETURNING id`) as { id: number }[]
  if (!rows.length) throw new Error("Only internal test leads can be deleted.")
  console.log(`Test lead ${leadId} deleted by ${operator}`)
  revalidatePath("/ops")
}
