import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { authorizeGlassUploadToken, finalizeGlassUpload } from "@/lib/glass-uploads"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = await request.json() as HandleUploadBody
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const authorized = await authorizeGlassUploadToken(pathname, clientPayload)
        return {
          allowedContentTypes: [authorized.contentType],
          maximumSizeInBytes: authorized.maximumSizeInBytes,
          validUntil: Date.now() + 15 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({ uploadId: authorized.uploadId }),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = JSON.parse(tokenPayload || "{}") as { uploadId?: string }
        if (!payload.uploadId) throw new Error("Blob callback did not include an upload receipt.")
        await finalizeGlassUpload({ uploadId: payload.uploadId, callbackPathname: blob.pathname })
      },
    })
    return Response.json(response, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Glass upload failed:", error)
    return Response.json(
      { error: "This file could not be uploaded. Check it and try again." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }
}
