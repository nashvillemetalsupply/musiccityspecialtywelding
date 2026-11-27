import { getSql } from "@/lib/db"
import { isSafeRasterImage } from "@/lib/media-safety"
import { recordEvent } from "@/lib/events"
import { attachLeadToPerson, findOrCreatePerson, isReservedShopPhone, normalizePhone } from "@/lib/people"
import { getDefaultFollowUpAt } from "@/lib/follow-up-cadence.ts"

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "quoted",
  "won",
  "lost",
  "spam",
] as const

export type LeadStatus = (typeof LEAD_STATUSES)[number]

export type LeadRow = {
  id: number
  public_id: string
  created_at: string
  updated_at: string
  first_name: string
  last_name: string
  phone: string
  phone_is_placeholder: boolean
  email: string
  service: string
  message: string
  crew_message: string | null
  preferred_contact: string
  photo_count: number
  source: string
  gclid: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_term: string
  utm_content: string
  landing_page: string
  referrer: string
  ip: string
  user_agent: string
  is_test: boolean
  status: LeadStatus
  status_reason: string
  first_response_at: string | null
  first_response_channel: string
  next_follow_up_at: string | null
  follow_up_notified_at: string | null
  person_id: number | null
  assigned_operator_id: number | null
  assigned_operator_name: string
  routed_to_lead_id: number | null
  photos: { pathname: string; contentType: string; size: number; name: string }[]
  invoice_number: string
  invoiced_at: string | null
  invoice_due_at: string | null
  invoice_pay_url: string
  paid_at: string | null
  paid_amount_cents: number | null
  invoice_total_cents: number | null
  estimate_value_cents: number | null
  quoted_at: string | null
  won_at: string | null
  lost_at: string | null
  revenue_cents: number | null
  completed_at: string | null
  handed_off_at: string | null
  review_requested_at: string | null
  review_received: boolean
  notes: string
  crew_notes: string | null
  email_delivery_status: string
  email_delivery_error: string
  email_delivered_at: string | null
  glass_caption_draft: string
  glass_caption_approved_at: string | null
  scheduled_at: string | null
  work_started_at: string | null
  person_job_count?: number
  intake_key: string
}

export type NewLeadInput = {
  firstName: string
  lastName: string
  phone: string
  email: string
  service: string
  message: string
  preferredContact: string
  photoCount: number
  gclid: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm: string
  utmContent: string
  landingPage: string
  referrer: string
  ip: string
  userAgent: string
  isTest: boolean
}

// Google stamps most ad clicks with gclid, but iOS and other limited-signal
// clicks arrive carrying only gbraid or wbraid. Lead #161 on 2026-08-25 was a
// real ad click filed as "direct" for exactly that reason, which is how a paid
// lead disappears from the paid column. The landing page holds the evidence
// either way, so read it when gclid is absent.
const AD_CLICK_MARKERS = ["gclid=", "gbraid=", "wbraid=", "gad_source="]

export function landingPageIsAdClick(landingPage: string): boolean {
  const value = (landingPage || "").toLowerCase()
  return AD_CLICK_MARKERS.some((marker) => value.includes(marker))
}

export function deriveLeadSource(input: {
  gclid: string
  utmSource: string
  utmMedium: string
  referrer: string
  landingPage?: string
}): string {
  if (input.gclid) return "google-ads"
  if (landingPageIsAdClick(input.landingPage ?? "")) return "google-ads"
  if (input.utmSource) {
    return input.utmMedium ? `${input.utmSource}/${input.utmMedium}` : input.utmSource
  }
  if (input.referrer) {
    try {
      const host = new URL(input.referrer).hostname
      if (host.includes("google.")) return "google-organic"
      if (host.includes("bing.")) return "bing-organic"
      if (host.includes("facebook.") || host.includes("fb.")) return "facebook"
      if (host.includes("musiccityspecialtywelding.com")) return "direct"
      return `referral:${host}`
    } catch {
      return "referral"
    }
  }
  return "direct"
}

