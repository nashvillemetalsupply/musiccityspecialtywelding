import { cookies } from "next/headers"
import { getSql } from "@/lib/db"
import { OPS_SESSION_COOKIE, validateSessionToken } from "@/lib/ops-auth"
import { createExportResponse, ownerExportRefusal } from "./csv.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
  const refusal = ownerExportRefusal(operator)
  if (refusal) return refusal

  const format = new URL(req.url).searchParams.get("format") ?? "full"
  return createExportResponse(getSql(), format)
}
