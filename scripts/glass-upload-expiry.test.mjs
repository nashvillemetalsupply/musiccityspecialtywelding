import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  GLASS_UPLOAD_PENDING_EXPIRY_MS,
  isGlassUploadPendingExpired,
} from "../lib/shop-brain-invariants.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

function section(value, start, end) {
  const startAt = value.indexOf(start)
  const endAt = value.indexOf(end, startAt + start.length)
  assert.ok(startAt >= 0, `missing section start: ${start}`)
  assert.ok(endAt > startAt, `missing section end: ${end}`)
  return value.slice(startAt, endAt)
}

test("pending intent expiry has a conservative deterministic boundary", () => {
  const now = Date.parse("2026-08-10T18:00:00.000Z")
  assert.equal(GLASS_UPLOAD_PENDING_EXPIRY_MS, 21_600_000)
  assert.equal(isGlassUploadPendingExpired("pending", "2026-08-10T12:00:00.000Z", now), true)
  assert.equal(isGlassUploadPendingExpired("pending", "2026-08-10T12:00:00.001Z", now), false)
  assert.equal(isGlassUploadPendingExpired("uploading", "2026-08-10T12:00:00.000Z", now), false)
  assert.equal(isGlassUploadPendingExpired("pending", "bad-date", now), false)
})

test("stale pre-Blob reservations tombstone before a fresh locked quota snapshot", () => {
  const uploads = source("lib/glass-uploads.ts")
  const expireOne = section(uploads, "async function expireStaleGlassUploadIntentsForToken", "export async function expireStaleGlassUploadIntents")
  const create = section(uploads, "export async function createGlassUploadIntent", "export async function authorizeGlassUploadToken")
  const quota = section(create, "), usage AS MATERIALIZED", "INSERT INTO glass_uploads")

  assert.ok(expireOne.indexOf("pg_advisory_xact_lock") < expireOne.indexOf("UPDATE glass_uploads"))
  assert.match(expireOne, /u\.status = 'pending' AND u\.expired_at IS NULL/)
  assert.match(expireOne, /status = 'failed'/)
  assert.match(expireOne, /expired_at = now\(\)/)
  assert.match(expireOne, /GLASS_UPLOAD_PENDING_EXPIRY_MS/)

  const cleanup = create.indexOf("await expireStaleGlassUploadIntentsForToken(job.token_hash)")
  const reservation = create.indexOf("const inserted")
  assert.ok(cleanup >= 0 && cleanup < reservation, "cleanup must commit before the quota statement takes its snapshot")
  assert.ok((quota.match(/u\.expired_at IS NULL/g) ?? []).length >= 3, "daily files, bytes, and batch quota must exclude only tombstoned reservations")
  assert.doesNotMatch(quota, /u\.status\s*[!=]/, "quota state comes from the durable expiry tombstone, not a stale sibling-CTE snapshot")
  assert.match(quota, /count\(u\.id\)::int AS reservation_count/)
  assert.match(create, /usage\.reservation_count < \$\{GLASS_UPLOAD_MAX_RESERVATIONS_PER_DAY\}/)
  assert.match(create, /FILTER \(WHERE expired_at IS NULL[^\n]+daily_count/)
  assert.match(create, /FILTER \(WHERE expired_at IS NULL AND batch_id[^\n]+batch_count/)
  assert.match(create, /daily_reservations/)
  assert.doesNotMatch(expireOne, /DELETE FROM glass_uploads/)

  const expiredGuard = create.indexOf("if (existing[0]?.expired_at)")
  const idempotentReturn = create.indexOf("existing[0].pathname === pathname")
  assert.ok(expiredGuard >= 0 && expiredGuard < idempotentReturn, "an expired receipt ID must never be reused")
})

test("authorization and finalization cannot resurrect an expired receipt", () => {
  const uploads = source("lib/glass-uploads.ts")
  const authorize = section(uploads, "export async function authorizeGlassUploadToken", "async function projectGlassUpload")
  const finalize = section(uploads, "export async function finalizeGlassUpload", "export async function listGlassUploads")

  assert.match(authorize, /u\.expired_at IS NULL/)
  assert.match(authorize, /u\.status IN \('pending','uploading','failed','unknown'\)/)

  const expiredGuard = finalize.indexOf("if (upload.expired_at)")
  const blobHead = finalize.indexOf("await head(upload.pathname)")
  assert.ok(expiredGuard >= 0 && expiredGuard < blobHead, "expired receipts must fail before any Blob lookup")
  const postHead = finalize.slice(blobHead)
  assert.match(postHead, /u\.expired_at IS NULL/)
  assert.match(postHead, /current\[0\]\?\.expired_at/)
  assert.match(postHead, /status <> 'stored' AND expired_at IS NULL/)
  assert.match(postHead, /projected\?\.status !== "stored"/)
})

test("migration, reconciliation, and Customer Page expose terminal expiry truth", () => {
  const uploads = source("lib/glass-uploads.ts")
  const migration = source("scripts/migrate.mjs")
  const page = source("app/j/[token]/page.tsx")
  const client = source("app/j/[token]/glass-upload.tsx")
  const uploadRoute = source("app/api/glass/upload/route.ts")
  const finalizeRoute = source("app/api/glass/upload/finalize/route.ts")
  const list = section(uploads, "export async function listGlassUploads", "export async function getStoredGlassUpload")
  const reconcile = uploads.slice(uploads.indexOf("export async function reconcileGlassUploads"))

  assert.match(migration, /ALTER TABLE glass_uploads ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ/)
  assert.match(migration, /glass_uploads_pending_expiry_idx[^\n]+status = 'pending' AND expired_at IS NULL/)
  assert.doesNotMatch(migration, /DROP CONSTRAINT glass_uploads_status_check/)
  assert.ok(list.indexOf("expireStaleGlassUploadIntentsForToken") < list.indexOf("SELECT * FROM glass_uploads"))
  assert.match(reconcile, /expireStaleGlassUploadIntents\(limit\)/)
  assert.match(reconcile, /expired: pending\.expired/)

  assert.match(finalizeRoute, /expired \? 410 : 400/)
  assert.match(finalizeRoute, /UPLOAD_RESERVATION_EXPIRED|error\.code/)
  assert.match(finalizeRoute, /upload: \{ id: upload\.id, status: upload\.status \}/)
  assert.match(uploadRoute, /tokenPayload: JSON\.stringify\(\{ uploadId: authorized\.uploadId \}\)/)
  assert.doesNotMatch(uploadRoute, /authorized\.tokenHash/)
  assert.match(page, /expired: Boolean\(item\.expired_at\)/)
  assert.match(client, /return "Expired"/)
  assert.match(client, /item\.expired \|\| !\["uploading"/)
  assert.ok((client.match(/!item\.expired/g) ?? []).length >= 1, "expired persisted receipts must not offer retry filing")
  assert.match(client, /Choose the file again/)
})