function makePublicId(now: Date) {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "")
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `L-${stamp}-${rand}`
}

type SavedIntakeLead = Pick<LeadRow, "id" | "public_id" | "person_id" | "created_at" | "first_name" | "last_name"
  | "phone" | "email" | "service" | "message" | "preferred_contact" | "photo_count" | "source" | "is_test"
  | "gclid" | "utm_source" | "referrer"> & {
  quote_photos?: { count: number; fingerprints: string[] } | null
}

export class LeadIntakePhoneConflict extends Error {}

export async function createLead(
  input: NewLeadInput,
  options: {
    sourceOverride?: string
    actor?: string
    firstResponseNow?: boolean
    intakeKey?: string
    personId?: number
    quoteIntake?: boolean
    quotePhotoFingerprints?: string[]
    webTextConsent?: { phoneE164: string; provenance: Record<string, unknown> }
  } = {}
) {
  const sql = getSql()
  const source = options.sourceOverride ?? deriveLeadSource(input)
  const intakeKey = options.intakeKey?.trim().slice(0, 180) ?? ""
  const webTextConsent = options.webTextConsent
    ? { phoneE164: normalizePhone(options.webTextConsent.phoneE164), provenance: options.webTextConsent.provenance }
    : null
  const expectedPhone = webTextConsent?.phoneE164 ?? (options.quoteIntake ? normalizePhone(input.phone) : null)
  const readExistingIntake = async () => {
    const [saved] = (await sql`
      SELECT id, public_id, person_id, first_name, last_name, phone, email, service,
        message, preferred_contact, photo_count, source, is_test, created_at, gclid, utm_source, referrer,
        (SELECT jsonb_build_object('count', original_photo_count, 'fingerprints', photo_fingerprints)
          FROM quote_intakes WHERE quote_intakes.intake_key = leads.intake_key AND lead_id = leads.id) AS quote_photos
      FROM leads WHERE intake_key = ${intakeKey}::text LIMIT 1`) as SavedIntakeLead[]
    if (saved && expectedPhone !== null && normalizePhone(saved.phone) !== expectedPhone) {
      throw new LeadIntakePhoneConflict("That saved intake does not match this text-permission request.")
    }
    if (saved && options.personId !== undefined && saved.is_test !== input.isTest) {
      throw new Error("That saved intake belongs to a different test partition.")
    }
    return saved ?? null
  }
  let existingSnapshot = intakeKey ? await readExistingIntake() : null
  if (options.webTextConsent && (!webTextConsent?.phoneE164 || isReservedShopPhone(webTextConsent.phoneE164) || input.isTest)) {
    throw new Error("Web text consent requires a valid customer phone and a non-test lead.")
  }
  let id = existingSnapshot ? Number(existingSnapshot.id) : null
  let publicId = existingSnapshot?.public_id ?? ""
  let insertedIsTest = input.isTest
  let insertedSnapshot: SavedIntakeLead | null = null

  const defaultFollowUpAt = id === null ? await getDefaultFollowUpAt(sql) : null

  // The 4-char suffix can collide against the UNIQUE constraint; retry with a
  // fresh id instead of dropping the durable copy of a lead.
  for (let attempt = 0; attempt < 3 && id === null; attempt++) {
    publicId = makePublicId(new Date())
    try {
      const rows = (await sql`
        WITH inserted_lead AS MATERIALIZED (
          INSERT INTO leads (
            public_id, first_name, last_name, phone, email, service, message,
            preferred_contact, photo_count, source, gclid, utm_source, utm_medium,
            utm_campaign, utm_term, utm_content, landing_page, referrer, ip,
            user_agent, is_test, phone_is_placeholder, first_response_at, first_response_channel, status, intake_key,
            next_follow_up_at
          ) VALUES (
            ${publicId}::text, ${input.firstName}::text, ${input.lastName}::text, ${input.phone}::text,
            ${input.email}::text, ${input.service}::text, ${input.message}::text,
            ${input.preferredContact}::text, ${input.photoCount}::int, ${source}::text, ${input.gclid}::text,
            ${input.utmSource}::text, ${input.utmMedium}::text, ${input.utmCampaign}::text,
            ${input.utmTerm}::text, ${input.utmContent}::text, ${input.landingPage}::text,
            ${input.referrer}::text, ${input.ip}::text, ${input.userAgent}::text, ${input.isTest}::boolean,
            ${isReservedShopPhone(input.phone)}::boolean,
            ${options.firstResponseNow ? new Date().toISOString() : null}::timestamptz,
            ${options.firstResponseNow ? "phone" : ""}::text,
            ${options.firstResponseNow ? "contacted" : "new"}::text,
            ${intakeKey}::text,
            ${defaultFollowUpAt}::timestamptz
          )
          RETURNING id, public_id, person_id, first_name, last_name, phone, email, service,
            message, preferred_contact, photo_count, source, is_test, created_at, gclid, utm_source, referrer, intake_key
        ), captured_consent AS MATERIALIZED (
          INSERT INTO messaging_consents (
            phone_e164, lead_id, source, effect, external_id, occurred_at, provenance
          )
          SELECT
            ${webTextConsent?.phoneE164 ?? ""}::text,
            inserted_lead.id,
            'web',
            'granted',
            ('quote-consent:' || inserted_lead.public_id),
            now(),
            ${JSON.stringify(webTextConsent?.provenance ?? {})}::jsonb
          FROM inserted_lead
          WHERE ${Boolean(webTextConsent)}::boolean
          ON CONFLICT (external_id) DO NOTHING
          RETURNING id
        ), captured_quote_intake AS (
          INSERT INTO quote_intakes (intake_key, lead_id, original_photo_count, photo_fingerprints, environment)
          SELECT intake_key, id, ${input.photoCount}::int, ${JSON.stringify(options.quotePhotoFingerprints ?? null)}::jsonb,
            ${process.env.VERCEL_ENV === "production" ? "production" : "preview"}::text
          FROM inserted_lead
          WHERE ${options.quotePhotoFingerprints !== undefined}::boolean
        )
        SELECT inserted_lead.*
        FROM inserted_lead
        LEFT JOIN captured_consent ON true`) as SavedIntakeLead[]
      id = rows[0].id
      publicId = rows[0].public_id
      insertedIsTest = rows[0].is_test
      insertedSnapshot = rows[0]
    } catch (error) {
      const isUniqueViolation =
        typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"
      if (!isUniqueViolation) throw error
      if (intakeKey) {
        existingSnapshot = await readExistingIntake()
        if (existingSnapshot) {
          id = Number(existingSnapshot.id)
          publicId = existingSnapshot.public_id
        }
      }
      if (id === null && attempt === 2) throw error
    }
  }

  // A browser may retry the same durable intake after losing the response and
  // add optional SMS consent before that retry. Reuse the lead identity, but
  // append the newly supplied consent only when it still matches the original
  // customer phone. Never let a replayed intake key grant consent to a
  // different number or create a second person record from changed fields.
  if (existingSnapshot && webTextConsent) {
    if (existingSnapshot.is_test) {
      throw new Error("That saved intake does not match this text-permission request.")
    }
    await sql`
      INSERT INTO messaging_consents (
        phone_e164, lead_id, source, effect, external_id, occurred_at, provenance
      ) VALUES (
        ${webTextConsent.phoneE164}::text,
        ${id!}::bigint,
        'web',
        'granted',
        ${`quote-consent:${publicId}`}::text,
        now(),
        ${JSON.stringify(webTextConsent.provenance)}::jsonb
      ) ON CONFLICT (external_id) DO NOTHING`
  }

  const identity = existingSnapshot
    ? {
        phone: existingSnapshot.phone,
        email: existingSnapshot.email,
        displayName: `${existingSnapshot.first_name} ${existingSnapshot.last_name}`.trim(),
        isTest: existingSnapshot.is_test,
      }
    : {
        phone: input.phone,
        email: input.email,
        displayName: `${input.firstName} ${input.lastName}`.trim(),
        isTest: insertedIsTest,
      }
  // Quote delivery can proceed from the committed lead if its person or
  // creation event cannot be resolved. A retry can finish either step.
  let personId = existingSnapshot?.person_id ?? null
  try {
    if (options.personId === undefined || personId === null) {
      const matchedPersonId = options.personId ?? (await findOrCreatePerson({ ...identity, leadId: id! }))?.id
      if (matchedPersonId !== undefined) {
        await attachLeadToPerson(id!, matchedPersonId)
        personId ??= matchedPersonId
      }
    }
  } catch (error) {
    if (!options.quoteIntake) throw error
    console.error("Quote lead person resolution failed:", error)
  }
  let eventId: number | null = null
  try {
    const priorCreated = existingSnapshot ? (await sql`
      SELECT id FROM events WHERE lead_id = ${id!}::bigint AND kind = 'form.quote' LIMIT 1`) as { id: number }[] : []
    if (!priorCreated[0]) {
      eventId = await recordLeadEvent(id!, "created", options.actor ?? "system", {
        source: existingSnapshot?.source ?? source,
        isTest: identity.isTest,
        message: existingSnapshot?.message ?? input.message,
      }, options.quoteIntake ? { externalId: `quote-created:${id}` } : undefined)
    }
  } catch (error) {
    if (!options.quoteIntake) throw error
    console.error("Quote lead creation event failed:", error)
  }
  return {
    id: id!,
    publicId,
    eventId,
    reused: existingSnapshot !== null,
    existingSnapshot,
    intakeSnapshot: (existingSnapshot ?? insertedSnapshot)!,
    personId,
    isTest: identity.isTest,
  }
}

