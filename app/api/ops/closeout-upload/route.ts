import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { cookies } from "next/headers"
import { confirmCloseoutPhotoUpload, createCloseoutPhotoUpload, recoverCloseoutPhotoUpload, type CloseoutPhotoMode } from "@/lib/closeout-photo-uploads"
import { OPS_SESSION_COOKIE, validateSessionToken } from "@/lib/ops-auth"
import { voiceOperatorScope } from "@/lib/voice-outbox-scope.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" }
  const cookieStore = await cookies()
  const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401, headers })
  if (request.headers.get("x-voice-operator-scope") !== voiceOperatorScope(operator)) {
    return Response.json({ error: "The signed-in operator changed. Your photo remains on its original device." }, { status: 409, headers })
  }
  const query = new URL(request.url).searchParams
  try {
    return Response.json(await recoverCloseoutPhotoUpload({
      operator,
      id: query.get("uploadId") || "",
      leadId: Number(query.get("leadId")),
      mode: query.get("mode") as CloseoutPhotoMode,
    }), { headers })
  } catch {
    return Response.json({ error: "Photo storage is temporarily unavailable. Saved on this device; will retry.", retryable: true }, {
      status: 503, headers: { ...headers, "Retry-After": "3600" },
    })
  }
}

type ClientPayload = {
  uploadId: string
  leadId: number
  mode: CloseoutPhotoMode
  originalName: string
  contentType: string
  sizeBytes: number
  operatorScope?: string
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
    || typeof candidate.sizeBytes !== "number"
    || (candidate.operatorScope !== undefined && typeof candidate.operatorScope !== "string")) {
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
        if (payload.operatorScope !== undefined && payload.operatorScope !== voiceOperatorScope(operator)) {
          throw new Error("The signed-in operator changed. The photo remains saved for its original operator.")
        }
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
          allowOverwrite: false,
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
