import { getSql } from "@/lib/db"
import { addClaim, supersedeClaimWithExisting } from "@/lib/claims"
import { recordEvent } from "@/lib/events"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { sendUsualPaperwork } from "@/app/ops/accounts/[id]/actions"
import { acceptQuoteCapture, rejectQuoteCapture } from "@/app/ops/leads/[id]/claim-actions"
import { sendSmsPersisted } from "@/lib/messages"
import { paymentCompletesInvoice } from "@/lib/gmail-routing.mjs"
import { isReservedShopPhone, normalizeEmail, normalizePhone } from "@/lib/people"
import { storeQueuedAttachment } from "@/lib/attachment-retry"
import { Resend } from "resend"
import { operatorSignature } from "@/lib/operators"

export async function POST(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  const input = await req.json().catch(() => null) as { notificationId?: number; decision?: string; value?: string } | null
  const notificationId = Number(input?.notificationId)
  if (!Number.isInteger(notificationId) || notificationId <= 0) return Response.json({ error: "Update not found." }, { status: 400 })
  const sql = getSql()
  const rows = (await sql`
    UPDATE notifications SET
      action_status = 'processing', action_claimed_at = now(),
      action_claimed_by = ${operator.id}::bigint, action_error = ''
    WHERE id = ${notificationId}::bigint AND operator_id = ${operator.id}::bigint
      AND (${operator.role}::text = 'owner' OR owner_only = false)
      AND action_kind <> ''
      AND (
        action_status IN ('open','failed')
        OR (action_status = 'processing' AND action_claimed_at < now() - interval '5 minutes')
      )
    RETURNING *`) as Array<{ id: number; action_kind: string; action_detail: Record<string, unknown>; source_event_id: number | null }>
  const slip = rows[0]
  if (!slip?.action_kind) return Response.json({ error: "That update is already handled." }, { status: 409 })
  try {
  if (slip.action_kind === "usual-paperwork") {
    const form = new FormData(); form.set("personId", String(slip.action_detail.personId ?? "")); form.set("idempotencyKey", `wire:${notificationId}:paperwork`)
    await sendUsualPaperwork(form)
  } else if (slip.action_kind === "quote-capture") {
    if (operator.role !== "owner") throw new Error("Owner access required.")
    const claims = (await sql`
      SELECT id FROM claims WHERE source_event_id = ${slip.source_event_id}::bigint
        AND predicate = 'quoted_price_cents' AND superseded_by IS NULL
      ORDER BY id DESC LIMIT 1`) as { id: number }[]
    if (!claims[0]) throw new Error("Quote receipt not found.")
    const form = new FormData(); form.set("leadId", String(slip.action_detail.leadId ?? "")); form.set("claimId", String(claims[0].id))
    if (input?.decision === "yep") await acceptQuoteCapture(form); else await rejectQuoteCapture(form)
  } else if (slip.action_kind === "departure-confirm") {
    const personId = Number(slip.action_detail.personId)
    if (!Number.isInteger(personId) || personId <= 0) throw new Error("Contact not found.")
    if (input?.decision === "yep") {
      await sql`UPDATE people SET status = 'departed' WHERE id = ${personId}::bigint`
      await recordEvent({ kind: "contact.churn-confirmed", actorType: "operator", actorId: operator.id, personId, externalId: `wire:${notificationId}:yep`, body: "Contact departure confirmed", crewBody: "Contact departure confirmed" })
    } else {
      const candidate = (await sql`SELECT id FROM claims WHERE subject_type = 'person' AND subject_id = ${personId}::bigint AND predicate = 'contact_departure_candidate' AND superseded_by IS NULL ORDER BY id DESC LIMIT 1`) as { id: number }[]
      if (candidate[0] && slip.source_event_id) {
        const replacement = await addClaim({ subjectType: "person", subjectId: personId, predicate: "contact_active_confirmed", value: true, confidence: 1, sourceEventId: slip.source_event_id, extractedBy: `operator:${operator.id}`, itemKey: `departure-rejected:${notificationId}` })
        await supersedeClaimWithExisting(candidate[0].id, replacement)
      }
      await sql`UPDATE people SET status = 'active' WHERE id = ${personId}::bigint`
    }
  } else if (slip.action_kind === "contact-intro") {
    const phone = normalizePhone(String(slip.action_detail.phone ?? ""))
    const name = String(slip.action_detail.name ?? "there")
    const leadId = Number(slip.action_detail.leadId) || null
    let personId = Number(slip.action_detail.personId) || null
    if (!phone || isReservedShopPhone(phone) || !personId) throw new Error("That successor phone is not safe to use.")
    const targets = (await sql`
      SELECT target.id
      FROM people anchor JOIN people target
        ON anchor.account_key <> '' AND target.account_key = anchor.account_key
      WHERE anchor.id = ${personId}::bigint
        AND target.merged_into IS NULL AND target.status = 'active' AND target.is_test = false
        AND ${phone}::text = ANY(target.phones)
      LIMIT 1`) as { id: number }[]
    if (!targets[0]) throw new Error("That successor is not attached to this account yet.")
    personId = Number(targets[0].id)
    await sendSmsPersisted({ to: phone, body: `Hey ${name}, ${operator.name || "Philip"} at Music City Specialty Welding here. I understand you’re the new contact. Holler anytime you need the usual welding help.`, leadId, personId, operatorId: operator.id, idempotencyKey: `wire:${notificationId}:contact-intro` })
  } else if (slip.action_kind === "contact-intro-email") {
    const anchorId = Number(slip.action_detail.personId)
    const targetId = Number(slip.action_detail.targetPersonId)
    const email = normalizeEmail(String(slip.action_detail.email ?? ""))
    const name = String(slip.action_detail.name ?? "there").trim().slice(0, 120) || "there"
    const leadId = Number(slip.action_detail.leadId) || null
    if (!anchorId || !targetId || !email) throw new Error("That successor email is not safe to use.")
    const targets = (await sql`
      SELECT target.id FROM people anchor JOIN people target
        ON anchor.account_key <> '' AND target.account_key = anchor.account_key
      WHERE anchor.id = ${anchorId}::bigint AND target.id = ${targetId}::bigint
        AND target.merged_into IS NULL AND target.status = 'active' AND target.is_test = false
        AND ${email}::text = ANY(target.emails)
      LIMIT 1`) as { id: number }[]
    if (!targets[0]) throw new Error("That successor is not attached to this account yet.")
    const intent = `wire:${notificationId}:contact-intro-email`
    const signature = operatorSignature(operator)
    const text = `Hi ${name},\n\n${signature} at Music City Specialty Welding here. I understand you’re the new contact. Holler anytime you need the usual welding help.\n\n-${signature}`
    let emailEventId = await recordEvent({ kind: "email.out", actorType: "operator", actorId: operator.id, leadId, personId: targetId, externalId: intent, body: text, detail: { to: email, subject: "Music City Specialty Welding — new contact" } })
    if (!emailEventId) {
      const prior = (await sql`SELECT id FROM events WHERE kind = 'email.out' AND external_id = ${intent}::text LIMIT 1`) as { id: number }[]
      emailEventId = Number(prior[0]?.id) || null
      const accepted = emailEventId ? (await sql`SELECT id FROM events WHERE kind = ANY(ARRAY['email.accepted','email.delivered']::text[]) AND detail->>'sourceEventId' = ${String(emailEventId)}::text LIMIT 1`) as { id: number }[] : []
      if (accepted[0]) emailEventId = null
    }
    if (emailEventId) {
      const apiKey = process.env.RESEND_API_KEY?.trim()
      const from = process.env.QUOTE_FROM_EMAIL?.trim()
      if (!apiKey || !from) throw new Error("Customer email is not configured.")
      const sent = await new Resend(apiKey).emails.send({ from, to: email, subject: "Music City Specialty Welding — new contact", text }, { idempotencyKey: intent })
      if (sent.error || !sent.data?.id) throw new Error(sent.error?.message || "Email provider did not accept the introduction.")
      await recordEvent({ kind: "email.accepted", actorType: "system", leadId, personId: targetId, externalId: sent.data.id, body: "Successor introduction accepted by email provider.", detail: { sourceEventId: emailEventId, providerEmailId: sent.data.id } })
    }
  } else if (slip.action_kind === "attachment-retry") {
    const attachmentId = Number(slip.action_detail.attachmentId)
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) throw new Error("Attachment receipt not found.")
    await sql`
      UPDATE ingest_attachments SET status = CASE WHEN blob_path <> '' THEN 'projecting' ELSE 'failed' END,
        attempts = 0, dead_lettered_at = NULL, updated_at = now() - interval '11 minutes'
      WHERE id = ${attachmentId}::bigint`
    const stored = await storeQueuedAttachment(attachmentId)
    if (!stored) throw new Error("The attachment is still unavailable. This item will stay in Updates.")
  } else if (slip.action_kind === "attach-payment") {
    if (operator.role !== "owner") throw new Error("Owner access required.")
    const leadId = Number(input?.value)
    const events = (await sql`SELECT occurred_at, detail FROM events WHERE id = ${slip.source_event_id}::bigint AND kind = 'email.payment' LIMIT 1`) as { occurred_at: string; detail: { amountCents?: number; invoiceNumber?: string; invoiceTotalCents?: number; balanceCents?: number; explicitFullPayment?: boolean } }[]
    const leads = (await sql`SELECT person_id, is_test, invoice_number, revenue_cents, invoice_total_cents, paid_amount_cents FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as { person_id: number | null; is_test: boolean; invoice_number: string; revenue_cents: number | null; invoice_total_cents: number | null; paid_amount_cents: number | null }[]
    if (!events[0] || !leads[0] || leads[0].is_test) throw new Error("Use a real work order number.")
    const invoiceNumber = String(events[0].detail.invoiceNumber ?? "").trim().slice(0, 60)
    const normalizedInvoice = invoiceNumber.toLowerCase()
    if (invoiceNumber) {
      if (leads[0].invoice_number && leads[0].invoice_number.trim().toLowerCase() !== normalizedInvoice) throw new Error(`That work order already carries invoice #${leads[0].invoice_number}.`)
      const duplicates = (await sql`
        SELECT id FROM leads WHERE id <> ${leadId}::bigint AND invoice_number <> ''
          AND lower(btrim(invoice_number)) = ${normalizedInvoice}::text LIMIT 1`) as { id: number }[]
      if (duplicates[0]) throw new Error(`Invoice #${invoiceNumber} is already attached to another work order.`)
      const claims = (await sql`
        INSERT INTO invoice_identities (normalized_number, invoice_number, lead_id)
        VALUES (${normalizedInvoice}::text, ${invoiceNumber}::text, ${leadId}::bigint)
        ON CONFLICT (normalized_number) WHERE released_at IS NULL DO UPDATE
          SET invoice_number = EXCLUDED.invoice_number
          WHERE invoice_identities.lead_id = EXCLUDED.lead_id
        RETURNING lead_id`) as { lead_id: number }[]
      if (!claims[0]) throw new Error(`Invoice #${invoiceNumber} is reserved by another work order.`)
    }
    await sql`UPDATE events SET lead_id = ${leadId}::bigint, person_id = ${leads[0].person_id}::bigint WHERE id = ${slip.source_event_id}::bigint`
    const totals = (await sql`
      SELECT COALESCE(sum(CASE WHEN detail->>'amountCents' ~ '^\\d+$' THEN (detail->>'amountCents')::bigint ELSE 0 END), 0)::bigint AS paid_total
      FROM events WHERE kind = 'email.payment' AND lead_id = ${leadId}::bigint`) as { paid_total: number }[]
    const paidTotal = Number(totals[0]?.paid_total ?? 0)
    const amount = Number(events[0].detail.amountCents ?? 0)
    const trustedTotal = leads[0].invoice_total_cents ?? (Number(events[0].detail.invoiceTotalCents || 0) || null)
    const fullyPaid = events[0].detail.balanceCents === 0 || paymentCompletesInvoice({ text: events[0].detail.explicitFullPayment ? "paid in full" : "", amountCents: amount, priorPaidCents: Math.max(0, paidTotal - amount), invoiceTotalCents: trustedTotal })
    await sql`UPDATE leads SET
      invoice_number = CASE WHEN invoice_number = '' THEN ${invoiceNumber}::text ELSE invoice_number END,
      invoice_total_cents = COALESCE(invoice_total_cents, ${trustedTotal}::bigint),
      invoiced_at = CASE WHEN invoice_number = '' AND ${invoiceNumber}::text <> '' THEN COALESCE(invoiced_at, ${events[0].occurred_at}::timestamptz) ELSE invoiced_at END,
      paid_at = CASE WHEN ${fullyPaid}::boolean THEN COALESCE(paid_at, ${events[0].occurred_at}::timestamptz) ELSE paid_at END,
      paid_amount_cents = GREATEST(COALESCE(paid_amount_cents, 0), ${paidTotal}::bigint),
      revenue_cents = CASE WHEN ${fullyPaid}::boolean THEN COALESCE(revenue_cents, ${(trustedTotal ?? paidTotal) || null}::bigint) ELSE revenue_cents END,
      status = CASE WHEN ${fullyPaid}::boolean THEN 'won' ELSE status END,
      won_at = CASE WHEN ${fullyPaid}::boolean THEN COALESCE(won_at, ${events[0].occurred_at}::timestamptz) ELSE won_at END,
      updated_at = now() WHERE id = ${leadId}::bigint`
    await recordEvent({ kind: fullyPaid ? "invoice.paid" : "invoice.payment-received", actorType: "operator", actorId: operator.id, leadId, personId: leads[0].person_id, externalId: `wire-payment:${slip.source_event_id}`, body: fullyPaid ? "Unmatched QuickBooks payment attached and invoice verified paid" : "QuickBooks payment attached; invoice remains open", detail: { sourceEventId: slip.source_event_id, paidTotalCents: paidTotal, fullyPaid, ...events[0].detail } })
  } else throw new Error("Unknown update action.")
  await sql`UPDATE notifications SET read_at = COALESCE(read_at, now()), action_kind = '', action_status = 'done' WHERE id = ${notificationId}::bigint AND operator_id = ${operator.id}::bigint`
  return Response.json({ ok: true, message: "Handled from Updates." })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The update action failed."
    await sql`UPDATE notifications SET action_status = 'failed', action_error = ${message.slice(0, 500)}::text WHERE id = ${notificationId}::bigint AND operator_id = ${operator.id}::bigint`
    return Response.json({ error: `${message} Tap the action again to retry safely.` }, { status: 500 })
  }
}
