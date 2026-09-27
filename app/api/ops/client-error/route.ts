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

function safeText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return ""
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximumLength)
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
  if (!operator) return Response.json({ error: "Not signed in." }, { status: 401, headers: { "Cache-Control": "no-store" } })

  const contentLength = Number(request.headers.get("content-length") || "0")
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return Response.json({ error: "The error report is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } })
  }

  let report: ClientErrorReport
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== "object") throw new Error("Not an object.")
    report = body as ClientErrorReport
  } catch {
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
