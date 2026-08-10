import { randomUUID } from "node:crypto"
import { put } from "@vercel/blob"
import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator || operator.role !== "owner") return Response.json({ ok: false, error: "Owner access required." }, { status: 403 })
  const form = await req.formData()
  const kind = String(form.get("kind") ?? "")
  const file = form.get("file")
  const expiresRaw = String(form.get("expiresAt") ?? "").trim()
  if (!['w9', 'coi'].includes(kind) || !(file instanceof File) || file.type !== "application/pdf" || file.size <= 0 || file.size > 10_000_000) {
    return Response.json({ ok: false, error: "Choose a W-9 or insurance PDF under 10 MB." }, { status: 400 })
  }
  const expiresAt = expiresRaw ? new Date(`${expiresRaw}T12:00:00-05:00`).toISOString() : null
  const attemptId = randomUUID()
  const sql = getSql()
  await sql`
    INSERT INTO shop_document_attempts (id, kind, filename, expires_at, uploaded_by)
    VALUES (${attemptId}::text, ${kind}::text, ${file.name.slice(0, 200)}::text,
      ${expiresAt}::timestamptz, ${operator.id}::bigint)`
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-")
    const blob = await put(`shop-documents/${kind}-${Date.now()}-${safeName}`, file, {
      access: "private",
      addRandomSuffix: true,
    })
    await sql`
      WITH stored AS (
        UPDATE shop_document_attempts SET blob_path = ${blob.pathname}::text,
          status = 'stored', error = '', updated_at = now()
        WHERE id = ${attemptId}::text AND status = 'pending'
        RETURNING kind, filename, expires_at, uploaded_by, blob_path
      )
      INSERT INTO shop_documents (kind, pathname, filename, expires_at, uploaded_by, status, error)
      SELECT kind, blob_path, filename, expires_at, uploaded_by, 'ready', '' FROM stored
      ON CONFLICT (kind) DO UPDATE SET
        pathname = EXCLUDED.pathname, filename = EXCLUDED.filename,
        expires_at = EXCLUDED.expires_at, uploaded_at = now(),
        uploaded_by = EXCLUDED.uploaded_by, status = 'ready', error = ''`
    return Response.redirect(new URL("/ops/shop", req.url), 303)
  } catch (error) {
    await sql`
      UPDATE shop_document_attempts SET status = 'failed', error = ${error instanceof Error ? error.message.slice(0, 500) : "Upload failed"}::text, updated_at = now()
      WHERE id = ${attemptId}::text`
    return Response.json({ ok: false, error: "The PDF could not be filed. Try again." }, { status: 500 })
  }
}
