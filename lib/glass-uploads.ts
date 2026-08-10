import { head } from "@vercel/blob"
import { getSql } from "@/lib/db"
import { getGlassJob, hashGlassToken, type GlassJob } from "@/lib/glass"
import { notifyAll } from "@/lib/notify"
import {
  GLASS_UPLOAD_PENDING_EXPIRY_MS,
  validateCustomerUploadMetadata,
} from "@/lib/shop-brain-invariants.mjs"

export const GLASS_UPLOAD_MAX_FILES_PER_BATCH = 10
export const GLASS_UPLOAD_MAX_FILE_BYTES = 20 * 1024 * 1024
export const GLASS_UPLOAD_MAX_FILES_PER_DAY = 30
export const GLASS_UPLOAD_MAX_BYTES_PER_DAY = 100 * 1024 * 1024
export const GLASS_UPLOAD_MAX_RESERVATIONS_PER_DAY = 60
export const GLASS_UPLOAD_PENDING_EXPIRY_ERROR = "Upload request expired before the file was sent. Choose the file again."

export class GlassUploadIntentExpiredError extends Error {
  readonly code = "UPLOAD_RESERVATION_EXPIRED"

  constructor() {
    super(GLASS_UPLOAD_PENDING_EXPIRY_ERROR)
    this.name = "GlassUploadIntentExpiredError"
  }
}

export type GlassUploadStatus = "pending" | "uploading" | "uploaded" | "projecting" | "stored" | "failed" | "unknown"

export type GlassUploadRow = {
  id: string
  token_hash: string
  lead_id: number
  person_id: number | null
  batch_id: string
  pathname: string
  filename: string
  content_type: string
  size_bytes: number
  status: GlassUploadStatus
  error: string
  blob_url: string
  etag: string
  created_at: string
  updated_at: string
  projected_at: string | null
  expired_at: string | null
}

export function validateGlassUploadMetadata(filenameValue: string, contentTypeValue: string, sizeValue: number) {
  return validateCustomerUploadMetadata(filenameValue, contentTypeValue, sizeValue)
}

function validClientId(value: string) {
  return /^[a-z0-9-]{16,80}$/i.test(value)
}

async function expireStaleGlassUploadIntentsForToken(tokenHash: string) {
  const sql = getSql()
  const rows = (await sql`
    WITH held AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(${tokenHash}::text))
    ), expired AS (
      UPDATE glass_uploads u
      SET status = 'failed', error = ${GLASS_UPLOAD_PENDING_EXPIRY_ERROR}::text,
        expired_at = now(), updated_at = now()
      FROM held
      WHERE u.token_hash = ${tokenHash}::text
        AND u.status = 'pending' AND u.expired_at IS NULL
        AND u.created_at <= now() - (${GLASS_UPLOAD_PENDING_EXPIRY_MS}::bigint * interval '1 millisecond')
      RETURNING u.id
    )
    SELECT count(*)::int AS expired FROM expired`) as { expired: number }[]
  return Number(rows[0]?.expired ?? 0)
}

export async function expireStaleGlassUploadIntents(limit = 20) {
  const sql = getSql()
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 50)
  const tokenRows = (await sql`
    SELECT token_hash, min(created_at) AS oldest
    FROM glass_uploads
    WHERE status = 'pending' AND expired_at IS NULL
      AND created_at <= now() - (${GLASS_UPLOAD_PENDING_EXPIRY_MS}::bigint * interval '1 millisecond')
    GROUP BY token_hash
    ORDER BY oldest ASC, token_hash ASC
    LIMIT ${boundedLimit}::int`) as { token_hash: string; oldest: string }[]
  let expired = 0
  for (const row of tokenRows) expired += await expireStaleGlassUploadIntentsForToken(row.token_hash)
  return { checked: tokenRows.length, expired }
}

