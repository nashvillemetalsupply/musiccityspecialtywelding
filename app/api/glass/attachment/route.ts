import { get } from "@vercel/blob"
import { extendGlassLinkExpiry, getGlassJobByLinkId } from "@/lib/glass"
import { getStoredGlassUploadByLinkId } from "@/lib/glass-uploads"
import { stripImageMetadata, verifyGlassMediaSignature } from "@/lib/glass-media.mjs"
import { isSafeRasterImage } from "@/lib/media-safety"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const linkId = url.searchParams.get("link") ?? ""
  const uploadId = url.searchParams.get("id") ?? ""
  const expiresAt = url.searchParams.get("expires") ?? ""
  const signature = url.searchParams.get("sig") ?? ""
  if (!verifyGlassMediaSignature({ linkId, kind: "attachment", mediaId: uploadId, expiresAt, signature })) return new Response("Forbidden.", { status: 403 })
  const job = await getGlassJobByLinkId(linkId)
  if (!job || job.status === "closed") return new Response("Forbidden.", { status: 403 })
  const upload = await getStoredGlassUploadByLinkId(linkId, uploadId)
  if (!upload || upload.pathname.includes("..")) return new Response("Not found.", { status: 404 })
  const result = await get(upload.pathname, { access: "private" })
  if (!result?.stream || result.statusCode !== 200) return new Response("Not found.", { status: 404 })
  const contentType = result.blob.contentType || upload.content_type || "application/octet-stream"
  const inline = isSafeRasterImage(contentType)
  const filename = upload.filename.replace(/["\r\n]/g, "_")
  let body: ReadableStream<Uint8Array> | ArrayBuffer = result.stream
  if (inline) {
    try {
      const bytes = Buffer.from(await new Response(result.stream).arrayBuffer())
      const clean = await stripImageMetadata(bytes, contentType)
      const responseBytes = new Uint8Array(clean.byteLength)
      responseBytes.set(clean)
      body = responseBytes.buffer
    } catch {
      return new Response("This photo could not be processed safely.", { status: 422 })
    }
  }
  if (!await extendGlassLinkExpiry(linkId)) return new Response("Forbidden.", { status: 403 })
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Robots-Tag": "noindex, nofollow",
    },
  })
}
