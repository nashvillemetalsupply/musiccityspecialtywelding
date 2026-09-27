import { head } from "@vercel/blob"
import { getSql } from "@/lib/db"
import { requireLeadMutationAccess, type Operator } from "@/lib/operators"

export const CLOSEOUT_PHOTO_MAX_BYTES = 12 * 1024 * 1024
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type CloseoutPhotoMode = "completion" | "addendum"

export type CloseoutPhotoUpload = {
  id: string
  lead_id: number
  operator_id: number
  mode: CloseoutPhotoMode
  pathname: string
  original_name: string
  content_type: string
  size_bytes: number
  is_test: boolean
  status: "pending" | "uploaded" | "attached"
  attached_event_id: number | null
  expires_at: string
}

export function isCloseoutUploadId(value: string) {
  return UPLOAD_ID_PATTERN.test(value)
}

export function sanitizeCloseoutPhotoName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "").slice(-120) || "closeout-image"
}

export function closeoutPhotoPath(id: string, name: string) {
  return `closeouts/${id}-${sanitizeCloseoutPhotoName(name)}`
}

export async function createCloseoutPhotoUpload(input: {
  operator: Operator
  id: string
  leadId: number
  mode: CloseoutPhotoMode
  originalName: string
  contentType: string
  sizeBytes: number
  pathname: string
}) {
  if (!isCloseoutUploadId(input.id)) throw new Error("Invalid closeout photo receipt.")
  if (!Number.isInteger(input.leadId) || input.leadId <= 0) throw new Error("Invalid job.")
  if (input.mode !== "completion" && input.mode !== "addendum") throw new Error("Invalid closeout photo action.")
  const contentType = input.contentType.trim().toLowerCase()
  if (!/^image\/[a-z0-9.+-]+$/.test(contentType)) throw new Error("Choose an image for the closeout photo.")
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > CLOSEOUT_PHOTO_MAX_BYTES) {
    throw new Error("Closeout photos must be an image under 12 MB.")
  }
  const originalName = sanitizeCloseoutPhotoName(input.originalName)
  const pathname = closeoutPhotoPath(input.id, originalName)
  if (input.pathname !== pathname) throw new Error("The closeout photo path is invalid.")

  const access = await requireLeadMutationAccess(input.operator, input.leadId)
  const sql = getSql()
  const leads = (await sql`
    SELECT completed_at, is_test FROM leads WHERE id = ${input.leadId}::bigint LIMIT 1`) as Array<{
      completed_at: string | null
      is_test: boolean
    }>
  const lead = leads[0]
  if (!lead) throw new Error("Job not found.")
  if (access.isTest !== lead.is_test) throw new Error("The job changed while the photo was being authorized. Reload and try again.")
  if (input.mode === "completion" && lead.completed_at) throw new Error("This job is already finished.")
  if (input.mode === "addendum" && !lead.completed_at) throw new Error("Finish the job before adding a closeout photo.")

  const inserted = (await sql`
    INSERT INTO closeout_photo_uploads (
      id, lead_id, operator_id, upload_mode, pathname, original_name,
      content_type, size_bytes, is_test, expires_at
    ) VALUES (
      ${input.id}::text, ${input.leadId}::bigint, ${input.operator.id}::bigint,
      ${input.mode}::text, ${pathname}::text, ${originalName}::text,
      ${contentType}::text, ${input.sizeBytes}::bigint,
      ${lead.is_test}::boolean, now() + interval '24 hours'
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id`) as Array<{ id: string }>
  if (inserted[0]) return { pathname, contentType }

  const existing = (await sql`
    SELECT lead_id, operator_id, upload_mode AS mode, pathname, original_name, content_type,
      size_bytes, is_test, status, expires_at
    FROM closeout_photo_uploads WHERE id = ${input.id}::text LIMIT 1`) as Array<{
      lead_id: number
      operator_id: number
      mode: string
      pathname: string
      original_name: string
      content_type: string
      size_bytes: number
      is_test: boolean
      status: string
      expires_at: string
    }>
  const receipt = existing[0]
  if (!receipt
    || Number(receipt.lead_id) !== input.leadId
    || Number(receipt.operator_id) !== Number(input.operator.id)
    || receipt.mode !== input.mode
    || receipt.pathname !== pathname
    || receipt.original_name !== originalName
    || receipt.content_type !== contentType
    || Number(receipt.size_bytes) !== input.sizeBytes
    || receipt.is_test !== lead.is_test
    || receipt.status !== "pending"
    || new Date(receipt.expires_at).getTime() <= Date.now()) {
    throw new Error("This closeout photo receipt cannot be reused. Choose the photo again.")
  }
  return { pathname, contentType }
}

