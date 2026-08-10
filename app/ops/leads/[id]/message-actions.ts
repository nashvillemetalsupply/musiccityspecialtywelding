"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { Resend } from "resend"
import { getLead } from "@/lib/ops-data"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { sendSmsPersisted } from "@/lib/messages"
import { recordEvent } from "@/lib/events"
import { processEvent } from "@/lib/extract"
import { notify } from "@/lib/notify"
import { getSql } from "@/lib/db"
import { operatorSignature } from "@/lib/operators"
import { isDefinitiveTwilioError } from "@/lib/twilio"
import { getMessagingConsentState, recordMessagingConsent } from "@/lib/messaging-consent"

export async function recordVerbalTextConsent(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Sign in required.")
  const leadId = Number(formData.get("leadId"))
  if (!Number.isInteger(leadId) || leadId <= 0) throw new Error("Job not found.")
  const lead = await getLead(leadId, operator.role)
  if (!lead || lead.phone_is_placeholder || !lead.phone) throw new Error("Add a valid customer mobile number first.")
  if (lead.is_test) throw new Error("Internal test jobs never create customer messaging consent.")
  const current = await getMessagingConsentState(lead.phone)
  if (current === "revoked") throw new Error("This customer opted out. Only a new START message can restore texting.")
  if (current !== "granted") await recordMessagingConsent({
    phone: lead.phone,
    source: "verbal-operator",
    externalId: `verbal:${leadId}:${operator.id}:${randomUUID()}`,
    leadId,
    personId: lead.person_id,
    operatorId: operator.id,
    provenance: { statement: "Customer verbally agreed to receive job-related texts.", recordedIn: "work-order" },
  })
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function sendLeadReply(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Sign in required.")
  const leadId = Number(formData.get("leadId"))
  const body = String(formData.get("body") ?? "").trim().slice(0, 1600)
  const channel = formData.get("channel") === "email" ? "email" : "text"
  const targetPersonId = Number(formData.get("targetPersonId"))
  const intentKey = String(formData.get("intentKey") ?? "").trim()
  if (!Number.isInteger(leadId) || leadId <= 0 || !body) throw new Error("Reply and job are required.")
  if (!/^[a-z0-9-]{16,80}$/i.test(intentKey)) throw new Error("Reload the work order before sending this reply.")
  const lead = await getLead(leadId, operator.role)
  if (!lead) throw new Error("Job not found.")
  if (lead.is_test) throw new Error("Internal test jobs never send customer messages.")

  let replyPhone = lead.phone
  let replyEmail = lead.email
  let replyPersonId = lead.person_id
  if (Number.isInteger(targetPersonId) && targetPersonId > 0) {
    const sql = getSql()
    const targets = (await sql`
      SELECT target.id, target.phones[1] AS phone, target.emails[1] AS email
      FROM leads l
      LEFT JOIN people primary_person ON primary_person.id = l.person_id
      JOIN people target ON target.id = ${targetPersonId}::bigint
      WHERE l.id = ${leadId}::bigint AND target.merged_into IS NULL
        AND target.is_test = l.is_test
        AND (target.id = l.person_id OR (primary_person.account_key <> '' AND target.account_key = primary_person.account_key))
      LIMIT 1`) as { id: number; phone: string | null; email: string | null }[]
    if (!targets[0]) throw new Error("That reply target is not on this customer account.")
    replyPhone = targets[0].phone || ""
    replyEmail = targets[0].email || ""
    replyPersonId = Number(targets[0].id)
  }

  let eventId: number | null = null
  if (channel === "email") {
    if (!replyEmail) throw new Error("This account contact has no email address.")
    const apiKey = process.env.RESEND_API_KEY?.trim()
    const from = process.env.QUOTE_FROM_EMAIL?.trim()
    if (!apiKey || !from) throw new Error("Customer email is not configured.")
    const signedBody = `${body}\n\n-${operatorSignature(operator)}`
    const persistedId = `ops-reply:${operator.id}:${leadId}:${intentKey}`
    eventId = await recordEvent({
      kind: "email.out",
      actorType: "operator",
      actorId: operator.id,
      leadId,
      personId: replyPersonId,
      externalId: persistedId,
      body: signedBody,
      detail: { status: "persisted", channel: "email", to: replyEmail, subject: `Re: ${lead.service}` },
    })
    if (!eventId) {
      const sql = getSql()
      const prior = (await sql`SELECT id FROM events WHERE kind = 'email.out' AND external_id = ${persistedId}::text LIMIT 1`) as { id: number }[]
      eventId = Number(prior[0]?.id) || null
      if (eventId) {
        const accepted = (await sql`
          SELECT id FROM events WHERE kind = ANY(ARRAY['email.accepted','email.delivered']::text[])
            AND detail->>'sourceEventId' = ${String(eventId)}::text LIMIT 1`) as { id: number }[]
        if (accepted[0]) {
          revalidatePath(`/ops/leads/${leadId}`)
          return
        }
      }
    }
    if (!eventId) throw new Error("The email intent could not be filed.")
    try {
      const sent = await new Resend(apiKey).emails.send({
        from,
        to: replyEmail,
        subject: `Re: ${lead.service || "your MCSW job"}`,
        text: signedBody,
      }, { idempotencyKey: persistedId })
      if (sent.error || !sent.data?.id) throw new Error(sent.error?.message || "Email provider did not accept the message.")
      // Provider acceptance is not delivery. A signed webhook promotes this
      // persisted letter to delivered/failed later.
      await recordEvent({
        kind: "email.accepted",
        actorType: "system",
        leadId,
        personId: replyPersonId,
        externalId: sent.data.id,
        body: "Email accepted by the delivery provider.",
        crewBody: "Email accepted by the delivery provider.",
        detail: { sourceEventId: eventId, providerEmailId: sent.data.id },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email provider rejected the message."
      const failureEventId = await recordEvent({ kind: "email.failed", actorType: "system", leadId, personId: replyPersonId, externalId: `failed:${persistedId}`, body: message, crewBody: "Email did not send.", detail: { sourceEventId: eventId } })
      await notify({ operatorId: operator.id, priority: "digest", stock: "red", title: "Email failed", body: message, crewBody: "Customer email did not send.", url: `/ops/leads/${leadId}#spike`, sourceEventId: failureEventId || eventId })
      throw new Error(message)
    }
  } else {
    if (!replyPhone) throw new Error("This account contact has no validated mobile number.")
    const sent = await sendSmsPersisted({
      to: replyPhone,
      body,
      leadId,
      personId: replyPersonId,
      operatorId: operator.id,
      idempotencyKey: `ops-sms-reply:${operator.id}:${leadId}:${intentKey}`,
    })
    eventId = sent.eventId
  }
  if (eventId) after(() => processEvent(eventId!).catch((error) => console.error("Outbound reply extraction failed:", error)))
  revalidatePath(`/ops/leads/${leadId}`)
  revalidatePath("/ops")
}

export async function sendLeadText(formData: FormData) {
  formData.set("channel", "text")
  return sendLeadReply(formData)
}

export type ReplyActionState = { status: "idle" | "sent" | "error"; message: string; sentAt: number; retryable?: boolean }

export async function sendLeadReplyState(_state: ReplyActionState, formData: FormData): Promise<ReplyActionState> {
  try {
    const channel = formData.get("channel") === "email" ? "email" : "text"
    await sendLeadReply(formData)
    return { status: "sent", message: `${channel === "email" ? "Email" : "Text"} added to Calls & Messages.`, sentAt: Date.now() }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Reply failed.", sentAt: 0, retryable: isDefinitiveTwilioError(error) }
  }
}
