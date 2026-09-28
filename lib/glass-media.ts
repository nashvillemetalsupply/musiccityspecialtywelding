export type GlassMediaKind = "photo" | "attachment"

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto"
import sharp from "sharp"

const RASTER_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
])
export const GLASS_MEDIA_URL_TTL_MS: number = 15 * 60 * 1000
const MEDIA_URL_PURPOSE = "mcsw-media-url-v1"
const GLASS_MEDIA_KINDS = new Set(["photo", "attachment"])

function mediaUrlKey(secret: string) {
  const normalized = String(secret ?? "").trim()
  if (!normalized || Buffer.byteLength(normalized, "utf8") < 32) return null
  return Buffer.from(hkdfSync(
    "sha256",
    normalized,
    Buffer.from(MEDIA_URL_PURPOSE, "utf8"),
    Buffer.from(MEDIA_URL_PURPOSE, "utf8"),
    32,
  ))
}

function mediaUrlPayload(linkId: string, kind: GlassMediaKind, mediaId: string, expiresAt: number) {
  return JSON.stringify([MEDIA_URL_PURPOSE, linkId, kind, mediaId, expiresAt])
}

export function createGlassMediaSignature(linkId: string, kind: GlassMediaKind, mediaId: string, expiresAt: number, secret: string = process.env.GLASS_TOKEN_SECRET) : string | null {
  const key = mediaUrlKey(secret)
  if (!key || !/^[a-f0-9]{64}$/i.test(linkId) || !GLASS_MEDIA_KINDS.has(kind)
    || !mediaId || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null
  return createHmac("sha256", key).update(mediaUrlPayload(linkId, kind, mediaId, expiresAt)).digest("base64url")
}

export function verifyGlassMediaSignature({ linkId, kind, mediaId, expiresAt, signature, now = Date.now(), secret = process.env.GLASS_TOKEN_SECRET }: { linkId: string; kind: GlassMediaKind; mediaId: string; expiresAt: number | string; signature: string; now?: number; secret?: string }) : boolean {
  const expiry = Number(expiresAt)
  if (!Number.isSafeInteger(expiry) || String(expiry) !== String(expiresAt)
    || expiry <= now || expiry > now + GLASS_MEDIA_URL_TTL_MS) return false
  const expected = createGlassMediaSignature(linkId, kind, mediaId, expiry, secret)
  if (!expected) return false
  const validEncoding = typeof signature === "string" && /^[A-Za-z0-9_-]{43}$/.test(signature)
  const supplied = validEncoding ? Buffer.from(signature, "base64url") : Buffer.alloc(32)
  const expectedBytes = Buffer.from(expected, "base64url")
  // Always compare fixed-size buffers, including malformed and missing input.
  const equal = timingSafeEqual(supplied.length === 32 ? supplied : Buffer.alloc(32), expectedBytes)
  return Boolean(validEncoding && equal)
}

export function createGlassMediaUrl(linkId: string, kind: GlassMediaKind, mediaId: string, { now = Date.now(), secret = process.env.GLASS_TOKEN_SECRET }: { now?: number; secret?: string } = {}) : string | null {
  if (!GLASS_MEDIA_KINDS.has(kind) || !mediaId) return null
  const expiresAt = now + GLASS_MEDIA_URL_TTL_MS
  const signature = createGlassMediaSignature(linkId, kind, mediaId, expiresAt, secret)
  if (!signature) return null
  const query = new URLSearchParams({ id: mediaId, link: linkId, expires: String(expiresAt), sig: signature })
  return `/api/glass/${kind}?${query.toString()}`
}

export async function stripImageMetadata(input: Uint8Array, contentType: string) : Promise<Buffer> {
  const normalizedType = String(contentType ?? "").toLowerCase().split(";", 1)[0].trim()
  if (!RASTER_IMAGE_TYPES.has(normalizedType)) throw new Error("Unsupported raster image type.")
  // Sharp removes EXIF and other metadata unless a keep/withMetadata method is
  // requested. rotate() applies the orientation before that metadata is gone.
  return sharp(Buffer.from(input), { animated: normalizedType === "image/gif", failOn: "error" })
    .rotate()
    .toBuffer()
}