export async function recoverMissingQuoteEvents() {
  const sql = getSql()
  const missing = (await sql`
    SELECT l.id, l.source, l.message, l.created_at FROM leads l
    LEFT JOIN sync_state repair ON repair.key = 'quote-event-repair:' || l.id::text
    WHERE l.intake_key LIKE 'website:%' AND l.created_at < now() - interval '10 minutes'
      AND (repair.updated_at IS NULL OR repair.updated_at <= now() - interval '15 minutes')
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.lead_id = l.id AND e.kind = 'form.quote')
    ORDER BY COALESCE(repair.updated_at, l.created_at), l.id LIMIT 20`) as Pick<LeadRow, "id" | "source" | "message" | "created_at">[]
  const eventIds: number[] = []
  const failures: { leadId: number; error: string }[] = []
  for (const lead of missing) {
    try {
      const claimed = (await sql`
        INSERT INTO sync_state (key, updated_at)
        VALUES (${`quote-event-repair:${lead.id}`}::text, now())
        ON CONFLICT (key) DO UPDATE SET updated_at = EXCLUDED.updated_at
        WHERE sync_state.updated_at <= now() - interval '15 minutes'
        RETURNING key`) as { key: string }[]
      if (!claimed[0]) continue
      const eventId = await recordLeadEvent(lead.id, "created", "system", {
        source: lead.source, message: lead.message,
      }, { externalId: `quote-created:${lead.id}`, occurredAt: lead.created_at })
      if (eventId !== null) eventIds.push(eventId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ leadId: lead.id, error: message.slice(0, 300) })
      console.error("Quote event repair failed:", lead.id, error)
    }
  }
  return { eventIds, failures }
}

