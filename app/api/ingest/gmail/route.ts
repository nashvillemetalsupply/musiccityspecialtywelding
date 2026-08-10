import { after } from "next/server"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { processEvent } from "@/lib/extract"
import { emailAddress, emailName, getGmailMessage, getMailboxHistoryId, gmailAccessToken, gmailAttachmentDescriptors, gmailConfigured, gmailHeaders, gmailHeaderValues, gmailPlaintext, listGmailMessageIds } from "@/lib/gmail"
import { resolveEmailConversation } from "@/lib/ingest"
import { notifyAll } from "@/lib/notify"
import { isAuthorizedCron } from "@/lib/ops-auth"
import { extractQuickBooksPaymentFacts, isAuthenticatedIntuitPayment, looksLikeIntuitPaymentEnvelope, paymentCompletesInvoice, sentMessageMayStartWork, shouldSkipGmailMessage } from "@/lib/gmail-routing.mjs"
import { findPersonByEmail, getPerson } from "@/lib/people"
import { classifyAttachmentSensitivity, queueIngestAttachment, storeQueuedAttachment } from "@/lib/attachment-retry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function ingestPayment(messageId: string, occurredAt: string, subject: string, body: string, isTest: boolean) {
  const facts = extractQuickBooksPaymentFacts({ subject, body })
  const invoice = facts.invoiceNumber
  const cents = facts.paymentAmountCents
  const explicitFullPayment = paymentCompletesInvoice({ text: `${subject}\n${body}`, amountCents: cents })
  const sql = getSql()
  let eventId = await recordEvent({ kind: "email.payment", actorType: "system", externalId: messageId, occurredAt, body: subject, detail: { invoiceNumber: invoice ?? null, amountCents: cents, invoiceTotalCents: facts.invoiceTotalCents, balanceCents: facts.balanceCents, explicitFullPayment, isTest } })
  const inserted = Boolean(eventId)
  if (!eventId) {
    const existing = (await sql`SELECT id FROM events WHERE kind = 'email.payment' AND external_id = ${messageId}::text LIMIT 1`) as { id: number }[]
    eventId = Number(existing[0]?.id) || null
  }
  if (!eventId) throw new Error("Payment receipt could not be resumed.")
  const leads = invoice ? (await sql`
    SELECT id, person_id, is_test, revenue_cents, invoice_total_cents, paid_amount_cents FROM leads
    WHERE lower(invoice_number) = lower(${invoice}::text) AND is_test = ${isTest}::boolean
    ORDER BY invoiced_at DESC NULLS LAST LIMIT 2`) as { id: number; person_id: number | null; is_test: boolean; revenue_cents: number | null; invoice_total_cents: number | null; paid_amount_cents: number | null }[] : []
  if (leads.length > 1) {
    await notifyAll({
      priority: "digest",
      stock: "red",
      title: `Invoice #${invoice} matches two jobs`,
      body: "Nothing was marked paid. Fix the duplicate invoice number first.",
      url: "/ops?view=updates&wire=past#wire",
      sourceEventId: eventId,
      ownerOnly: true,
      dedupeKey: `payment-ambiguous:${messageId}`,
    })
    return { ambiguous: true, payment: true, duplicate: !inserted }
  }
  const lead = leads[0]
  if (lead) {
    await sql`UPDATE events SET lead_id = ${lead.id}::bigint, person_id = ${lead.person_id}::bigint WHERE id = ${eventId}::bigint`
    const totals = (await sql`
      SELECT COALESCE(sum(
        CASE WHEN detail->>'amountCents' ~ '^\\d+$' THEN (detail->>'amountCents')::bigint ELSE 0 END
      ), 0)::bigint AS paid_total
      FROM events
      WHERE kind = 'email.payment' AND lead_id = ${lead.id}::bigint`) as { paid_total: number }[]
    const paidTotal = Number(totals[0]?.paid_total ?? 0)
    const priorPaid = Math.max(0, paidTotal - (cents ?? 0))
    const trustedTotal = lead.invoice_total_cents ?? facts.invoiceTotalCents
    const fullyPaid = facts.balanceCents === 0 || paymentCompletesInvoice({ text: `${subject}\n${body}`, amountCents: cents, invoiceTotalCents: trustedTotal, priorPaidCents: priorPaid })
    await sql`
      UPDATE leads SET
        paid_at = CASE WHEN ${fullyPaid}::boolean THEN COALESCE(paid_at, ${occurredAt}::timestamptz) ELSE paid_at END,
        paid_amount_cents = GREATEST(COALESCE(paid_amount_cents, 0), ${paidTotal}::bigint),
        invoice_total_cents = COALESCE(invoice_total_cents, ${facts.invoiceTotalCents}::bigint),
        revenue_cents = CASE WHEN ${fullyPaid}::boolean THEN COALESCE(revenue_cents, ${(trustedTotal ?? paidTotal) || null}::bigint) ELSE revenue_cents END,
        status = CASE WHEN ${fullyPaid}::boolean THEN 'won' ELSE status END,
        won_at = CASE WHEN ${fullyPaid}::boolean THEN COALESCE(won_at, ${occurredAt}::timestamptz) ELSE won_at END,
        updated_at = now()
      WHERE id = ${lead.id}::bigint`
    if (fullyPaid) {
      await sql`
        UPDATE commitments SET status = 'kept', status_changed_at = now(), status_source_event_id = ${eventId}::bigint
        WHERE lead_id = ${lead.id}::bigint AND status = 'open'
          AND (summary ILIKE '%pay%' OR summary ILIKE '%invoice%')`
      const paidEventId = await recordEvent({ kind: "invoice.paid", actorType: "system", leadId: lead.id, personId: lead.person_id, externalId: `payment:${messageId}`, occurredAt, body: `${paidTotal ? `$${(paidTotal / 100).toLocaleString("en-US")}` : "Payment"} landed${invoice ? ` — INV #${invoice}` : ""}`, detail: { sourceEventId: eventId, amountCents: cents, paidTotalCents: paidTotal, invoiceNumber: invoice } })
      if (!lead.is_test) await notifyAll({ priority: "digest", stock: "green", title: `${paidTotal ? `$${(paidTotal / 100).toLocaleString("en-US")}` : "Money"} landed`, body: invoice ? `Invoice #${invoice} paid.` : "QuickBooks marked a payment.", url: `/ops/leads/${lead.id}`, sourceEventId: paidEventId || eventId, ownerOnly: true })
    } else {
      const partialEventId = await recordEvent({ kind: "invoice.payment-received", actorType: "system", leadId: lead.id, personId: lead.person_id, externalId: `partial-payment:${messageId}`, occurredAt, body: `Payment received for invoice #${invoice}; balance not verified as paid`, detail: { sourceEventId: eventId, amountCents: cents, paidTotalCents: paidTotal, invoiceNumber: invoice } })
      if (!lead.is_test) await notifyAll({ priority: "digest", stock: "manila", title: `Payment on #${invoice}`, body: "Recorded, but the invoice is not verified paid in full.", url: `/ops/leads/${lead.id}`, sourceEventId: partialEventId || eventId, ownerOnly: true, dedupeKey: `partial-payment:${messageId}` })
    }
    return { paid: fullyPaid, payment: true, duplicate: !inserted }
  }
  if (!isTest) await notifyAll({ priority: "digest", stock: "green", title: invoice ? `Payment for #${invoice}` : "QuickBooks payment", body: "No matching work order. Attach it here.", url: "/ops", sourceEventId: eventId, ownerOnly: true, actionKind: "attach-payment", actionDetail: { paymentEventId: eventId, invoiceNumber: invoice ?? "", amountCents: cents } })
  return { unmatched: true, duplicate: !inserted }
}

async function ingestDeposit(messageId: string, occurredAt: string, subject: string, body: string, isTest: boolean) {
  const match = `${subject}\n${body}`.match(/\bAmount\s*\$\s*([\d,]+(?:\.\d{2})?)/i)
  const cents = match ? Math.round(Number(match[1].replace(/,/g, "")) * 100) : null
  const company = body.match(/\bCompany\s+([^\n]+?)(?:\s+Deposit ID\b|$)/i)?.[1]?.trim() ?? ""
  const eventId = await recordEvent({ kind: "email.deposit", actorType: "system", externalId: messageId, occurredAt, body: `${cents ? `$${(cents / 100).toLocaleString("en-US")}` : "QuickBooks deposit"} is on the way`, detail: { amountCents: cents, company: company || null, isTest } })
  if (eventId && !isTest) await notifyAll({ priority: "digest", stock: "green", title: `${cents ? `$${(cents / 100).toLocaleString("en-US")}` : "Money"} is on the way`, body: company || "QuickBooks deposit notice received.", url: "/ops?view=updates#wire", sourceEventId: eventId, ownerOnly: true })
  return { deposit: true, duplicate: !eventId }
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  if (!gmailConfigured()) return Response.json({ ok: false, error: "Gmail is not configured." }, { status: 503 })
  const sql = getSql()
  const lease = (await sql`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES ('gmail-ingest-lease'::text, ${JSON.stringify({ owner: crypto.randomUUID() })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE sync_state.updated_at < now() - interval '8 minutes'
    RETURNING key`) as { key: string }[]
  if (!lease[0]) return Response.json({ ok: true, skipped: "Gmail sync already in progress." }, { status: 202 })
  const token = await gmailAccessToken()
  const state = (await sql`SELECT value FROM sync_state WHERE key = 'gmail'::text LIMIT 1`) as { value: { historyId?: string } }[]
  let listing
  try { listing = await listGmailMessageIds(token, state[0]?.value?.historyId ?? null) }
  catch (error) {
    if ((error as { status?: number }).status !== 404) throw error
    listing = await listGmailMessageIds(token, null)
  }
  const counters = { scanned: listing.ids.length, inserted: 0, payments: 0, skipped: 0, failures: 0, deadLettered: 0 }
  for (const id of listing.ids.reverse()) {
    try {
      const message = await getGmailMessage(token, id)
      const headers = gmailHeaders(message)
      const subject = headers.subject || "(no subject)"
      const from = emailAddress(headers.from)
      const to = emailAddress(headers.to)
      const body = gmailPlaintext(message)
      const isTest = `${subject}\n${body}`.includes("[INTERNAL TEST]")
      const occurredAt = new Date(Number(message.internalDate)).toISOString()
      const sent = message.labelIds?.includes("SENT") ?? false
      const categorizedNoise = message.labelIds?.some((label) =>
        ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "SPAM", "TRASH"].includes(label)
          || (label === "DRAFT" && !sent)
      )
      const paymentEnvelope = looksLikeIntuitPaymentEnvelope({ from, subject, body })
      if (isAuthenticatedIntuitPayment({ from, labels: message.labelIds ?? [], authenticationResults: gmailHeaderValues(message, "authentication-results"), subject, body })) {
        const result = /money on the way/i.test(subject) ? await ingestDeposit(id, occurredAt, subject, body, isTest) : await ingestPayment(id, occurredAt, subject, body, isTest)
        if (!result.duplicate) counters.payments++
        continue
      }
      if (paymentEnvelope) {
        let securityEventId = await recordEvent({ kind: "email.payment-rejected", actorType: "system", externalId: id, occurredAt, body: "Payment-looking email failed trusted Gmail authentication.", crewBody: "A suspicious payment-looking email was kept off the board.", detail: { subject, from, labels: message.labelIds ?? [], isTest } })
        if (!securityEventId) {
          const existing = (await sql`SELECT id FROM events WHERE kind = 'email.payment-rejected' AND external_id = ${id}::text LIMIT 1`) as { id: number }[]
          securityEventId = Number(existing[0]?.id) || null
        }
        await notifyAll({ priority: "digest", stock: "red", title: "Payment email failed authentication", body: `${subject} was not allowed to change money records.`, crewBody: "A suspicious payment email was quarantined.", url: "/ops?view=updates#wire", sourceEventId: securityEventId, ownerOnly: true, dedupeKey: `payment-auth-rejected:${id}` })
        counters.skipped++
        continue
      }
      if (shouldSkipGmailMessage({ sent, categorizedNoise: Boolean(categorizedNoise), from })) { counters.skipped++; continue }
      const customerEmail = sent ? to : from
      if (!customerEmail || !customerEmail.includes("@")) { counters.skipped++; continue }
      const mapped = (await sql`
        SELECT et.lead_id, et.person_id FROM external_threads et
        JOIN leads l ON l.id = et.lead_id
        WHERE et.provider = 'gmail'::text AND et.external_thread_id = ${message.threadId}::text
          AND l.is_test = ${isTest}::boolean
        LIMIT 1`) as { lead_id: number; person_id: number | null }[]
      if (sent && !mapped[0]) {
        const knownCustomer = await findPersonByEmail(customerEmail, isTest)
        if (!knownCustomer && !sentMessageMayStartWork({ subject, body })) { counters.skipped++; continue }
      }
      const mappedPerson = mapped[0]?.person_id ? await getPerson(mapped[0].person_id) : null
      const conversation = mapped[0] && mappedPerson
        ? { person: mappedPerson, leadId: Number(mapped[0].lead_id), createdLead: false }
        : await resolveEmailConversation({ email: customerEmail, displayName: emailName(sent ? headers.to : headers.from), body, isTest, source: sent ? "email-out" : "email-in" })
      await sql`
        INSERT INTO external_threads (provider, external_thread_id, lead_id, person_id)
        VALUES ('gmail'::text, ${message.threadId}::text, ${conversation.leadId}::bigint, ${conversation.person.id}::bigint)
        ON CONFLICT (provider, external_thread_id) DO NOTHING`
      const kind = sent ? "email.out" : "email.in"
      const sentOperators = sent ? (await sql`
        SELECT id FROM operators
        WHERE active = true AND (lower(email) = lower(${from}::text) OR role = 'owner')
        ORDER BY (lower(email) = lower(${from}::text)) DESC, (role = 'owner') DESC, id ASC
        LIMIT 1`) as { id: number }[] : []
      const sentOperatorId = sentOperators[0]?.id ? Number(sentOperators[0].id) : null
      let eventId = await recordEvent({ kind, actorType: sent ? "operator" : "customer", actorId: sent ? sentOperatorId ?? "" : conversation.person.id, leadId: conversation.leadId, personId: conversation.person.id, externalId: id, occurredAt, body: body || subject, detail: { threadId: message.threadId, subject, from, to, labels: message.labelIds ?? [], deliveryStatus: sent ? "delivered" : null, isTest } })
      if (eventId) counters.inserted++
      else {
        const existing = (await sql`SELECT id FROM events WHERE kind = ${kind}::text AND external_id = ${id}::text LIMIT 1`) as { id: number }[]
        eventId = Number(existing[0]?.id) || null
      }
      const attachmentIds: number[] = []
      for (const attachment of gmailAttachmentDescriptors(message)) {
        attachmentIds.push(await queueIngestAttachment({ provider: "gmail", externalMessageId: id, attachmentKey: attachment.key, leadId: conversation.leadId, personId: conversation.person.id, filename: attachment.filename, contentType: attachment.contentType, sensitivity: classifyAttachmentSensitivity(attachment.filename, attachment.contentType, `${subject}\n${body}`), sourceDetail: { attachmentId: attachment.attachmentId, inlineData: attachment.inlineData, declaredSize: attachment.size } }))
      }
      for (const attachmentId of attachmentIds) await storeQueuedAttachment(attachmentId, token)
      if (!eventId) throw new Error("Email receipt could not be resumed.")
      const paperworkRequested = /\bW-?9\b|certificate of insurance|\bCOI\b/i.test(`${subject}\n${body}`)
      if (!conversation.person.is_test && !sent) await notifyAll({
        priority: "interrupt",
        stock: paperworkRequested ? "manila" : "white",
        title: paperworkRequested
          ? `${conversation.person.display_name || customerEmail} wants the usual paperwork`
          : conversation.createdLead
            ? `New email from ${conversation.person.display_name || customerEmail}`
            : `${conversation.person.display_name || customerEmail} emailed`,
        body: paperworkRequested ? "The W-9 and current COI are ready from their account envelope." : subject.slice(0, 110),
        crewBody: paperworkRequested ? "A customer asked for the usual paperwork." : subject.slice(0, 110),
        url: `/ops/leads/${conversation.leadId}#spike`,
        sourceEventId: eventId,
        capExempt: conversation.createdLead,
        quietHoursExempt: conversation.createdLead,
        smsFallback: conversation.createdLead,
        actionKind: paperworkRequested ? "usual-paperwork" : undefined,
        actionDetail: paperworkRequested ? { personId: conversation.person.id } : undefined,
      })
      after(() => processEvent(eventId).catch((error) => console.error("Email extraction failed:", error)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failures = (await sql`
        INSERT INTO gmail_ingest_failures (message_id, attempts, last_error, last_attempt_at)
        VALUES (${id}::text, 1, ${message.slice(0, 1000)}::text, now())
        ON CONFLICT (message_id) DO UPDATE SET
          attempts = gmail_ingest_failures.attempts + 1,
          last_error = EXCLUDED.last_error,
          last_attempt_at = now()
        RETURNING attempts`) as { attempts: number }[]
      const attempts = Number(failures[0]?.attempts ?? 1)
      if (attempts >= 5) {
        await sql`UPDATE gmail_ingest_failures SET dead_lettered_at = COALESCE(dead_lettered_at, now()) WHERE message_id = ${id}::text`
        const deadEventId = await recordEvent({ kind: "email.ingest-dead-letter", actorType: "system", externalId: `gmail-dead:${id}`, body: `Gmail message could not be filed after ${attempts} attempts`, detail: { messageId: id, error: message } })
        await notifyAll({ priority: "digest", stock: "red", title: "One Gmail update needs a human", body: "MCSW Jobs held it after five safe retries.", url: "/ops?view=updates", sourceEventId: deadEventId, ownerOnly: true, dedupeKey: `gmail-dead:${id}` }).catch(() => undefined)
        counters.deadLettered++
      } else counters.failures++
      console.error(`Gmail message ${id} failed:`, error)
    }
  }
  const historyId = listing.historyId || await getMailboxHistoryId(token)
  if (counters.failures === 0) await sql`
    INSERT INTO sync_state (key, value, updated_at) VALUES ('gmail'::text, ${JSON.stringify({ historyId })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
  await sql`
    INSERT INTO automation_runs (job, ok, detail) VALUES ('gmail-ingest'::text, ${counters.failures === 0}::boolean, ${JSON.stringify(counters)}::jsonb)`
  await sql`UPDATE sync_state SET updated_at = 'epoch'::timestamptz WHERE key = 'gmail-ingest-lease'::text`
  return Response.json({ ok: counters.failures === 0, ...counters, historyId, checkpointAdvanced: counters.failures === 0 })
}
