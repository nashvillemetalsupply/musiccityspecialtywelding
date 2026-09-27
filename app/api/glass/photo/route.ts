import { get } from "@vercel/blob"
import { extendGlassLinkExpiry, getGlassJobByLinkId } from "@/lib/glass"
import { stripImageMetadata, verifyGlassMediaSignature } from "@/lib/glass-media.mjs"
import { isSafeRasterImage } from "@/lib/media-safety"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(req: Request) {
  const url = new URL(req.url)
  const linkId = url.searchParams.get("link") ?? ""
  const mediaId = url.searchParams.get("id") ?? ""
  const expiresAt = url.searchParams.get("expires") ?? ""
  const signature = url.searchParams.get("sig") ?? ""
  if (!verifyGlassMediaSignature({ linkId, kind: "photo", mediaId, expiresAt, signature })) return new Response("Forbidden.", { status: 403 })
  const job = await getGlassJobByLinkId(linkId)
  if (!job || job.status === "closed") return new Response("Forbidden.", { status: 403 })
  const photo = job.photos?.find((item) => item.pathname === mediaId && item.shared)
  if (!photo || mediaId.includes("..") || !isSafeRasterImage(photo.contentType)) return new Response("Not found.", { status: 404 })
  const result = await get(mediaId, { access: "private" })
  if (!result?.stream || result.statusCode !== 200) return new Response("Not found.", { status: 404 })
  const contentType = result.blob.contentType || photo.contentType
  if (!isSafeRasterImage(contentType)) return new Response("Not found.", { status: 404 })
  try {
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer())
    const clean = await stripImageMetadata(bytes, contentType)
    if (!await extendGlassLinkExpiry(linkId)) return new Response("Forbidden.", { status: 403 })
    const responseBytes = new Uint8Array(clean.byteLength)
    responseBytes.set(clean)
    return new Response(responseBytes.buffer, { headers: { "Content-Type": contentType, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } })
  } catch {
    return new Response("This photo could not be processed safely.", { status: 422 })
  }
}
