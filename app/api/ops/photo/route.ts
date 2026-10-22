import { cookies } from "next/headers"
import { BlobStoreSuspendedError, get } from "@vercel/blob"
import { OPS_SESSION_COOKIE, validateSessionToken } from "@/lib/ops-auth"
import { getSql } from "@/lib/db"
import { isSafeRasterImage } from "@/lib/media-safety"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PHOTOS_SUSPENDED_MESSAGE = "Photos are unavailable until Nov 12 (storage suspended)"
const PHOTOS_SUSPENDED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 120" role="img" aria-label="${PHOTOS_SUSPENDED_MESSAGE}"><rect width="480" height="120" fill="#222"/><text x="240" y="65" fill="#eee" font-family="sans-serif" font-size="18" text-anchor="middle">${PHOTOS_SUSPENDED_MESSAGE}</text></svg>`

// Streams a private lead photo to a signed-in operator.
export async function GET(req: Request) {
  const cookieStore = await cookies()
  const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
  if (!operator) return new Response("Not signed in.", { status: 401 })

  const pathname = new URL(req.url).searchParams.get("path") ?? ""
  const leadId = Number(new URL(req.url).searchParams.get("lead"))
  if (!pathname || pathname.includes("..") || !Number.isInteger(leadId) || leadId <= 0) {
    return new Response("Invalid path.", { status: 400 })
  }
  const sql = getSql()
  const allowed = (await sql`
    SELECT photo->>'sensitivity' AS sensitivity, photo->>'contentType' AS content_type FROM leads l
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.photos, '[]'::jsonb)) photo
    WHERE l.id = ${leadId}::bigint
      AND photo->>'pathname' = ${pathname}::text
      AND (
        ${operator.role}::text = 'owner'
        OR (
          photo->>'sensitivity' = 'photo'
          AND lower(COALESCE(photo->>'contentType', '')) LIKE 'image/%'
        )
      )
    LIMIT 1`) as { sensitivity: string; content_type: string }[]
  if (!allowed[0]) return new Response("Not found.", { status: 404 })
  if (!isSafeRasterImage(allowed[0].content_type)) return new Response("Not found.", { status: 404 })

  try {
    const result = await get(pathname, { access: "private" })
    if (!result || result.statusCode !== 200 || !result.stream) {
      return new Response("Not found.", { status: 404 })
    }
    const contentType = result.blob.contentType || allowed[0].content_type
    if (!isSafeRasterImage(contentType)) return new Response("Not found.", { status: 404 })
    return new Response(result.stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    })
  } catch (error) {
    console.error("Photo fetch error:", error)
    // Blob store suspended (Hobby quota): show the reason where the photo would be.
    if (error instanceof BlobStoreSuspendedError || /suspended|403/i.test(error instanceof Error ? error.message : "")) {
      return new Response(PHOTOS_SUSPENDED_SVG, { status: 200, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" } })
    }
    return new Response("Not found.", { status: 404 })
  }
}
