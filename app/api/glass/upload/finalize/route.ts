import { createGlassUploadIntent, finalizeGlassUpload, GlassUploadIntentExpiredError } from "@/lib/glass-uploads"
import { after } from "next/server"
import { draftStoredGlassUpload, photoDraftsEnabled } from "@/lib/photo-drafts"
import { schedulePhotoDraftAfterFinalize } from "@/lib/photo-draft-workflow.ts"

export const runtime = "nodejs"
export const maxDuration = 60

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
      if (photoDraftsEnabled()) {
        try {
          schedulePhotoDraftAfterFinalize(upload, {
            enabled: true,
            after,
            run: draftStoredGlassUpload,
            onError: (error) => console.error("Photo draft step failed after glass upload:", error),
          })
        } catch (error) {
          console.error("Photo draft scheduling failed after glass upload:", error)
        }
      }
      return Response.json({ ok: true, upload: { id: upload.id, status: upload.status } }, { headers: { "Cache-Control": "no-store" } })
    }
    return Response.json({ error: "Unknown upload action." }, { status: 400 })
  } catch (error) {
    const expired = error instanceof GlassUploadIntentExpiredError
    if (!expired) console.error("Glass upload finalization failed:", error)
    return Response.json(
      { error: expired ? "That upload request expired. Choose the file again." : "The file could not be filed yet. Try again in a moment.", code: expired ? error.code : undefined },
      { status: expired ? 410 : 400, headers: { "Cache-Control": "no-store" } },
    )
  }
}
