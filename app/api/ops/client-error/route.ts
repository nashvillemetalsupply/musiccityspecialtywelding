import { cookies } from "next/headers"
import { getSql } from "@/lib/db"
import { OPS_SESSION_COOKIE, validateSessionToken } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ClientErrorReport = {
  message?: unknown
  digest?: unknown
  route?: unknown
}

const MAX_REPORT_BYTES = 4096

class ClientErrorPayloadTooLarge extends Error {}

function safeText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return ""
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximumLength)
}

async function readReport(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error("The error report is empty.")

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_REPORT_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new ClientErrorPayloadTooLarge()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
  if (!operator) return Response.json({ error: "Not signed in." }, { status: 401, headers: { "Cache-Control": "no-store" } })

  const contentLength = Number(request.headers.get("content-length") || "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES) {
    return Response.json({ error: "The error report is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } })
  }

  let report: ClientErrorReport
  try {
    const body: unknown = await readReport(request)
    if (!body || typeof body !== "object") throw new Error("Not an object.")
    report = body as ClientErrorReport
  } catch (error) {
    if (error instanceof ClientErrorPayloadTooLarge) {
      return Response.json({ error: "The error report is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } })
    }
    return Response.json({ error: "The error report is invalid." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
  const message = safeText(report.message, 500)
  const digest = safeText(report.digest, 160)
  const route = report.route === "/board" ? "/board" : ""
  if (!message && !digest) {
    return Response.json({ error: "The error report is empty." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  try {
    const sql = getSql()
    await sql`
      INSERT INTO trouble_reports (source, message, digest, route, reported_by, is_test)
      VALUES (
        'board-client-error'::text, ${message}::text, ${digest}::text,
        ${route}::text, ${operator.id}::bigint,
        ${process.env.VERCEL_ENV?.trim().toLowerCase() !== "production"}::boolean
      )`
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Board client error report could not be saved:", error)
    return Response.json({ error: "The error report could not be saved." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
