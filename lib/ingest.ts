import { createLead } from "@/lib/leads"
import {
  attachLeadToPerson,
  findOrCreatePerson,
  findOpenLeadResolutionForPerson,
  findRecentOpenLeadForPerson,
  getPerson,
  normalizePhone,
  type PersonRow,
} from "@/lib/people"
import { getSql } from "@/lib/db"
import { notifyAll } from "@/lib/notify"
import {
  inboundCallNotificationDedupeKey,
  markInboundCallReconciliationHandled,
  persistInboundCallReceipt,
  prepareInboundCallIntake,
} from "@/lib/job-intake"

export { attachRecoveredCallArtifacts } from "@/lib/call-artifacts"

export async function resolvePhoneConversation(input: {
  phone: string
  body?: string
  isTest?: boolean
  source: "phone-in" | "sms-in"
}): Promise<{ person: PersonRow; leadId: number; createdLead: boolean; routing: "existing" | "new" | "needs-job-match" }> {
  const phone = normalizePhone(input.phone)
  if (!phone) throw new Error("Inbound phone number is invalid.")
  const displayName = `Caller •${phone.slice(-4)}`
  const isTest = input.isTest ?? (input.body?.includes("[INTERNAL TEST]") ?? false)
  const person = await findOrCreatePerson({
    phone,
    displayName,
    isTest,
  })
  if (!person) throw new Error("Customer record could not be created.")
  const sql = getSql()
  const identityKey = `phone:${person.id}`
  // Once the owner has matched a conversation, keep using that explicit job
  // until it closes. This is stronger evidence than guessing from recency.
  const claimed = (await sql`
    SELECT claim.lead_id, lead.service
    FROM inbound_conversation_claims claim
    JOIN leads lead ON lead.id = claim.lead_id
    WHERE claim.identity_key = ${identityKey}::text
      AND claim.person_id = ${person.id}::bigint
      AND lead.person_id = ${person.id}::bigint
      AND lead.is_test = ${person.is_test}::boolean
      AND lead.completed_at IS NULL
      AND lead.status NOT IN ('lost','spam')
      AND lead.routed_to_lead_id IS NULL
    LIMIT 1`) as Array<{ lead_id: number; service: string }>
  if (claimed[0]) return {
    person,
    leadId: Number(claimed[0].lead_id),
    createdLead: false,
    routing: claimed[0].service === "Needs job match" ? "needs-job-match" : "existing",
  }
  const openLead = await findOpenLeadResolutionForPerson(person.id, person.is_test)
  if (openLead.leadId) return {
    person,
    leadId: openLead.leadId,
    createdLead: false,
    routing: openLead.needsJobMatch ? "needs-job-match" : "existing",
  }

  const claim = (await sql`
    INSERT INTO inbound_conversation_claims (identity_key, person_id, claimed_at, updated_at)
    VALUES (${identityKey}::text, ${person.id}::bigint, now(), now())
    ON CONFLICT (identity_key) DO UPDATE SET
      person_id = EXCLUDED.person_id, lead_id = NULL, claimed_at = now(), updated_at = now()
    WHERE inbound_conversation_claims.claimed_at < now() - interval '30 seconds'
      OR (
        inbound_conversation_claims.lead_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM leads l WHERE l.id = inbound_conversation_claims.lead_id
            AND l.completed_at IS NULL AND l.status NOT IN ('lost','spam')
            AND l.routed_to_lead_id IS NULL
        )
      )
    RETURNING identity_key`) as { identity_key: string }[]
  if (!claim[0]) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 125 + attempt * 50))
      const resolved = (await sql`
        SELECT claim.lead_id, lead.service FROM inbound_conversation_claims claim
        JOIN leads lead ON lead.id = claim.lead_id
        WHERE claim.identity_key = ${identityKey}::text
          AND lead.completed_at IS NULL AND lead.status NOT IN ('lost','spam')
          AND lead.routed_to_lead_id IS NULL
        LIMIT 1`) as Array<{ lead_id: number; service: string }>
      if (resolved[0]?.lead_id) return {
        person,
        leadId: Number(resolved[0].lead_id),
        createdLead: false,
        routing: resolved[0].service === "Needs job match" ? "needs-job-match" : "existing",
      }
    }
    const lateResolution = await findOpenLeadResolutionForPerson(person.id, person.is_test)
    if (lateResolution.leadId) return {
      person,
      leadId: lateResolution.leadId,
      createdLead: false,
      routing: lateResolution.needsJobMatch ? "needs-job-match" : "existing",
    }
    throw new Error("This caller is already being attached to a work order. Retry the signed webhook.")
  }

  const created = await createLead(
    {
      firstName: person.display_name || displayName,
      lastName: "",
      phone,
      email: "",
      service: openLead.ambiguous ? "Needs job match" : input.source === "phone-in" ? "Inbound phone request" : "Inbound text request",
      message: openLead.ambiguous
        ? `Customer has multiple active jobs. Filed separately so this message is not attached to the wrong work order.\n\n${input.body?.trim().slice(0, 1800) || "Customer contacted the shop."}`
        : input.body?.trim().slice(0, 2000) || "Customer contacted the shop.",
      preferredContact: input.source === "phone-in" ? "Call" : "Text",
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
      userAgent: "twilio-webhook",
      isTest,
    },
    { sourceOverride: input.source, actor: "system", firstResponseNow: false }
  )
  await attachLeadToPerson(created.id, person.id)
  await sql`
    UPDATE inbound_conversation_claims SET lead_id = ${created.id}::bigint, updated_at = now()
    WHERE identity_key = ${identityKey}::text AND person_id = ${person.id}::bigint`
  return { person, leadId: created.id, createdLead: true, routing: openLead.ambiguous ? "needs-job-match" : "new" }
}