export async function createGlassUploadIntent(input: {
  token: string
  uploadId: string
  batchId: string
  filename: string
  contentType: string
  size: number
}) {
  if (!validClientId(input.uploadId) || !validClientId(input.batchId)) throw new Error("Reload the Customer Page before adding files.")
  const job = await getGlassJob(input.token)
  if (!job || job.status === "closed") throw new Error("This Customer Page is closed.")
  const metadata = validateGlassUploadMetadata(input.filename, input.contentType, input.size)
  const pathname = `glass/${job.lead_id}/${job.token_hash.slice(0, 16)}/${input.uploadId}/${metadata.safeName}`
  // Keep cleanup in its own locked statement so the quota reservation below
  // gets a fresh snapshot. A sibling UPDATE CTE would not be visible to its
  // own usage SELECT and could miscount an authorization that won the lock.
  await expireStaleGlassUploadIntentsForToken(job.token_hash)
  const sql = getSql()
  const inserted = (await sql`
    WITH candidate AS MATERIALIZED (
      SELECT g.token_hash, g.lead_id, l.person_id
      FROM glass_links g JOIN leads l ON l.id = g.lead_id
      WHERE g.token_hash = ${job.token_hash}::text
    ), held AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(token_hash)) FROM candidate
    ), link AS MATERIALIZED (
      SELECT candidate.token_hash, candidate.lead_id, candidate.person_id
      FROM candidate
      JOIN glass_links g ON g.token_hash = candidate.token_hash
      CROSS JOIN (SELECT count(*) FROM held) lock_guard
      WHERE g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
      FOR UPDATE OF g
    ), usage AS MATERIALIZED (
      SELECT
        count(u.id) FILTER (WHERE u.expired_at IS NULL)::int AS file_count,
        COALESCE(sum(u.size_bytes) FILTER (WHERE u.expired_at IS NULL), 0)::bigint AS byte_count,
        count(u.id)::int AS reservation_count
      FROM link
      LEFT JOIN glass_uploads u ON u.token_hash = link.token_hash
        AND timezone('America/Chicago', u.created_at)::date = timezone('America/Chicago', now())::date
    ), batch AS MATERIALIZED (
      SELECT count(u.id) FILTER (WHERE u.expired_at IS NULL)::int AS file_count
      FROM link
      LEFT JOIN glass_uploads u ON u.token_hash = link.token_hash
        AND u.batch_id = ${input.batchId}::text
    )
    INSERT INTO glass_uploads (
      id, token_hash, lead_id, person_id, batch_id, pathname,
      filename, content_type, size_bytes, status
    )
    SELECT ${input.uploadId}::text, link.token_hash, link.lead_id, link.person_id,
      ${input.batchId}::text, ${pathname}::text, ${metadata.filename}::text,
      ${metadata.contentType}::text, ${metadata.size}::bigint, 'pending'::text
    FROM link CROSS JOIN usage CROSS JOIN batch
    WHERE usage.file_count < ${GLASS_UPLOAD_MAX_FILES_PER_DAY}::int
      AND usage.byte_count + ${metadata.size}::bigint <= ${GLASS_UPLOAD_MAX_BYTES_PER_DAY}::bigint
      AND usage.reservation_count < ${GLASS_UPLOAD_MAX_RESERVATIONS_PER_DAY}::int
      AND batch.file_count < ${GLASS_UPLOAD_MAX_FILES_PER_BATCH}::int
    ON CONFLICT (id) DO NOTHING
    RETURNING id, pathname, filename, content_type, size_bytes, status`) as Array<Pick<GlassUploadRow, "id" | "pathname" | "filename" | "content_type" | "size_bytes" | "status">>
  if (inserted[0]) return inserted[0]

  const existing = (await sql`
    SELECT id, pathname, filename, content_type, size_bytes, status, expired_at
    FROM glass_uploads WHERE id = ${input.uploadId}::text AND token_hash = ${job.token_hash}::text
    LIMIT 1`) as Array<Pick<GlassUploadRow, "id" | "pathname" | "filename" | "content_type" | "size_bytes" | "status" | "expired_at">>
  if (existing[0]?.expired_at) throw new GlassUploadIntentExpiredError()
  if (existing[0] && existing[0].pathname === pathname && Number(existing[0].size_bytes) === metadata.size) return existing[0]

  const usage = (await sql`
    SELECT
      count(*) FILTER (WHERE expired_at IS NULL AND timezone('America/Chicago', created_at)::date = timezone('America/Chicago', now())::date)::int AS daily_count,
      COALESCE(sum(size_bytes) FILTER (WHERE expired_at IS NULL AND timezone('America/Chicago', created_at)::date = timezone('America/Chicago', now())::date), 0)::bigint AS daily_bytes,
      count(*) FILTER (WHERE expired_at IS NULL AND batch_id = ${input.batchId}::text)::int AS batch_count,
      count(*) FILTER (WHERE timezone('America/Chicago', created_at)::date = timezone('America/Chicago', now())::date)::int AS daily_reservations
    FROM glass_uploads WHERE token_hash = ${job.token_hash}::text`) as { daily_count: number; daily_bytes: number; batch_count: number; daily_reservations: number }[]
  if (Number(usage[0]?.batch_count ?? 0) >= GLASS_UPLOAD_MAX_FILES_PER_BATCH) throw new Error("Add up to 10 files at a time.")
  if (Number(usage[0]?.daily_reservations ?? 0) >= GLASS_UPLOAD_MAX_RESERVATIONS_PER_DAY) throw new Error("This Customer Page has reached todayâ€™s upload-request limit. Try again tomorrow.")
  if (Number(usage[0]?.daily_count ?? 0) >= GLASS_UPLOAD_MAX_FILES_PER_DAY) throw new Error("This Customer Page has reached today’s 30-file limit.")
  if (Number(usage[0]?.daily_bytes ?? 0) + metadata.size > GLASS_UPLOAD_MAX_BYTES_PER_DAY) throw new Error("This Customer Page has reached today’s 100 MB limit.")
  throw new Error("That upload intent could not be filed safely.")
}

