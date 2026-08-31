import { createLead } from "@/lib/leads"
import {
  attachLeadToPerson,
  findOrCreatePerson,
  findRecentOpenLeadForPerson,
  normalizePhone,
  type PersonRow,
} from "@/lib/people"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notifyAll } from "@/lib/notify"
import { prepareInboundCallIntake } from "@/lib/job-intake"

export { attachRecoveredCallArtifacts } from "@/lib/call-artifacts"

export async function resolvePhoneConversation(input: {
  phone: string
  body?: string
  isTest?: boolean
  source: "phone-in" | "sms-in"
}): Promise<{ person: PersonRow; leadId: number; createdLead: boolean }> {
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
  const existingLead = await findRecentOpenLeadForPerson(person.id, person.is_test)
  if (existingLead) return { person, leadId: existingLead, createdLead: false }

  const sql = getSql()
  const identityKey = `phone:${person.id}`
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
        )
      )
    RETURNING identity_key`) as { identity_key: string }[]
  if (!claim[0]) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 125 + attempt * 50))
      const resolved = (await sql`
        SELECT lead_id FROM inbound_conversation_claims
        WHERE identity_key = ${identityKey}::text AND lead_id IS NOT NULL LIMIT 1`) as { lead_id: number }[]
      if (resolved[0]?.lead_id) return { person, leadId: Number(resolved[0].lead_id), createdLead: false }
    }
    const lateLead = await findRecentOpenLeadForPerson(person.id, person.is_test)
    if (lateLead) return { person, leadId: lateLead, createdLead: false }
    throw new Error("This caller is already being attached to a work order. Retry the signed webhook.")
  }

  const created = await createLead(
    {
      firstName: person.display_name || displayName,
      lastName: "",
      phone,
      email: "",
      service: input.source === "phone-in" ? "Inbound phone request" : "Inbound text request",
      message: input.body?.trim().slice(0, 2000) || "Customer contacted the shop.",
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
  return { person, leadId: created.id, createdLead: true }
}

export async function resolveEmailConversation(input: {
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
  const existingLead = await findRecentOpenLeadForPerson(person.id, person.is_test)
  if (existingLead) return { person, leadId: existingLead, createdLead: false }
  const created = await createLead({
    firstName: person.display_name || input.displayName || "Email customer",
    lastName: "",
    phone: person.phones?.[0] ?? "",
    email: input.email,
    service: "Email request",
    message: input.body?.slice(0, 2000) || "Customer emailed the shop.",
    preferredContact: "Email",
    photoCount: 0,
    gclid: "", utmSource: "", utmMedium: "", utmCampaign: "", utmTerm: "", utmContent: "",
    landingPage: "", referrer: "", ip: "", userAgent: "gmail-ingest",
    isTest,
  }, { sourceOverride: input.source, actor: "system", firstResponseNow: input.source === "email-out" })
  await attachLeadToPerson(created.id, person.id)
  return { person, leadId: created.id, createdLead: true }
}

/** Recovers a call if the after-response enrichment was interrupted. */
export async function reconcileRawInboundCalls(limit = 20) {
  const sql = getSql()
  const rows = (await sql`
    SELECT twilio_sid, from_phone, detail
    FROM calls
    WHERE direction = 'in' AND lead_id IS NULL
      AND lower(COALESCE(detail->>'reconciliationHandled', 'false')) <> 'true'
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
    let eventId = await recordEvent({
      kind: "call.in",
      actorType: "customer",
      actorId: person?.id ?? "",
      leadId,
      personId: person?.id ?? null,
      externalId: row.twilio_sid,
      body: `${name} called the shop`,
      crewBody: `${name} called the shop`,
      detail: { recovered: true, intake: prepared.kind, isTest },
    })
    if (!eventId) {
      const prior = (await sql`SELECT id FROM events WHERE kind = 'call.in' AND external_id = ${row.twilio_sid}::text LIMIT 1`) as { id: number }[]
      eventId = Number(prior[0]?.id) || null
      if (eventId && prepared.kind === "existing") await sql`
        UPDATE events SET lead_id = COALESCE(lead_id, ${prepared.leadId}::bigint),
          person_id = COALESCE(person_id, ${person?.id ?? null}::bigint)
        WHERE id = ${eventId}::bigint`
    }
    if (!person?.is_test && !(prepared.kind === "draft" && prepared.draft.is_test)) await notifyAll({
      priority: "interrupt",
      stock: "white",
      title: `${name} called`,
      body: prepared.kind === "draft" ? "The call is safe. Tap Save call as job when you are ready." : "Their active job is ready.",
      crewBody: prepared.kind === "draft" ? "The call is safe. Tap Save call as job when you are ready." : "Their active job is ready.",
      url: prepared.kind === "draft" ? `/ops/intake/${prepared.draft.public_id}` : `/ops/leads/${prepared.leadId}`,
      sourceEventId: eventId,
      capExempt: prepared.kind === "draft",
      quietHoursExempt: prepared.kind === "draft",
      smsFallback: prepared.kind === "draft",
      dedupeKey: `raw-call-recovered:${row.twilio_sid}`,
    })
    recovered += 1
  }
  return { scanned: rows.length, recovered }
}
