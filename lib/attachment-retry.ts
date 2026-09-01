import { put } from "@vercel/blob"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { gmailAccessToken } from "@/lib/gmail"
import { notifyAll } from "@/lib/notify"
import { isSafeRasterImage } from "@/lib/media-safety"
import { classifyInboundAttachmentSensitivity } from "@/lib/shop-brain-invariants.mjs"

type AttachmentRow = {
  id: number; provider: "gmail" | "twilio"; external_message_id: string; attachment_key: string
  lead_id: number; person_id: number | null; filename: string; content_type: string
  source_url: string; source_detail: { attachmentId?: string; inlineData?: string; messageId?: number; index?: number }
  status: string; attempts: number; sensitivity: string; blob_path: string; blob_size: number | null
}

export type AttachmentSensitivity = "photo" | "drawing" | "owner_paperwork" | "unclassified"

export function classifyAttachmentSensitivity(filename: string, contentType: string, context = ""): AttachmentSensitivity {
  return classifyInboundAttachmentSensitivity(filename, contentType, context) as AttachmentSensitivity
}

function decodeBase64Url(data: string) { return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64") }

export async function queueIngestAttachment(input: {
  provider: "gmail" | "twilio"; externalMessageId: string; attachmentKey: string
  leadId: number; personId?: number | null; filename: string; contentType: string
  sourceUrl?: string; sourceDetail?: Record<string, unknown>; sensitivity?: AttachmentSensitivity
  context?: string
}) {
  const sql = getSql()
  const rows = (await sql`
    INSERT INTO ingest_attachments (
      provider, external_message_id, attachment_key, lead_id, person_id,
      filename, content_type, source_url, source_detail, sensitivity
    ) VALUES (
      ${input.provider}::text, ${input.externalMessageId}::text, ${input.attachmentKey}::text,
      ${input.leadId}::bigint, ${input.personId ?? null}::bigint, ${input.filename}::text,
      ${input.contentType}::text, ${input.sourceUrl ?? ""}::text, ${JSON.stringify(input.sourceDetail ?? {})}::jsonb,
      ${input.sensitivity ?? classifyAttachmentSensitivity(input.filename, input.contentType, input.context)}::text
    ) ON CONFLICT (provider, external_message_id, attachment_key) DO UPDATE SET updated_at = ingest_attachments.updated_at
    RETURNING id`) as { id: number }[]
  return Number(rows[0].id)
}

async function gmailBytes(row: AttachmentRow, token: string) {
  const inline = row.source_detail.inlineData
  if (inline) return decodeBase64Url(inline)
  const attachmentId = row.source_detail.attachmentId
  if (!attachmentId) throw new Error("Gmail attachment pointer is missing.")
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(row.external_message_id)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
  const data = await response.json().catch(() => null) as { data?: string; error?: { message?: string } } | null
  if (!response.ok || !data?.data) throw new Error(data?.error?.message || `Gmail attachment fetch failed (${response.status}).`)
  return decodeBase64Url(data.data)
}

async function twilioBytes(row: AttachmentRow) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? ""
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? ""
  const response = await fetch(row.source_url, { headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` }, cache: "no-store" })
  if (!response.ok) throw new Error(`Twilio media fetch failed (${response.status}).`)
  return Buffer.from(await response.arrayBuffer())
}

export async function storeQueuedAttachment(id: number, gmailToken?: string) {
  const sql = getSql()
  const claimed = (await sql`
    UPDATE ingest_attachments SET attempts = attempts + 1,
      status = CASE WHEN status = 'projecting' THEN 'projecting' ELSE 'copying' END,
      updated_at = now()
    WHERE id = ${id}::bigint AND (
        status IN ('pending','failed')
        OR (status = 'copying' AND updated_at < now() - interval '10 minutes')
        OR (status = 'projecting' AND updated_at < now() - interval '10 minutes')
      )
      AND attempts < CASE WHEN provider = 'gmail' THEN 72 ELSE 12 END
    RETURNING *`) as AttachmentRow[]
  const row = claimed[0]
  if (!row) return null
  let projectionReady = row.status === "projecting" && Boolean(row.blob_path)
  try {
    let pathname = row.blob_path
    let size = Number(row.blob_size ?? 0)
    if (!projectionReady) {
      const bytes = row.provider === "gmail" ? await gmailBytes(row, gmailToken || await gmailAccessToken()) : await twilioBytes(row)
      if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new Error("Attachment is empty or exceeds 20 MB.")
      const folder = row.provider === "gmail" ? "email" : "messages"
      const extension = row.filename.match(/\.[a-z0-9]{1,8}$/i)?.[0]?.toLowerCase() ?? ""
      const blob = await put(`leads/${row.lead_id}/${folder}/${row.external_message_id}/${row.id}${extension}`, bytes, { access: "private", contentType: row.content_type, allowOverwrite: true })
      pathname = blob.pathname
      size = bytes.byteLength
      const copied = (await sql`
        UPDATE ingest_attachments SET status = 'projecting', blob_path = ${pathname}::text,
          blob_size = ${size}::bigint, last_error = '', updated_at = now()
        WHERE id = ${id}::bigint AND status = 'copying' RETURNING id`) as { id: number }[]
      if (!copied[0]) return null
      projectionReady = true
    }
    const item = { pathname, name: row.filename, contentType: row.content_type, size, sensitivity: row.sensitivity }
    if (row.provider === "twilio") {
      if (row.source_detail.messageId && Number.isInteger(row.source_detail.index)) await sql`
        UPDATE messages SET media = jsonb_set(COALESCE(media, '[]'::jsonb),
          ARRAY[${String(row.source_detail.index)}::text], ${JSON.stringify(item)}::jsonb, true)
        WHERE id = ${row.source_detail.messageId}::bigint`
      // Only verified images become work-order photos. Drawings and paperwork
      // stay on the authenticated attachment path with their sensitivity.
      if (row.sensitivity === "photo" && isSafeRasterImage(row.content_type)) {
        await sql`
          UPDATE leads SET photos = CASE
              WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(photos, '[]'::jsonb)) p WHERE p->>'pathname' = ${pathname}::text)
                THEN COALESCE(photos, '[]'::jsonb)
              ELSE COALESCE(photos, '[]'::jsonb) || ${JSON.stringify([item])}::jsonb
            END,
            photo_count = CASE
              WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(photos, '[]'::jsonb)) p WHERE p->>'pathname' = ${pathname}::text)
                THEN jsonb_array_length(COALESCE(photos, '[]'::jsonb))
              ELSE jsonb_array_length(COALESCE(photos, '[]'::jsonb) || ${JSON.stringify([item])}::jsonb)
            END, updated_at = now()
          WHERE id = ${row.lead_id}::bigint`
        await recordEvent({ kind: "photo.added", actorType: "system", leadId: row.lead_id, personId: row.person_id, externalId: `attachment-photo:${id}`, body: "1 job photo attached", crewBody: "1 job photo attached", detail: { photos: [item], attachmentId: id } })
      }
    } else {
      const crewLabel = row.sensitivity === "photo" ? "A customer photo was filed from email." : row.sensitivity === "drawing" ? "A customer drawing was filed from email." : "Owner paperwork was filed from email."
      await recordEvent({ kind: "email.attachments", actorType: "system", leadId: row.lead_id, personId: row.person_id, externalId: `attachment:${id}`, body: `${row.filename} filed from email`, crewBody: crewLabel, detail: { attachments: [item], sourceMessageId: row.external_message_id } })
    }
    await sql`UPDATE ingest_attachments SET status = 'stored', projected_at = now(), last_error = '', updated_at = now() WHERE id = ${id}::bigint AND status = 'projecting'`
    return item
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attachment copy failed."
    await sql`UPDATE ingest_attachments SET status = ${projectionReady ? "projecting" : "failed"}::text, last_error = ${message.slice(0, 500)}::text, updated_at = now() WHERE id = ${id}::bigint`
    return null
  }
}

export async function retryPendingAttachments(limit = 12) {
  const sql = getSql()
  const rows = (await sql`
    SELECT id, provider FROM ingest_attachments
    WHERE (
        status IN ('pending','failed')
        OR (status = 'copying' AND updated_at < now() - interval '10 minutes')
        OR (status = 'projecting' AND updated_at < now() - interval '10 minutes')
      )
      AND attempts < CASE WHEN provider = 'gmail' THEN 72 ELSE 12 END
      AND (
        (status = 'copying' AND updated_at < now() - interval '10 minutes')
        OR (status = 'projecting' AND updated_at < now() - interval '10 minutes')
        OR updated_at < now() - CASE WHEN provider = 'gmail' THEN interval '30 minutes' ELSE interval '5 minutes' END
      )
    ORDER BY updated_at ASC LIMIT ${Math.min(Math.max(limit, 1), 30)}::bigint`) as { id: number; provider: string }[]
  const needsGmail = rows.some((row) => row.provider === "gmail")
  const token = needsGmail ? await gmailAccessToken().catch(() => "") : ""
  let stored = 0
  for (const row of rows) if (await storeQueuedAttachment(Number(row.id), row.provider === "gmail" ? token : undefined)) stored += 1
  const exhausted = (await sql`
    SELECT id, lead_id, person_id, filename, sensitivity
    FROM ingest_attachments
    WHERE (status = 'failed' OR (status IN ('copying','projecting') AND updated_at < now() - interval '10 minutes'))
      AND dead_lettered_at IS NULL
      AND attempts >= CASE WHEN provider = 'gmail' THEN 72 ELSE 12 END
    ORDER BY updated_at ASC LIMIT 10`) as Array<{ id: number; lead_id: number; person_id: number | null; filename: string; sensitivity: string }>
  for (const item of exhausted) {
    let eventId = await recordEvent({ kind: "attachment.needs-help", actorType: "system", leadId: item.lead_id, personId: item.person_id, externalId: `attachment-dead:${item.id}`, body: `${item.filename} could not be stored after repeated attempts.`, crewBody: "A customer attachment needs the owner's help.", detail: { attachmentId: item.id, sensitivity: item.sensitivity } })
    if (!eventId) {
      const prior = (await sql`SELECT id FROM events WHERE kind = 'attachment.needs-help' AND external_id = ${`attachment-dead:${item.id}`}::text LIMIT 1`) as { id: number }[]
      eventId = Number(prior[0]?.id) || null
    }
    await notifyAll({ priority: "digest", stock: "red", title: "Customer attachment needs help", body: `${item.filename} did not make it into the work order.`, crewBody: "A customer attachment needs the owner's help.", url: `/ops/leads/${item.lead_id}#spike`, sourceEventId: eventId, ownerOnly: true, dedupeKey: `attachment-dead:${item.id}`, actionKind: "attachment-retry", actionDetail: { attachmentId: item.id } })
    await sql`UPDATE ingest_attachments SET dead_lettered_at = now() WHERE id = ${item.id}::bigint AND dead_lettered_at IS NULL`
  }
  return { attempted: rows.length, stored, deadLetters: exhausted.length }
}
