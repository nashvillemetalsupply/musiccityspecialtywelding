import { createGlassUploadIntent, finalizeGlassUpload, GlassUploadIntentExpiredError } from "@/lib/glass-uploads"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>
    const action = String(body.action ?? "")
    const token = String(body.token ?? "")
    if (!/^[a-f0-9]{64}$/i.test(token)) return Response.json({ error: "This Customer Page link is invalid." }, { status: 401 })
    if (action === "intent") {
      const intent = await createGlassUploadIntent({
        token,
        uploadId: String(body.uploadId ?? ""),
        batchId: String(body.batchId ?? ""),
        filename: String(body.filename ?? ""),
        contentType: String(body.contentType ?? ""),
        size: Number(body.size),
      })
      return Response.json({ ok: true, upload: intent }, { headers: { "Cache-Control": "no-store" } })
    }
    if (action === "complete") {
      const upload = await finalizeGlassUpload({ uploadId: String(body.uploadId ?? ""), token })
      return Response.json({ ok: true, upload: { id: upload.id, status: upload.status } }, { headers: { "Cache-Control": "no-store" } })
    }
    return Response.json({ error: "Unknown upload action." }, { status: 400 })
  } catch (error) {
    const expired = error instanceof GlassUploadIntentExpiredError
    return Response.json(
      { error: error instanceof Error ? error.message : "The file could not be filed.", code: expired ? error.code : undefined },
      { status: expired ? 410 : 400, headers: { "Cache-Control": "no-store" } },
    )
  }
}