export async function confirmCloseoutPhotoUpload(id: string, callbackPathname: string) {
  if (!isCloseoutUploadId(id)) throw new Error("Invalid closeout photo receipt.")
  const sql = getSql()
  const rows = (await sql`
    SELECT id, pathname, size_bytes, status, expires_at
    FROM closeout_photo_uploads WHERE id = ${id}::text LIMIT 1`) as Array<{
      id: string
      pathname: string
      size_bytes: number
      status: string
      expires_at: string
    }>
  const intent = rows[0]
  if (!intent || intent.pathname !== callbackPathname) throw new Error("The closeout photo receipt does not match the uploaded file.")
  if (intent.status === "uploaded" || intent.status === "attached") return
  if (intent.status !== "pending" || new Date(intent.expires_at).getTime() <= Date.now()) {
    throw new Error("This closeout photo receipt expired. Choose the photo again.")
  }

  const blob = await head(intent.pathname)
  if (blob.pathname !== intent.pathname || Number(blob.size) !== Number(intent.size_bytes)) {
    throw new Error("The uploaded closeout photo did not match its saved receipt.")
  }
  const updated = (await sql`
    UPDATE closeout_photo_uploads SET status = 'uploaded', uploaded_at = COALESCE(uploaded_at, now()), updated_at = now()
    WHERE id = ${id}::text AND status = 'pending' AND expires_at > now()
      AND pathname = ${intent.pathname}::text AND size_bytes = ${Number(blob.size)}::bigint
    RETURNING id`) as Array<{ id: string }>
  if (updated[0]) return

  const current = (await sql`
    SELECT status FROM closeout_photo_uploads WHERE id = ${id}::text LIMIT 1`) as Array<{ status: string }>
  if (current[0]?.status !== "uploaded" && current[0]?.status !== "attached") {
    throw new Error("The closeout photo could not be filed. Choose the photo again.")
  }
}

export async function getCloseoutPhotoUpload(input: {
  id: string
  leadId: number
  operatorId: number
  mode: CloseoutPhotoMode
  isTest: boolean
}) {
  if (!isCloseoutUploadId(input.id)) throw new Error("The closeout photo receipt is invalid.")
  const sql = getSql()
  const rows = (await sql`
    SELECT id, lead_id, operator_id, upload_mode AS mode, pathname, original_name, content_type,
      size_bytes, is_test, status, attached_event_id, expires_at
    FROM closeout_photo_uploads
    WHERE id = ${input.id}::text AND lead_id = ${input.leadId}::bigint
      AND operator_id = ${input.operatorId}::bigint AND upload_mode = ${input.mode}::text
      AND is_test = ${input.isTest}::boolean
      AND status IN ('uploaded','attached')
      AND (status = 'attached' OR expires_at > now())
    LIMIT 1`) as CloseoutPhotoUpload[]
  if (!rows[0]) throw new Error("The closeout photo is not ready. Upload it again before saving.")
  return rows[0]
}

export async function attachCloseoutPhotoToLead(input: {
  upload: CloseoutPhotoUpload
  eventId: number
  leadId: number
  completionEventId: number
}) {
  const sql = getSql()
  const photoRecord = {
    pathname: input.upload.pathname,
    contentType: input.upload.content_type,
    size: Number(input.upload.size_bytes),
    name: input.upload.original_name,
    shared: false,
    caption: "",
    sensitivity: "photo",
    isTest: input.upload.is_test,
    sourceCompletionEventId: input.completionEventId,
    ...(input.upload.mode === "addendum" ? { sourceAddendumEventId: input.eventId } : {}),
    sourceCloseoutUploadId: input.upload.id,
  }
  const attached = (await sql`
    WITH intent AS MATERIALIZED (
      SELECT id, lead_id FROM closeout_photo_uploads
      WHERE id = ${input.upload.id}::text AND lead_id = ${input.leadId}::bigint
        AND status IN ('uploaded','attached')
      FOR UPDATE
    ), prior AS MATERIALIZED (
      SELECT intent.id,
        EXISTS (
          SELECT 1 FROM leads l, jsonb_array_elements(COALESCE(l.photos, '[]'::jsonb)) existing
          WHERE l.id = intent.lead_id AND existing->>'sourceCloseoutUploadId' = intent.id
        ) AS already_attached
      FROM intent
    ), added AS (
      UPDATE leads l SET
        photos = COALESCE(l.photos, '[]'::jsonb) || ${JSON.stringify([photoRecord])}::jsonb,
        photo_count = photo_count + 1,
        updated_at = now()
      FROM prior
      WHERE l.id = ${input.leadId}::bigint AND NOT prior.already_attached
      RETURNING l.id
    ), marked AS (
      UPDATE closeout_photo_uploads u SET status = 'attached',
        attached_event_id = COALESCE(u.attached_event_id, ${input.eventId}::bigint), updated_at = now()
      FROM prior
      WHERE u.id = prior.id
        AND (EXISTS (SELECT 1 FROM added) OR prior.already_attached)
        AND (u.attached_event_id IS NULL OR u.attached_event_id = ${input.eventId}::bigint)
      RETURNING u.id
    )
    SELECT marked.id, EXISTS (SELECT 1 FROM added) AS added
    FROM marked`) as Array<{ id: string; added: boolean }>
  if (!attached[0]) throw new Error("The closeout photo could not be attached to this job.")
  return attached[0].added
}
