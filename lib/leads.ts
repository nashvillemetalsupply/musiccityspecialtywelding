import { getSql } from "@/lib/db"
import { isSafeRasterImage } from "@/lib/media-safety"
import { recordEvent } from "@/lib/events"
import { attachLeadToPerson, findOrCreatePerson, isReservedShopPhone, normalizePhone } from "@/lib/people"

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

export function deriveLeadSource(input: {
  gclid: string
  utmSource: string
  utmMedium: string
  referrer: string
}): string {
  if (input.gclid) return "google-ads"
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

export async function createLead(
  input: NewLeadInput,
  options: {
    sourceOverride?: string
    actor?: string
    firstResponseNow?: boolean
    intakeKey?: string
    webTextConsent?: { phoneE164: string; provenance: Record<string, unknown> }
  } = {}
): Promise<{ id: number; publicId: string; eventId: number | null; reused: boolean }> {
  const sql = getSql()
  const source = options.sourceOverride ?? deriveLeadSource(input)
  const intakeKey = options.intakeKey?.trim().slice(0, 180) ?? ""
  const webTextConsent = options.webTextConsent
    ? { phoneE164: normalizePhone(options.webTextConsent.phoneE164), provenance: options.webTextConsent.provenance }
    : null
  if (options.webTextConsent && (!webTextConsent?.phoneE164 || isReservedShopPhone(webTextConsent.phoneE164) || input.isTest)) {
    throw new Error("Web text consent requires a valid customer phone and a non-test lead.")
  }
  let id: number | null = null
  let publicId = ""
  let reused = false
  let existingSnapshot: {
    id: number
    public_id: string
    first_name: string
    last_name: string
    phone: string
    email: string
    message: string
    source: string
    is_test: boolean
  } | null = null

  if (intakeKey) {
    const existing = (await sql`
      SELECT id, public_id, first_name, last_name, phone, email, message, source, is_test
      FROM leads WHERE intake_key = ${intakeKey}::text LIMIT 1`) as {
      id: number
      public_id: string
      first_name: string
      last_name: string
      phone: string
      email: string
      message: string
      source: string
      is_test: boolean
    }[]
    if (existing[0]) {
      id = Number(existing[0].id)
      publicId = existing[0].public_id
      reused = true
      existingSnapshot = existing[0]
    }
  }

  // The 4-char suffix can collide against the UNIQUE constraint; retry with a
  // fresh id instead of dropping the durable copy of a lead.
  for (let attempt = 0; attempt < 3 && id === null; attempt++) {
    publicId = makePublicId(new Date())
    try {
      const rows = (await sql`
        WITH inserted_lead AS (
          INSERT INTO leads (
            public_id, first_name, last_name, phone, email, service, message,
            preferred_contact, photo_count, source, gclid, utm_source, utm_medium,
            utm_campaign, utm_term, utm_content, landing_page, referrer, ip,
            user_agent, is_test, phone_is_placeholder, first_response_at, first_response_channel, status, intake_key
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
            ${intakeKey}::text
          )
          RETURNING id, public_id
        ), captured_consent AS (
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
        )
        SELECT inserted_lead.id, inserted_lead.public_id
        FROM inserted_lead
        LEFT JOIN captured_consent ON true`) as { id: number; public_id: string }[]
      id = rows[0].id
      publicId = rows[0].public_id
    } catch (error) {
      const isUniqueViolation =
        typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"
      if (!isUniqueViolation) throw error
      if (intakeKey) {
        const existing = (await sql`
          SELECT id, public_id, first_name, last_name, phone, email, message, source, is_test
          FROM leads WHERE intake_key = ${intakeKey}::text LIMIT 1`) as {
          id: number
          public_id: string
          first_name: string
          last_name: string
          phone: string
          email: string
          message: string
          source: string
          is_test: boolean
        }[]
        if (existing[0]) {
          id = Number(existing[0].id)
          publicId = existing[0].public_id
          reused = true
          existingSnapshot = existing[0]
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
  if (reused && existingSnapshot && webTextConsent) {
    if (existingSnapshot.is_test || normalizePhone(existingSnapshot.phone) !== webTextConsent.phoneE164) {
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
        isTest: input.isTest,
      }
  const person = await findOrCreatePerson({
    ...identity,
    leadId: id!,
  })
  if (person) await attachLeadToPerson(id!, person.id)
  const priorCreated = reused ? (await sql`
    SELECT id FROM events WHERE lead_id = ${id!}::bigint AND kind = 'form.quote' LIMIT 1`) as { id: number }[] : []
  const eventId = priorCreated[0] ? null : await recordLeadEvent(id!, "created", options.actor ?? "system", {
    source: existingSnapshot?.source ?? source,
    isTest: existingSnapshot?.is_test ?? input.isTest,
    message: existingSnapshot?.message ?? input.message,
  })
  return { id: id!, publicId, eventId, reused }
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
    await sql`
      INSERT INTO lead_photo_intents (
        lead_id, intake_key, photo_index, target_path, filename, content_type, size_bytes
      ) VALUES (
        ${leadId}::bigint, ${intakeKey}::text, ${photo.photoIndex}::int,
        ${photo.targetPath}::text, ${photo.filename}::text, ${photo.contentType}::text,
        ${photo.size}::bigint
      ) ON CONFLICT (lead_id, intake_key, photo_index) DO UPDATE SET
        target_path = EXCLUDED.target_path,
        filename = EXCLUDED.filename,
        content_type = EXCLUDED.content_type,
        size_bytes = EXCLUDED.size_bytes,
        updated_at = now()`
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
  detail: Record<string, unknown> | null = null
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
    externalId: "",
    body,
    detail: { ...(detail ?? {}), legacyType: type, ...(isTest ? { isTest: true } : {}) },
  })
}

export async function markLeadDelivery(
  leadId: number,
  status: "accepted" | "failed",
  error?: string
) {
  const sql = getSql()
  if (status === "accepted") {
    await sql`
      UPDATE leads SET
        email_delivery_status = CASE
          WHEN email_delivery_status = ANY(ARRAY['failed','sent','delivered']::text[]) THEN email_delivery_status
          ELSE 'accepted'
        END,
        email_delivery_error = CASE
          WHEN email_delivery_status = 'failed' THEN email_delivery_error
          ELSE ''
        END,
        updated_at = now()
      WHERE id = ${leadId}::bigint`
  } else {
    await sql`
      UPDATE leads SET email_delivery_status = 'failed',
        email_delivery_error = ${error ?? "unknown"}::text, updated_at = now()
      WHERE id = ${leadId}::bigint`
  }
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
    await sql`DELETE FROM rate_limits WHERE ts < now() - interval '1 day'`
    await sql`INSERT INTO rate_limits (key) VALUES (${key}::text)`
    const rows = (await sql`
      SELECT count(*)::int AS count FROM rate_limits
      WHERE key = ${key}::text AND ts >= ${windowStart}::timestamptz`) as { count: number }[]
    return rows[0].count > maxRequests
  } catch {
    return false
  }
}
