import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { cookies } from "next/headers"
import { closeoutPhotoPath, confirmCloseoutPhotoUpload, createCloseoutPhotoUpload, type CloseoutPhotoMode } from "@/lib/closeout-photo-uploads"
import { OPS_SESSION_COOKIE, validateSessionToken } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ClientPayload = {
  uploadId: string
  leadId: number
  mode: CloseoutPhotoMode
  originalName: string
  contentType: string
  sizeBytes: number
}

function parseClientPayload(value: string | null | undefined): ClientPayload {
  if (!value || value.length > 1200) throw new Error("The closeout photo receipt is missing.")
  let payload: unknown
  try {
    payload = JSON.parse(value)
  } catch {
    throw new Error("The closeout photo receipt is invalid.")
  }
  if (!payload || typeof payload !== "object") throw new Error("The closeout photo receipt is invalid.")
  const candidate = payload as Partial<ClientPayload>
  if (typeof candidate.uploadId !== "string"
    || typeof candidate.leadId !== "number"
    || typeof candidate.mode !== "string"
    || typeof candidate.originalName !== "string"
    || typeof candidate.contentType !== "string"
    || typeof candidate.sizeBytes !== "number") {
    throw new Error("The closeout photo receipt is incomplete.")
  }
  return candidate as ClientPayload
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0")
  if (Number.isFinite(contentLength) && contentLength > 16 * 1024) {
    return Response.json({ error: "The upload request is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } })
  }

  try {
    const body = await request.json() as HandleUploadBody
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Vercel calls this handler again for its signed completion callback,
        // which has no operator cookie. Authenticate only token issuance here;
        // handleUpload validates the provider callback signature itself.
        const cookieStore = await cookies()
        const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
        if (!operator) throw new Error("Not signed in.")
        const payload = parseClientPayload(clientPayload)
        await createCloseoutPhotoUpload({
          operator,
          id: payload.uploadId,
          leadId: payload.leadId,
          mode: payload.mode,
          originalName: payload.originalName,
          contentType: payload.contentType,
          sizeBytes: payload.sizeBytes,
          pathname,
        })
        return {
          allowedContentTypes: [payload.contentType.trim().toLowerCase()],
          maximumSizeInBytes: 12 * 1024 * 1024,
          validUntil: Date.now() + 15 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({ uploadId: payload.uploadId }),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let receipt: { uploadId?: string }
        try {
          receipt = JSON.parse(tokenPayload || "{}") as { uploadId?: string }
        } catch {
          throw new Error("The Blob callback did not include a valid closeout receipt.")
        }
        if (!receipt.uploadId) throw new Error("The Blob callback did not include a closeout receipt.")
        await confirmCloseoutPhotoUpload(receipt.uploadId, blob.pathname)
      },
    })
    return Response.json(response, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Closeout photo upload authorization failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }
}
