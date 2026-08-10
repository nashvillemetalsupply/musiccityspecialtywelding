import { get } from "@vercel/blob"
import { getStoredGlassUpload } from "@/lib/glass-uploads"
import { isSafeRasterImage } from "@/lib/media-safety"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("token") ?? ""
  const uploadId = url.searchParams.get("upload") ?? ""
  const upload = await getStoredGlassUpload(token, uploadId)
  if (!upload || upload.pathname.includes("..")) return new Response("Not found.", { status: 404 })
  const result = await get(upload.pathname, { access: "private" })
  if (!result?.stream || result.statusCode !== 200) return new Response("Not found.", { status: 404 })
  const contentType = result.blob.contentType || upload.content_type || "application/octet-stream"
  const inline = isSafeRasterImage(contentType)
  const filename = upload.filename.replace(/["\r\n]/g, "_")
  return new Response(result.stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Robots-Tag": "noindex, nofollow",
    },
  })
}
