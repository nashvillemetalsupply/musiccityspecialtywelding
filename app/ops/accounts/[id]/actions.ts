"use server"

import { get } from "@vercel/blob"
import { Resend } from "resend"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { getAccount } from "@/lib/accounts"
import { listShopDocuments } from "@/lib/shop"
import { recordEvent } from "@/lib/events"
import { getSql } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { notify } from "@/lib/notify"
import { operatorSignature } from "@/lib/operators"

export async function sendUsualPaperwork(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator) throw new Error("Sign in required.")
  const personId = Number(formData.get("personId"))
  const requestedKey = String(formData.get("idempotencyKey") ?? "").trim().slice(0, 150)
  const centralDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  if (!Number.isInteger(personId) || personId <= 0) throw new Error("Account not found.")
  if (!requestedKey) throw new Error("Reload the account envelope before sending it.")
  const [account, documents] = await Promise.all([getAccount(personId, operator.role), listShopDocuments()])
  const recipient = account?.people.find((person) => Number(person.id) === personId && person.status === "active" && person.emails?.[0])
  const to = recipient?.emails?.[0]
  const w9 = documents.find((item) => item.kind === "w9" && item.status === "ready" && item.pathname)
  const coi = documents.find((item) => item.kind === "coi" && item.status === "ready" && item.pathname && item.expires_at && new Date(item.expires_at).getTime() > Date.now())
  const ready = [w9, coi].filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (!account || !to || !w9 || !coi) throw new Error("The envelope needs both a W-9 and an unexpired insurance certificate.")
  // Server-derived: changing hidden form values cannot bypass the same-day,
  // same-recipient, same-document claim.
  const idempotencyKey = `paperwork:${personId}:${ready.map((item) => item.id).sort((a, b) => Number(a) - Number(b)).join("-")}:${centralDay}`
  const leadId = account.leads[0]?.id ?? null
  let eventId = await recordEvent({ kind: "email.out", actorType: "operator", actorId: operator.id, leadId, personId: recipient?.id ?? personId, externalId: idempotencyKey, body: "Attached: W-9 and current certificate of insurance.", crewBody: "The usual paperwork is queued for delivery.", detail: { deliveryStatus: "pending", documentIds: ready.map((item) => item.id) } })
  if (!eventId && idempotencyKey) {
    const prior = (await getSql()`SELECT id FROM events WHERE kind = 'email.out' AND external_id = ${idempotencyKey}::text LIMIT 1`) as { id: number }[]
    eventId = Number(prior[0]?.id) || null
    if (eventId) {
      const receipt = (await getSql()`SELECT kind FROM events WHERE kind = ANY(ARRAY['email.accepted','email.delivered','email.failed']::text[]) AND (detail->>'sourceEventId')::bigint = ${eventId}::bigint ORDER BY id DESC LIMIT 1`) as { kind: string }[]
      if (receipt[0]?.kind === "email.accepted" || receipt[0]?.kind === "email.delivered") return
      // A failed/ambiguous attempt resumes with the same provider key. Resend
      // returns its original receipt if it accepted the first request.
    }
  }
  if (!eventId) throw new Error("The paperwork intent could not be filed.")
  try {
    const attachments = []
    for (const document of ready) {
      const blob = await get(document.pathname, { access: "private" })
      if (!blob?.stream || blob.statusCode !== 200) throw new Error(`${document.filename} could not be read from the shop envelope.`)
      attachments.push({ filename: document.filename, content: Buffer.from(await new Response(blob.stream).arrayBuffer()) })
    }
    const apiKey = process.env.RESEND_API_KEY?.trim()
    const from = process.env.QUOTE_FROM_EMAIL?.trim()
    if (!apiKey || !from || attachments.length !== ready.length) throw new Error("Email or paperwork storage is not configured.")
    const sent = await new Resend(apiKey).emails.send({ from, to, subject: "MCSW: W-9 and insurance certificate", text: `Attached: W-9 and current certificate of insurance. Holler if you need anything else.\n\n-${operatorSignature(operator)}`, attachments }, idempotencyKey ? { idempotencyKey } : undefined)
    if (sent.error) throw new Error(sent.error.message)
    if (!sent.data?.id) throw new Error("Email provider did not accept the paperwork.")
    await recordEvent({ kind: "email.accepted", actorType: "system", leadId, personId, externalId: sent.data.id, body: "The usual paperwork was accepted for delivery.", crewBody: "The usual paperwork was accepted for delivery.", detail: { sourceEventId: eventId, providerEmailId: sent.data.id } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paperwork delivery failed."
    const failedEventId = await recordEvent({ kind: "email.failed", actorType: "system", leadId, personId, externalId: `paperwork:${eventId}:failed`, body: message, crewBody: "The usual paperwork did not deliver.", detail: { sourceEventId: eventId } })
    await notify({ operatorId: operator.id, priority: "interrupt", stock: "red", title: "Paperwork did not deliver", body: message, crewBody: "Open the account envelope and try again.", url: `/ops/accounts/${personId}`, sourceEventId: failedEventId })
    throw error
  }
}

export async function markAccountRegular(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator || operator.role !== "owner") throw new Error("Owner access is required.")
  const personId = Number(formData.get("personId"))
  if (!Number.isInteger(personId) || personId <= 0) throw new Error("Account not found.")
  const account = await getAccount(personId, operator.role)
  if (!account) throw new Error("Account not found.")
  const personIds = account.people.map((person) => Number(person.id))
  const sql = getSql()
  await sql`
    UPDATE people SET is_regular = true
    WHERE id = ANY(${personIds}::bigint[]) AND is_test = false`
  await recordEvent({ kind: "account.regular", actorType: "operator", actorId: operator.id, personId, body: `${account.person.company || account.person.display_name || "Account"} was added to Regular Customers` })
  revalidatePath("/ops")
  revalidatePath(`/ops/accounts/${personId}`)
}
