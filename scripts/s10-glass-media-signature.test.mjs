import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  createGlassMediaUrl,
  GLASS_MEDIA_URL_TTL_MS,
  verifyGlassMediaSignature,
} from "../lib/glass-media.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const secret = "[INTERNAL TEST] glass-media-key-with-more-than-32-bytes"
const linkId = "a".repeat(64)

function signedFields(url) {
  const parsed = new URL(url, "https://shop.example")
  return {
    linkId: parsed.searchParams.get("link"),
    mediaId: parsed.searchParams.get("id"),
    expiresAt: parsed.searchParams.get("expires"),
    signature: parsed.searchParams.get("sig"),
  }
}

test("signed media URL is bound to one link, exact media ID, type, and 15-minute expiry", () => {
  const now = Date.parse("2026-09-27T18:00:00.000Z")
  const url = createGlassMediaUrl(linkId, "photo", "glass/42/progress/photo-1.jpg", { now, secret })
  assert.ok(url)
  const fields = signedFields(url)
  assert.equal(Number(fields.expiresAt) - now, GLASS_MEDIA_URL_TTL_MS)
  assert.equal(verifyGlassMediaSignature({ ...fields, kind: "photo", now: now + 1, secret }), true)
  assert.equal(verifyGlassMediaSignature({ ...fields, kind: "photo", mediaId: "glass/42/other.jpg", now: now + 1, secret }), false)
  assert.equal(verifyGlassMediaSignature({ ...fields, kind: "attachment", now: now + 1, secret }), false)
  assert.equal(verifyGlassMediaSignature({ ...fields, kind: "photo", linkId: "b".repeat(64), now: now + 1, secret }), false)
})

test("signed media URLs reject replay after expiry, tampered signatures, and a missing server secret", () => {
  const now = 1_790_000_000_000
  const url = createGlassMediaUrl(linkId, "attachment", "upload-test-12345678", { now, secret })
  assert.ok(url)
  const fields = signedFields(url)
  assert.equal(verifyGlassMediaSignature({ ...fields, kind: "attachment", now: now + GLASS_MEDIA_URL_TTL_MS - 1, secret }), true)
  assert.equal(verifyGlassMediaSignature({ ...fields, kind: "attachment", now: now + GLASS_MEDIA_URL_TTL_MS, secret }), false)
  const changedSignature = `${fields.signature.slice(0, -1)}${fields.signature.endsWith("A") ? "B" : "A"}`
  assert.equal(verifyGlassMediaSignature({ ...fields, signature: changedSignature, kind: "attachment", now: now + 1, secret }), false)
  assert.equal(createGlassMediaUrl(linkId, "photo", "photo-1", { now, secret: "short" }), null)
  assert.equal(verifyGlassMediaSignature({ ...fields, kind: "attachment", now: now + 1, secret: "" }), false)
})

test("glass media routes reject expired or revoked links before serving private bytes", () => {
  for (const route of ["app/api/glass/photo/route.ts", "app/api/glass/attachment/route.ts"]) {
    const code = source(route)
    assert.match(code, /verifyGlassMediaSignature/)
    assert.match(code, /status: 403/)
    assert.match(code, /getGlassJobByLinkId\(linkId\)/)
    assert.match(code, /extendGlassLinkExpiry\(linkId\)/)
    assert.match(code, /Cache-Control": "private, no-store"/)
    assert.doesNotMatch(code, /searchParams\.get\("token"\)/)
  }
  const page = source("app/j/[token]/page.tsx")
  const upload = source("app/j/[token]/glass-upload.tsx")
  assert.match(page, /issueGlassMediaUrl\(job\.token_hash, "photo"/)
  assert.match(page, /issueGlassMediaUrl\(job\.token_hash, "attachment"/)
  assert.doesNotMatch(page, /api\/glass\/photo\?token=/)
  assert.doesNotMatch(upload, /api\/glass\/attachment\?token=/)
})

test("media URL keys use HKDF with a fixed purpose and compare signatures in constant time", () => {
  const helper = source("lib/glass-media.mjs")
  assert.match(helper, /hkdfSync\(/)
  assert.match(helper, /MEDIA_URL_PURPOSE = "mcsw-media-url-v1"/)
  assert.match(helper, /timingSafeEqual\(/)
})
