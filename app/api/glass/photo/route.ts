import { get } from "@vercel/blob"
import { getGlassJob } from "@/lib/glass"
import { isSafeRasterImage } from "@/lib/media-safety"

export const runtime = "nodejs"
export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get("token") ?? ""
  const pathname = url.searchParams.get("path") ?? ""
  const job = await getGlassJob(token)
  const photo = job?.status === "closed" ? undefined : job?.photos?.find((item) => item.pathname === pathname && item.shared)
  if (!job || job.status === "closed" || !photo || pathname.includes("..") || !isSafeRasterImage(photo.contentType)) return new Response("Not found.", { status: 404 })
  const result = await get(pathname, { access: "private" })
  if (!result?.stream || result.statusCode !== 200) return new Response("Not found.", { status: 404 })
  const contentType = result.blob.contentType || photo.contentType
  if (!isSafeRasterImage(contentType)) return new Response("Not found.", { status: 404 })
  return new Response(result.stream, { headers: { "Content-Type": contentType, "Content-Disposition": "inline", "Cache-Control": "private, max-age=900", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } })
}