export async function authorizeGlassUploadToken(pathname: string, clientPayload: string | null) {
  let payload: { uploadId?: string; token?: string } = {}
  try { payload = JSON.parse(clientPayload || "{}") as typeof payload } catch { throw new Error("Invalid upload receipt.") }
  const uploadId = String(payload.uploadId ?? "")
  const token = String(payload.token ?? "")
  if (!validClientId(uploadId) || !/^[a-f0-9]{64}$/i.test(token)) throw new Error("Invalid upload receipt.")
  const tokenHash = hashGlassToken(token)
  const job = await getGlassJob(token)
  if (!job || job.status === "closed") throw new Error("This Customer Page is closed.")
  const sql = getSql()
  const rows = (await sql`
    WITH candidate AS MATERIALIZED (
      SELECT u.token_hash
      FROM glass_uploads u
      WHERE u.id = ${uploadId}::text AND u.pathname = ${pathname}::text
        AND u.token_hash = ${tokenHash}::text
    ), held AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(token_hash)) FROM candidate
    ), active AS MATERIALIZED (
      SELECT u.id
      FROM glass_uploads u
      JOIN glass_links g ON g.token_hash = u.token_hash
      CROSS JOIN (SELECT count(*) FROM held) lock_guard
      WHERE u.id = ${uploadId}::text AND u.pathname = ${pathname}::text
        AND u.token_hash = ${tokenHash}::text
        AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
        AND u.expired_at IS NULL
        AND u.status IN ('pending','uploading','failed','unknown')
      FOR UPDATE OF g, u
    )
    UPDATE glass_uploads u SET status = 'uploading', error = '', updated_at = now()
    FROM active
    WHERE u.id = active.id
    RETURNING u.id, u.content_type, u.size_bytes`) as { id: string; content_type: string; size_bytes: number }[]
  if (!rows[0]) throw new Error("This upload is no longer available.")
  return {
    uploadId,
    contentType: rows[0].content_type,
    maximumSizeInBytes: Number(rows[0].size_bytes),
  }
}