export async function attachLeadPhotos(
  leadId: number,
  photos: { pathname: string; contentType: string; size: number; name: string; sensitivity?: string }[],
  options: { externalId?: string } = {},
) {
  const safePhotos = photos.map((photo) => ({ ...photo, sensitivity: isSafeRasterImage(photo.contentType) ? "photo" : photo.sensitivity ?? "unclassified" }))
  const sql = getSql()
  const rows = (await sql`
    WITH target AS (
      SELECT id, COALESCE(photos, '[]'::jsonb) AS photos
      FROM leads WHERE id = ${leadId}::bigint FOR UPDATE
    ), fresh AS (
      SELECT COALESCE(jsonb_agg(incoming.photo), '[]'::jsonb) AS photos
      FROM target t
      CROSS JOIN LATERAL jsonb_array_elements(${JSON.stringify(safePhotos)}::jsonb) incoming(photo)
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(t.photos) existing(photo)
        WHERE existing.photo->>'pathname' = incoming.photo->>'pathname'
      )
    )
    UPDATE leads l SET
      photos = t.photos || fresh.photos,
      photo_count = jsonb_array_length(t.photos || fresh.photos),
      updated_at = CASE WHEN jsonb_array_length(fresh.photos) > 0 THEN now() ELSE l.updated_at END
    FROM target t CROSS JOIN fresh
    WHERE l.id = t.id
    RETURNING jsonb_array_length(fresh.photos)::int AS added`) as { added: number }[]
  const added = Number(rows[0]?.added ?? 0)
  if (!added) return
  await recordEvent({
    kind: "photo.added",
    actorType: "system",
    leadId,
    externalId: options.externalId,
    body: `${added} job photo${added === 1 ? "" : "s"} attached`,
    detail: { photos: safePhotos },
  })
}

