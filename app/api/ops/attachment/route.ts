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
  const access = (await sql`
    SELECT l.is_test AS lead_is_test, COALESCE(p.is_test, false) AS person_is_test
    FROM leads l
    LEFT JOIN people p ON p.id = l.person_id
    WHERE l.id = ${leadId}::bigint
    LIMIT 1`) as { lead_is_test: boolean; person_is_test: boolean }[]
  if (!access[0]) return new Response("Not found.", { status: 404 })
  if (operator.role === "crew" && (access[0].lead_is_test || access[0].person_is_test)) {
    return new Response("Not found.", { status: 404 })
  }
  const rows = (await sql`
    SELECT media_item.value AS attachment,
      (COALESCE(message_person.is_test, false)
        OR COALESCE(m.body, '') ILIKE '%[INTERNAL TEST]%') AS source_is_test
    FROM messages m
    LEFT JOIN people message_person ON message_person.id = m.person_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.media, '[]'::jsonb)) media_item
    WHERE m.lead_id = ${leadId}::bigint
      AND media_item.value->>'pathname' = ${pathname}::text
    UNION ALL
    SELECT attachment_item.value AS attachment,
      (COALESCE(event_person.is_test, false)
        OR COALESCE(LOWER(e.detail->>'isTest'), 'false') = 'true'
        OR CONCAT_WS(' ', COALESCE(e.body, ''), COALESCE(e.crew_body, '')) ILIKE '%[INTERNAL TEST]%') AS source_is_test
    FROM events e
    LEFT JOIN people event_person ON event_person.id = e.person_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(e.detail->'attachments') = 'array' THEN e.detail->'attachments' ELSE '[]'::jsonb END
    ) attachment_item
    WHERE e.lead_id = ${leadId}::bigint
      AND attachment_item.value->>'pathname' = ${pathname}::text
    LIMIT 1`) as { attachment: Attachment; source_is_test: boolean }[]
  const attachmentRow = rows[0]
  const attachment = attachmentRow?.attachment
  if (!attachment) return new Response("Not found.", { status: 404 })
  if (operator.role === "crew" && attachmentRow.source_is_test) {
    return new Response("Not found.", { status: 404 })
  }
  const declaredName = attachment.name || pathname.split("/").pop() || "attachment"
  const classification = (await sql`
    SELECT item.sensitivity,
      (COALESCE(item_person.is_test, false)
        OR COALESCE(LOWER(item.source_detail->>'isTest'), 'false') = 'true') AS source_is_test
    FROM ingest_attachments item
    LEFT JOIN people item_person ON item_person.id = item.person_id
    WHERE item.lead_id = ${leadId}::bigint AND item.blob_path = ${pathname}::text AND item.status = 'stored'
    LIMIT 1`) as { sensitivity: string; source_is_test: boolean }[]
  if (operator.role === "crew" && classification[0]?.source_is_test) {
    return new Response("Not found.", { status: 404 })
  }
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