export async function resolveEmailConversation(input: {
  messageId: string
  threadId: string
  senderEmail: string
  receivedAt: string
  email: string
  displayName?: string
  body?: string
  isTest?: boolean
  source: "email-in" | "email-out"
}) {
  const isTest = input.isTest ?? (input.body?.includes("[INTERNAL TEST]") ?? false)
  const person = await findOrCreatePerson({
    email: input.email,
    displayName: input.displayName || input.email.split("@")[0],
    isTest,
  })
  if (!person) throw new Error("Customer record could not be created.")
  const intakeKey = `gmail:${input.messageId}`
  const sql = getSql()
  let [saved] = (await sql`
    SELECT id FROM leads WHERE intake_key = ${intakeKey}::text LIMIT 1`) as { id: number }[]
  const leadMessage = input.body?.slice(0, 2000) || "Customer emailed the shop."
  // Give a legacy lead the durable key so createLead can resume its attachment
  // and creation receipt, including if this run is interrupted again.
  if (!saved) {
    [saved] = (await sql`
      WITH legacy_matches AS (
        SELECT lead_id, 1 AS priority
        FROM events
        WHERE kind IN ('email.in', 'email.out') AND external_id = ${input.messageId}::text
        UNION ALL
        SELECT lead_id, 1 FROM ingest_attachments
        WHERE provider = 'gmail' AND external_message_id = ${input.messageId}::text
        UNION ALL
        SELECT lead_id, 2 FROM external_threads
        WHERE provider = 'gmail' AND external_thread_id = ${input.threadId}::text
        UNION ALL
        SELECT lead_id, 2 FROM events
        WHERE kind IN ('email.in', 'email.out') AND detail->>'threadId' = ${input.threadId}::text
        UNION ALL
        SELECT id, 3 FROM leads
        WHERE source = ${input.source}::text AND lower(email) = lower(${input.email}::text)
          AND created_at >= ${input.receivedAt}::timestamptz - interval '5 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM events
            WHERE events.lead_id = leads.id AND events.kind IN ('email.in', 'email.out')
          )
      )
      UPDATE leads SET intake_key = ${intakeKey}::text
      WHERE intake_key = '' AND person_id IS NULL AND id = (
        SELECT candidate.id FROM legacy_matches evidence
        JOIN leads candidate ON candidate.id = evidence.lead_id
        WHERE candidate.intake_key = '' AND candidate.person_id IS NULL
          AND candidate.is_test = ${isTest}::boolean
        ORDER BY evidence.priority,
          (candidate.message = ${leadMessage}::text) DESC,
          candidate.id
        LIMIT 1
      )
      RETURNING id`) as { id: number }[]
  }
  if (!saved) {
    const existingLead = await findRecentOpenLeadForPerson(person.id, person.is_test)
    if (existingLead) return { person, leadId: existingLead, createdLead: false }
  }
  const created = await createLead({
    firstName: person.display_name || input.displayName || "Email customer",
    lastName: "",
    phone: person.phones?.[0] ?? "",
    email: input.email,
    service: "Email request",
    message: leadMessage,
    preferredContact: "Email",
    photoCount: 0,
    gclid: "", utmSource: "", utmMedium: "", utmCampaign: "", utmTerm: "", utmContent: "",
    landingPage: "", referrer: "", ip: "", userAgent: "gmail-ingest",
    isTest,
  }, { sourceOverride: input.source, actor: "system", firstResponseNow: input.source === "email-out", intakeKey, personId: person.id })
  const leadPerson = created.personId !== null && Number(created.personId) !== Number(person.id)
    ? await getPerson(created.personId)
    : person
  if (!leadPerson || leadPerson.is_test !== created.isTest) throw new Error("The Gmail lead's customer record could not be recovered.")
  // A legacy thread can already have mail even when its mapping was never saved.
  // Check the receipts on keyed replays too, since adoption can outlive a crash.
  const [priorThreadReceipt] = saved ? (await sql`
    SELECT id FROM events
    WHERE lead_id = ${created.id}::bigint AND kind IN ('email.in', 'email.out')
      AND external_id IS DISTINCT FROM ${input.messageId}::text
      AND detail->>'threadId' = ${input.threadId}::text
    LIMIT 1`) as { id: number }[] : []
  return { person: leadPerson, leadId: created.id, createdLead: !priorThreadReceipt }
}