export type LeadPhotoIntentStatus = "pending" | "stored" | "attached" | "failed"

export async function reserveLeadPhotoIntents(
  leadId: number,
  intakeKey: string,
  photos: Array<{ photoIndex: number; targetPath: string; filename: string; contentType: string; size: number }>,
) {
  const sql = getSql()
  for (const photo of photos) {
    const rows = (await sql`
      INSERT INTO lead_photo_intents (
        lead_id, intake_key, photo_index, target_path, filename, content_type, size_bytes
      ) VALUES (
        ${leadId}::bigint, ${intakeKey}::text, ${photo.photoIndex}::int,
        ${photo.targetPath}::text, ${photo.filename}::text, ${photo.contentType}::text,
        ${photo.size}::bigint
      ) ON CONFLICT (lead_id, intake_key, photo_index) DO UPDATE SET
        updated_at = now()
      WHERE lead_photo_intents.target_path = EXCLUDED.target_path
        AND lead_photo_intents.filename = EXCLUDED.filename
        AND lead_photo_intents.content_type = EXCLUDED.content_type
        AND lead_photo_intents.size_bytes = EXCLUDED.size_bytes
      RETURNING id`) as { id: number }[]
    if (!rows[0]) throw new Error("Reserved quote photo does not match the original attachment")
  }
}

export async function markLeadPhotoIntent(
  leadId: number,
  intakeKey: string,
  photoIndex: number,
  status: LeadPhotoIntentStatus,
  detail: { storedPathname?: string; error?: string } = {},
) {
  const sql = getSql()
  await sql`
    UPDATE lead_photo_intents SET
      status = ${status}::text,
      stored_pathname = CASE
        WHEN ${detail.storedPathname ?? ""}::text <> '' THEN ${detail.storedPathname ?? ""}::text
        ELSE stored_pathname
      END,
      error = ${detail.error?.slice(0, 500) ?? ""}::text,
      updated_at = now()
    WHERE lead_id = ${leadId}::bigint AND intake_key = ${intakeKey}::text
      AND photo_index = ${photoIndex}::int`
}

