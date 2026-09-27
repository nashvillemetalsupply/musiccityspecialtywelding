import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { imageTypeMatches } from "../lib/public-quote.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("glass upload finalization checks file signatures and server-forces private storage", () => {
  const uploads = source("lib/glass-uploads.ts")
  const uploadRoute = source("app/api/glass/upload/route.ts")
  const client = source("app/j/[token]/glass-upload.tsx")
  const prefixReader = uploads.slice(uploads.indexOf("async function readGlassUploadPrefix"), uploads.indexOf("async function expireStaleGlassUploadIntentsForToken"))
  const finalize = uploads.slice(uploads.indexOf("export async function finalizeGlassUpload"), uploads.indexOf("export async function listGlassUploads"))
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const fakePng = new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

  assert.equal(imageTypeMatches(png, "image/png"), true)
  assert.equal(imageTypeMatches(fakePng, "image/png"), false)
  assert.match(prefixReader, /get\(pathname, \{ access: "private" \}\)/)
  assert.match(prefixReader, /new Uint8Array\(12\)/)
  assert.match(prefixReader, /reader\.cancel\(\)/)
  assert.match(finalize, /GLASS_RASTER_CONTENT_TYPES\.has\(upload\.content_type\)[\s\S]*?imageTypeMatches\(await readGlassUploadPrefix\(upload\.pathname\), upload\.content_type\)/)
  assert.match(finalize, /status = 'failed', error = 'Uploaded file content did not match its declared type\.'/)
  assert.match(uploadRoute, /handleUploadPresigned/)
  assert.match(uploadRoute, /urlOptions:\s*\{\s*access: "private"/)
  assert.match(uploadRoute, /tokenPayload: JSON\.stringify\(\{ uploadId: authorized\.uploadId \}\)/)
  assert.match(client, /uploadPresigned\(intent\.pathname/)
})