/** Recovers a call if the after-response enrichment was interrupted. */
export async function reconcileRawInboundCalls(limit = 20) {
  const sql = getSql()
  const rows = (await sql`
    SELECT twilio_sid, from_phone, detail
    FROM calls
    WHERE direction = 'in'
      AND (
        lower(COALESCE(detail->>'reconciliationHandled', 'false')) <> 'true'
        OR NOT EXISTS (
          SELECT 1 FROM events
          WHERE kind = 'call.in' AND external_id = calls.twilio_sid
        )
      )
      AND started_at < now() - interval '2 minutes'
    ORDER BY started_at ASC LIMIT ${Math.min(Math.max(limit, 1), 50)}::bigint`) as Array<{
      twilio_sid: string
      from_phone: string
      detail: { callerName?: string; isTest?: boolean } | null
  }>
  let recovered = 0
  for (const row of rows) {
    const isTest = Boolean(row.detail?.isTest || row.detail?.callerName?.includes("[INTERNAL TEST]"))
    const prepared = await prepareInboundCallIntake({
      callSid: row.twilio_sid,
      phone: row.from_phone,
      callerName: row.detail?.callerName,
      isTest,
    })
    const person = prepared.person
    const leadId = prepared.kind === "existing" ? prepared.leadId : null
    const normalized = normalizePhone(row.from_phone)
    const name = person?.display_name || row.detail?.callerName || (normalized ? `Caller ${normalized.slice(-4)}` : "Private caller")
    const eventId = await persistInboundCallReceipt({
      callSid: row.twilio_sid,
      actorId: person?.id ?? "",
      leadId,
      personId: person?.id ?? null,
      body: `${name} called the shop`,
      crewBody: `${name} called the shop`,
      detail: { recovered: true, intake: prepared.kind, isTest },
    })
    const notificationRequired = !person?.is_test
      && !(prepared.kind === "draft" && prepared.draft.is_test)
    if (notificationRequired) await notifyAll({
      priority: "interrupt",
      stock: "white",
      title: `${name} called`,
      body: prepared.kind === "draft" ? "The call is safe. Tap Save call as job when you are ready." : "Their active job is ready.",
      crewBody: prepared.kind === "draft" ? "The call is safe. Tap Save call as job when you are ready." : "Their active job is ready.",
      url: prepared.kind === "draft" ? `/ops/intake/${prepared.draft.public_id}` : `/ops/leads/${prepared.leadId}`,
      sourceEventId: eventId,
      capExempt: true,
      quietHoursExempt: true,
      smsFallback: true,
      dedupeKey: inboundCallNotificationDedupeKey(row.twilio_sid),
    })
    const handled = await markInboundCallReconciliationHandled({
      callSid: row.twilio_sid,
      eventId,
      notificationRequired,
    })
    if (!handled) continue
    recovered += 1
  }
  return { scanned: rows.length, recovered }
}