export async function recordLeadEvent(
  leadId: number,
  type: string,
  actor: string,
  detail: Record<string, unknown> | null = null,
  options: { externalId?: string; occurredAt?: string } = {},
): Promise<number | null> {
  const sql = getSql()
  const people = (await sql`
    SELECT person_id, is_test FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as {
    person_id: number | null
    is_test: boolean
  }[]
  const rawBody =
    typeof detail?.note === "string"
      ? detail.note
      : typeof detail?.message === "string"
        ? detail.message
        : typeof detail?.reason === "string"
          ? detail.reason
          : ""
  const isTest = people[0]?.is_test === true
  const body = isTest && !rawBody.includes("[INTERNAL TEST]")
    ? `[INTERNAL TEST] ${rawBody}`.trim()
    : rawBody
  const kindMap: Record<string, string> = {
    created: "form.quote",
    status_changed: "status.changed",
    notes_saved: "note.text",
    first_response: "contact.first-response",
    interaction: "contact.logged",
    estimate_saved: "quote.saved",
    estimate_emailed: "email.out",
    thankyou_emailed: "email.out",
    outcome_saved: "job.outcome",
    invoice_recorded: "invoice.recorded",
    review_tracked: "review.tracked",
    completed: "job.completed",
    completion_undone: "job.completion-undone",
    handoff_completed: "job.handed-off",
    handoff_undone: "job.handoff-undone",
  }
  return recordEvent({
    kind: kindMap[type] ?? `lead.${type.replace(/_/g, ".")}`,
    actorType: actor === "system" ? "system" : "operator",
    actorId: actor === "system" ? "" : actor,
    leadId,
    personId: people[0]?.person_id ?? null,
    externalId: options.externalId ?? "",
    occurredAt: options.occurredAt,
    body,
    detail: { ...(detail ?? {}), legacyType: type, ...(isTest ? { isTest: true } : {}) },
  })
}

export async function markLeadDelivery(
  leadId: number,
  status: "accepted" | "failed" | "bounced" | "delayed" | "delivered",
  error?: string
) {
  const sql = getSql()
  // Old leads used "failed" for request rejection too. A signed provider
  // failure receipt makes that status survive later callbacks.
  await sql`
    WITH incoming AS (SELECT ${status}::text AS status, ${error ?? "unknown"}::text AS error)
    UPDATE leads SET
      email_delivery_status = CASE incoming.status
        WHEN 'failed' THEN 'rejected'
        WHEN 'bounced' THEN 'failed'
        ELSE incoming.status
      END,
      email_delivery_error = CASE
        WHEN incoming.status IN ('failed','bounced') THEN incoming.error
        ELSE ''
      END,
      email_delivered_at = CASE
        WHEN incoming.status = 'delivered' THEN COALESCE(email_delivered_at, now())
        ELSE email_delivered_at
      END,
      updated_at = now()
    FROM incoming
    WHERE leads.id = ${leadId}::bigint AND (
      incoming.status = 'bounced'
      OR (
        NOT EXISTS (
          SELECT 1 FROM events receipt
          WHERE receipt.lead_id = leads.id AND receipt.kind = 'email.failed'
            AND receipt.detail->>'audience' = 'shop'
            AND receipt.detail->>'providerType' IN ('email.bounced', 'email.complained', 'email.failed', 'email.suppressed')
        )
        AND CASE incoming.status
          WHEN 'failed' THEN email_delivery_status NOT IN ('accepted','sent','delayed','delivered','resolved')
            AND NOT EXISTS (
              SELECT 1 FROM events receipt
              WHERE receipt.lead_id = leads.id AND receipt.kind IN ('email.accepted', 'email.delivered')
                AND receipt.detail->>'audience' = 'shop'
            )
          WHEN 'accepted' THEN email_delivery_status NOT IN ('sent','delayed','delivered')
          WHEN 'delayed' THEN email_delivery_status NOT IN ('sent','delivered')
          ELSE true
        END
      )
    )`
}

// Durable cross-instance rate limiting backed by Postgres. Returns true when
// the caller is over the limit. Failures never block a lead.
export async function isRateLimitedDurable(
  key: string,
  windowMs: number,
  maxRequests: number
): Promise<boolean> {
  try {
    const sql = getSql()
    const windowStart = new Date(Date.now() - windowMs).toISOString()
    await sql`INSERT INTO rate_limits (key) VALUES (${key}::text)`
    const rows = (await sql`
      SELECT count(*)::int AS count FROM rate_limits
      WHERE key = ${key}::text AND ts >= ${windowStart}::timestamptz`) as { count: number }[]
    return rows[0].count > maxRequests
  } catch {
    return false
  }
}