async function projectGlassUpload(uploadId: string) {
  const sql = getSql()
  // The active-link row lock and every durable projection live in one SQL
  // transaction. A concurrent revoke either lands first and blocks all writes,
  // or waits until the already-authorized projection is fully recorded.
  const projected = (await sql`
    WITH candidate AS MATERIALIZED (
      SELECT token_hash FROM glass_uploads
      WHERE id = ${uploadId}::text AND (
        status = 'uploaded' OR (status = 'projecting' AND updated_at < now() - interval '5 minutes')
      )
    ), held AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(token_hash)) FROM candidate
    ), active AS MATERIALIZED (
      SELECT u.*, l.first_name, l.is_test
      FROM glass_uploads u
      JOIN glass_links g ON g.token_hash = u.token_hash
      JOIN leads l ON l.id = u.lead_id
      CROSS JOIN (SELECT count(*) FROM held) lock_guard
      WHERE u.id = ${uploadId}::text
        AND (u.status = 'uploaded' OR (u.status = 'projecting' AND u.updated_at < now() - interval '5 minutes'))
        AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
      FOR UPDATE OF g, u
    ), claimed AS (
      UPDATE glass_uploads u SET status = 'projecting', error = '', updated_at = now()
      FROM active a
      WHERE u.id = a.id
      RETURNING u.*
    ), message_write AS (
      INSERT INTO messages (
        twilio_sid, direction, from_phone, to_phone, body, crew_body, media,
        status, lead_id, person_id
      )
      SELECT
        'glass-upload:' || left(c.token_hash, 24) || ':' || c.batch_id,
        'in', 'customer-page', 'mcsw-jobs',
        'Customer added photos or files.', 'Customer added photos or files.',
        jsonb_build_array(jsonb_build_object(
          'pathname', c.pathname,
          'name', c.filename,
          'contentType', c.content_type,
          'size', c.size_bytes,
          'sensitivity', CASE WHEN c.content_type LIKE 'image/%' THEN 'photo' ELSE 'drawing' END,
          'source', 'customer-page',
          'uploadId', c.id
        )),
        'received', c.lead_id, c.person_id
      FROM claimed c
      ON CONFLICT (twilio_sid) DO UPDATE SET
        media = CASE WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(messages.media, '[]'::jsonb)) item
          WHERE item->>'pathname' = EXCLUDED.media->0->>'pathname'
        ) THEN messages.media ELSE COALESCE(messages.media, '[]'::jsonb) || EXCLUDED.media END,
        sent_at = GREATEST(messages.sent_at, now())
      RETURNING id, twilio_sid
    ), event_insert AS (
      INSERT INTO events (
        kind, actor_type, actor_id, lead_id, person_id, external_id, body, crew_body, detail
      )
      SELECT
        'glass.uploaded', 'customer', COALESCE(c.person_id::text, ''), c.lead_id, c.person_id,
        'glass-upload:' || c.token_hash || ':' || c.batch_id,
        'Customer added photos or files on the Customer Page.',
        'Customer added photos or files on the Customer Page.',
        jsonb_build_object('batchId', c.batch_id, 'messageSid', m.twilio_sid, 'tokenHash', c.token_hash)
      FROM claimed c CROSS JOIN message_write m
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id
    ), event_receipt AS MATERIALIZED (
      SELECT id FROM event_insert
      UNION ALL
      SELECT e.id FROM events e CROSS JOIN claimed c
      WHERE e.kind = 'glass.uploaded'
        AND e.external_id = 'glass-upload:' || c.token_hash || ':' || c.batch_id
        AND NOT EXISTS (SELECT 1 FROM event_insert)
      LIMIT 1
    ), stored AS (
      UPDATE glass_uploads u SET status = 'stored', projected_at = COALESCE(projected_at, now()),
        error = '', updated_at = now()
      FROM event_receipt receipt CROSS JOIN message_write message
      WHERE u.id = ${uploadId}::text AND u.status = 'projecting'
      RETURNING u.*
    )
    SELECT stored.*, active.first_name, active.is_test, event_receipt.id AS event_id
    FROM stored
    JOIN active ON active.id = stored.id
    CROSS JOIN event_receipt`) as Array<GlassUploadRow & { first_name: string; is_test: boolean; event_id: number }>

  const upload = projected[0]
  if (!upload) {
    const existing = (await sql`
      SELECT u.*, EXISTS (
        SELECT 1 FROM glass_links g WHERE g.token_hash = u.token_hash
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
      ) AS link_active
      FROM glass_uploads u WHERE u.id = ${uploadId}::text LIMIT 1`) as Array<GlassUploadRow & { link_active: boolean }>
    if (!existing[0]) return null
    if (existing[0].status === "stored") return existing[0]
    if (!existing[0].link_active) {
      await sql`
        UPDATE glass_uploads SET status = 'failed', error = 'Customer Page closed before filing.', updated_at = now()
        WHERE id = ${uploadId}::text AND status <> 'stored'
          AND NOT EXISTS (
            SELECT 1 FROM glass_links g WHERE g.token_hash = glass_uploads.token_hash
              AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
          )`
      throw new Error("This Customer Page is closed.")
    }
    return existing[0]
  }

  if (!upload.is_test && upload.event_id) {
    // Recheck under the same per-link advisory lock immediately before the
    // alert boundary. A close that won while Blob HEAD was in flight suppresses
    // the alert as well as the message and receipt projection above.
    const notifyGate = (await sql`
      WITH candidate AS MATERIALIZED (
        SELECT token_hash FROM glass_uploads WHERE id = ${upload.id}::text
      ), held AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(token_hash)) FROM candidate
      )
      SELECT 1 AS allowed
      FROM glass_uploads u
      JOIN glass_links g ON g.token_hash = u.token_hash
      CROSS JOIN (SELECT count(*) FROM held) lock_guard
      WHERE u.id = ${upload.id}::text AND u.status = 'stored'
        AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
      FOR UPDATE OF g
      LIMIT 1`) as { allowed: number }[]
    if (notifyGate[0]) await notifyAll({
      priority: "interrupt",
      stock: "white",
      title: `${upload.first_name || "Customer"} added files`,
      body: "Open the job to review the new photos or drawings.",
      url: `/ops/leads/${upload.lead_id}#spike`,
      sourceEventId: Number(upload.event_id),
      dedupeKey: `glass-upload:${upload.batch_id}`,
    })
  }
  return upload
}

