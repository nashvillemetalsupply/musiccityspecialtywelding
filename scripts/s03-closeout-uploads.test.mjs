import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = new URL("../", import.meta.url)
function source(path) {
  return readFileSync(fileURLToPath(new URL(path, root)), "utf8")
}

test("closeout photos use private 12 MB client uploads from both closeout forms", () => {
  const input = source("app/ops/leads/[id]/closeout-photo-input.tsx")
  const done = source("app/ops/leads/[id]/done-stamp.tsx")
  const actions = source("app/ops/actions.ts")

  assert.match(input, /MAX_PHOTO_BYTES = 12 \* 1024 \* 1024/)
  assert.match(input, /await upload\(pathname, file,[\s\S]{0,180}access: "private"/)
  assert.match(input, /multipart: true/)
  assert.match(input, /name="photoUploadId"/)
  assert.match(done, /mode="completion"/)
  assert.match(done, /mode="addendum"/)
  assert.match(done, /photoUploading \|\| submittedRef\.current/)
  assert.match(actions, /getCloseoutPhotoUpload\(/)
  assert.match(actions, /attachCloseoutPhotoToLead\(/)
  assert.match(actions, /sourceCloseoutUploadId/)
  assert.doesNotMatch(actions, /formData\.get\("photo"\)/)
})

test("closeout upload persists intent before issuing tokens and verifies completion", () => {
  const route = source("app/api/ops/closeout-upload/route.ts")
  const uploads = source("lib/closeout-photo-uploads.ts")
  const migration = source("scripts/migrate.mjs")
  const table = migration.match(/CREATE TABLE IF NOT EXISTS closeout_photo_uploads \([\s\S]*?\n  \)`/)

  assert.ok(table, "the closeout upload table migration should be additive")
  assert.match(migration, /CREATE INDEX IF NOT EXISTS closeout_photo_uploads_lead_idx/)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS closeout_photo_uploads_pending_idx/)
  assert.match(table[0], /status TEXT NOT NULL DEFAULT 'pending'/)
  assert.match(table[0], /is_test BOOLEAN NOT NULL DEFAULT false/)
  assert.match(table[0], /CHECK \(size_bytes > 0 AND size_bytes <= 12582912\)/)

  const handleUploadAt = route.indexOf("const response = await handleUpload")
  const postAt = route.indexOf("export async function POST")
  const beforeGenerateAt = route.indexOf("onBeforeGenerateToken")
  const authAt = route.indexOf("await validateSessionToken")
  const createIntentAt = route.indexOf("await createCloseoutPhotoUpload")
  assert.ok(handleUploadAt >= 0 && beforeGenerateAt > handleUploadAt)
  assert.doesNotMatch(route.slice(postAt, handleUploadAt), /await cookies\(\)|await validateSessionToken/)
  assert.ok(beforeGenerateAt < authAt && authAt < createIntentAt)
  assert.match(route, /onUploadCompleted/)
  assert.match(uploads, /INSERT INTO closeout_photo_uploads/)
  assert.match(uploads, /const blob = await head\(intent\.pathname\)/)
  assert.match(uploads, /status = 'uploaded'/)
  assert.match(uploads, /status IN \('uploaded','attached'\)/)
})

test("quote intake no longer has the dead request-size gate", () => {
  const quote = source("app/api/quote/route.ts")
  assert.doesNotMatch(quote, /MAX_REQUEST_SIZE/)
})
