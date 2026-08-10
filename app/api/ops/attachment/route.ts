import { get } from "@vercel/blob"
import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { isSafeRasterImage } from "@/lib/media-safety"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Attachment = { pathname: string; name?: string; contentType?: string; sensitivity?: string }

export async function GET(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return new Response("Not signed in.", { status: 401 })
  const url = new URL(req.url)
  const pathname = url.searchParams.get("path") ?? ""
  const leadId = Number(url.searchParams.get("lead"))
  if (!pathname || pathname.includes("..") || !Number.isInteger(leadId) || leadId <= 0) {
    return new Response("Invalid attachment.", { status: 400 })
  }
  const sql = getSql()
  const rows = (await sql`
    SELECT media_item.value AS attachment
    FROM messages m
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.media, '[]'::jsonb)) media_item
    WHERE m.lead_id = ${leadId}::bigint
      AND media_item.value->>'pathname' = ${pathname}::text
    UNION ALL
    SELECT attachment_item.value AS attachment
    FROM events e
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(e.detail->'attachments') = 'array' THEN e.detail->'attachments' ELSE '[]'::jsonb END
    ) attachment_item
    WHERE e.lead_id = ${leadId}::bigint
      AND attachment_item.value->>'pathname' = ${pathname}::text
    LIMIT 1`) as { attachment: Attachment }[]
  const attachment = rows[0]?.attachment
  if (!attachment) return new Response("Not found.", { status: 404 })
  const declaredName = attachment.name || pathname.split("/").pop() || "attachment"
  const classification = (await sql`
    SELECT sensitivity FROM ingest_attachments
    WHERE lead_id = ${leadId}::bigint AND blob_path = ${pathname}::text AND status = 'stored'
    LIMIT 1`) as { sensitivity: string }[]
  const sensitivity = classification[0]?.sensitivity || attachment.sensitivity || "unclassified"
  const crewSafe = sensitivity === "photo" || sensitivity === "drawing"
  if (operator.role === "crew" && !crewSafe) {
    return new Response("The owner keeps money-bearing paperwork.", { status: 403 })
  }
  const result = await get(pathname, { access: "private" })
  if (!result?.stream || result.statusCode !== 200) return new Response("Not found.", { status: 404 })
  const contentType = result.blob.contentType || attachment.contentType || "application/octet-stream"
  const safeDeclaredName = operator.role === "crew"
    ? sensitivity === "photo" ? "customer-photo" : "customer-drawing"
    : declaredName
  const filename = safeDeclaredName.replace(/["\r\n]/g, "_")
  const inline = sensitivity === "photo" && isSafeRasterImage(contentType)
  return new Response(result.stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=900",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  })
}