export async function finalizeGlassUpload(input: { uploadId: string; token?: string | null; callbackPathname?: string | null }) {
  if (!validClientId(input.uploadId)) throw new Error("Invalid upload receipt.")
  const sql = getSql()
  const rows = (await sql`
    SELECT u.*, g.revoked_at, g.expires_at
    FROM glass_uploads u JOIN glass_links g ON g.token_hash = u.token_hash
    WHERE u.id = ${input.uploadId}::text LIMIT 1`) as Array<GlassUploadRow & { revoked_at: string | null; expires_at: string | null }>
  const upload = rows[0]
  if (!upload) throw new Error("Upload not found.")
  if (input.token && hashGlassToken(input.token) !== upload.token_hash) throw new Error("Upload bearer does not match.")
  if (input.callbackPathname && input.callbackPathname !== upload.pathname) throw new Error("Blob callback path does not match the filed intent.")
  if (upload.expired_at) throw new GlassUploadIntentExpiredError()
  if (upload.revoked_at || (upload.expires_at && new Date(upload.expires_at).getTime() <= Date.now())) {
    await sql`UPDATE glass_uploads SET status = 'failed', error = 'Customer Page closed before filing.', updated_at = now() WHERE id = ${upload.id}::text AND status <> 'stored'`
    throw new Error("This Customer Page is closed.")
  }
  if (upload.status === "stored") return upload
  try {
    const blob = await head(upload.pathname)
    if (blob.pathname !== upload.pathname || Number(blob.size) !== Number(upload.size_bytes)) {
      const rejected = (await sql`
        UPDATE glass_uploads
        SET status = 'failed', error = 'Uploaded file did not match its filed intent.', updated_at = now()
        WHERE id = ${upload.id}::text AND expired_at IS NULL
        RETURNING id`) as { id: string }[]
      if (!rejected[0]) {
        const current = (await sql`SELECT expired_at FROM glass_uploads WHERE id = ${upload.id}::text LIMIT 1`) as { expired_at: string | null }[]
        if (current[0]?.expired_at) throw new GlassUploadIntentExpiredError()
      }
      throw new Error("The uploaded file did not match its filed intent.")
    }
    // Blob HEAD is an external await. Reacquire the per-link lock and recheck
    // active/unexpired state before allowing the receipt into projection.
    const updated = (await sql`
      WITH candidate AS MATERIALIZED (
        SELECT token_hash FROM glass_uploads WHERE id = ${upload.id}::text
      ), held AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(token_hash)) FROM candidate
      ), active AS MATERIALIZED (
        SELECT u.id
        FROM glass_uploads u
        JOIN glass_links g ON g.token_hash = u.token_hash
        CROSS JOIN (SELECT count(*) FROM held) lock_guard
        WHERE u.id = ${upload.id}::text AND u.status <> 'stored'
          AND u.expired_at IS NULL
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
        FOR UPDATE OF g, u
      )
      UPDATE glass_uploads u SET status = 'uploaded', blob_url = ${blob.url}::text,
        etag = ${blob.etag}::text, callback_completed_at = now(), error = '', updated_at = now()
      FROM active
      WHERE u.id = active.id
      RETURNING u.*`) as GlassUploadRow[]
    if (!updated[0]) {
      const current = (await sql`
        SELECT u.*, EXISTS (
          SELECT 1 FROM glass_links g WHERE g.token_hash = u.token_hash
            AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
        ) AS link_active
        FROM glass_uploads u WHERE u.id = ${upload.id}::text LIMIT 1`) as Array<GlassUploadRow & { link_active: boolean }>
      if (current[0]?.status === "stored") return current[0]
      if (current[0]?.expired_at) throw new GlassUploadIntentExpiredError()
      if (!current[0]?.link_active) {
        await sql`
          UPDATE glass_uploads SET status = 'failed', error = 'Customer Page closed before filing.', updated_at = now()
          WHERE id = ${upload.id}::text AND status <> 'stored'
            AND NOT EXISTS (
              SELECT 1 FROM glass_links g WHERE g.token_hash = glass_uploads.token_hash
                AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
            )`
        throw new Error("This Customer Page is closed.")
      }
    }
    const projected = await projectGlassUpload(upload.id)
    if (projected?.status !== "stored") throw new Error("The file could not be filed yet.")
    return projected
  } catch (error) {
    if (error instanceof GlassUploadIntentExpiredError) throw error
    if (error instanceof Error && /did not match|closed/i.test(error.message)) throw error
    await sql`
      UPDATE glass_uploads SET status = 'unknown', error = ${error instanceof Error ? error.message.slice(0, 500) : "Blob verification did not return."}::text,
        updated_at = now() WHERE id = ${upload.id}::text AND status <> 'stored' AND expired_at IS NULL`
    throw new Error("The file may be uploaded, but filing could not be verified yet. Retry filing in a moment.")
  }
}

