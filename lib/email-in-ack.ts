import { Resend } from "resend"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { shouldSkipGmailMessage } from "@/lib/gmail-routing.ts"
import { isDefinitiveEmailProviderError, sendEmailWithProviderTruth } from "@/lib/email-provider-truth.ts"
import { getShopPhone } from "@/lib/shop-contact"

type EmailInAckInput = {
  source: "email-in" | "email-out"
  createdLead: boolean
  existingThread: boolean
  messageId: string
  threadId: string
  leadId: number
  personId: number
  displayName: string
  email: string
  subject: string
  body: string
  headers: Record<string, string>
  categorizedNoise: boolean
  isTest: boolean
}

/** The unique immutable intent is also the send claim: never replay a handoff. */
export async function acknowledgeNewEmailLead(input: EmailInAckInput) {
  if (process.env.MCSW_EMAIL_IN_ACK !== "1" || input.source !== "email-in"
    || !input.createdLead || input.existingThread || input.isTest
    || `${input.displayName}\n${input.subject}\n${input.body}`.includes("[INTERNAL TEST]")
    || input.headers["in-reply-to"] || input.headers.references
    || shouldSkipGmailMessage({ sent: false, categorizedNoise: input.categorizedNoise, from: input.email, subject: input.subject, body: input.body, headers: input.headers })) return

  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.QUOTE_FROM_EMAIL?.trim()
  const email = input.email.trim().toLowerCase()
  const ownEmails = [from, process.env.QUOTE_TO_EMAIL, process.env.OPS_LOGIN_EMAIL]
    .flatMap((value) => (value || "").split(","))
    .map((value) => (value.match(/<([^>]+)>/)?.[1] || value).trim().toLowerCase())
  if (!apiKey || !from || !/^[^\s<>@\p{Cc}]+@[^\s<>@\p{Cc}]+\.[^\s<>@\p{Cc}]+$/u.test(email) || ownEmails.includes(email)
    || /^(?:do-?not-?reply|no-?reply|mailer-daemon)(?:[.+_-]|@)/i.test(email)) return
  const externalId = input.threadId || input.messageId
  if (!externalId) return
  const operators = (await getSql()`
    SELECT id FROM operators WHERE lower(email) = ${email}::text LIMIT 1`) as { id: number }[]
  if (operators[0]) return

  const firstName = input.displayName.trim().split(/\s+/)[0] || email.split("@")[0]
  const text = [
    `Hey ${firstName},`,
    "",
    "Your email request just hit our board. Reply with a phone number so a real person from the shop can call you.",
    "",
    `If it can't wait, call ${getShopPhone().display}.`,
    "",
    "Music City Specialty Welding",
    "533 W Baddour Pkwy, Lebanon, TN 37087",
  ].join("\n")
  const subject = `Re: ${input.subject.replace(/\p{Cc}/gu, " ").replace(/^\s*Re:\s*/i, "").trim() || "your MCSW job"}`.slice(0, 200)
  const messageId = input.headers["message-id"]?.trim()
  const headers: Record<string, string> = { "Auto-Submitted": "auto-replied" }
  if (messageId && /^<[^\s<>\p{Cc}]+@[^\s<>\p{Cc}]+>$/u.test(messageId)) {
    headers["In-Reply-To"] = messageId
    headers.References = messageId
  }
  const idempotencyKey = `email-in:${externalId}:ack`
  const sourceEventId = await recordEvent({
    kind: "email.out", actorType: "system", leadId: input.leadId, personId: input.personId,
    externalId: idempotencyKey, body: text,
    detail: { status: "persisted", channel: "email", audience: "customer", automaticAck: true, to: email, from, subject, headers, threadId: input.threadId, inboundMessageId: input.messageId, isTest: false },
  })
  if (!sourceEventId) return

  try {
    const accepted = await sendEmailWithProviderTruth(() => new Resend(apiKey).emails.send({ from, to: email, subject, text, headers }, { idempotencyKey }))
    await recordEvent({
      kind: "email.accepted", actorType: "system", leadId: input.leadId, personId: input.personId,
      externalId: accepted.id, body: "Email accepted by the delivery provider.",
      detail: { sourceEventId, providerEmailId: accepted.id, audience: "customer", isTest: false },
    })
  } catch (error) {
    const definitive = isDefinitiveEmailProviderError(error)
    await recordEvent({
      kind: definitive ? "email.failed" : "email.unknown", actorType: "system", leadId: input.leadId, personId: input.personId,
      externalId: `${definitive ? "failed" : "unknown"}:${idempotencyKey}`,
      body: error instanceof Error ? error.message : "Email provider response was lost.",
      detail: { sourceEventId, ambiguous: !definitive, audience: "customer", isTest: false },
    })
  }
}