export async function listGlassUploads(job: GlassJob) {
  await expireStaleGlassUploadIntentsForToken(job.token_hash)
  const sql = getSql()
  return (await sql`
    SELECT * FROM glass_uploads
    WHERE token_hash = ${job.token_hash}::text AND lead_id = ${job.lead_id}::bigint
      AND status IN ('uploading','uploaded','projecting','stored','failed','unknown')
    ORDER BY created_at DESC, id DESC
    LIMIT 60`) as GlassUploadRow[]
}

export async function getStoredGlassUpload(token: string, uploadId: string) {
  const job = await getGlassJob(token)
  if (!job || job.status === "closed") return null
  const sql = getSql()
  const rows = (await sql`
    SELECT * FROM glass_uploads
    WHERE id = ${uploadId}::text AND token_hash = ${job.token_hash}::text
      AND lead_id = ${job.lead_id}::bigint AND status = 'stored'
    LIMIT 1`) as GlassUploadRow[]
  return rows[0] ?? null
}

export async function reconcileGlassUploads(limit = 20) {
  const pending = await expireStaleGlassUploadIntents(limit)
  const sql = getSql()
  const rows = (await sql`
    SELECT id, pathname, status FROM glass_uploads
    WHERE status IN ('uploading','uploaded','projecting','unknown')
      AND updated_at < now() - interval '10 minutes'
    ORDER BY updated_at ASC LIMIT ${Math.min(Math.max(limit, 1), 50)}::bigint`) as { id: string; pathname: string; status: GlassUploadStatus }[]
  let stored = 0
  let unknown = 0
  for (const row of rows) {
    try {
      const result = await finalizeGlassUpload({ uploadId: row.id, callbackPathname: row.pathname })
      if (result?.status === "stored") stored += 1
    } catch {
      unknown += 1
    }
  }
  return { checked: rows.length, stored, unknown, expired: pending.expired, pendingLinks: pending.checked }
}
