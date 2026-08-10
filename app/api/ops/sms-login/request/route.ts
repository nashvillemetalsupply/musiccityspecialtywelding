import { dbConfigured } from "@/lib/db"
import { after } from "next/server"
import { createSmsLoginCode } from "@/lib/ops-auth"
import { getOperatorByPhone, getOperatorByPunchSelector } from "@/lib/operators"
import { normalizePhone } from "@/lib/people"
import { consumeStrictRateLimit, rateLimitFingerprint } from "@/lib/rate-limit"
import { sendSms, twilioSmsConfigured } from "@/lib/twilio"

export const runtime = "nodejs"

const generic = () =>
  Response.json({ ok: true, message: "If that number belongs to an active team member, a code is on its way." })

export async function POST(req: Request) {
  if (!dbConfigured() || !twilioSmsConfigured()) {
    return Response.json({ ok: false, error: "Text sign-in is not ready yet. Use email." }, { status: 503 })
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const body = (await req.json().catch(() => null)) as { phone?: string; selector?: string } | null
  const selectedOperator = body?.selector ? await getOperatorByPunchSelector(body.selector) : null
  const phone = normalizePhone(selectedOperator?.cell_phone || body?.phone || "")
  const [ipLimited, phoneLimited] = await Promise.all([
    consumeStrictRateLimit(`ops-sms-request:ip:${rateLimitFingerprint(ip)}`, 15 * 60 * 1000, 8),
    consumeStrictRateLimit(`ops-sms-request:phone:${rateLimitFingerprint(phone || "invalid")}`, 15 * 60 * 1000, 5),
  ])
  if (ipLimited || phoneLimited) {
    return Response.json({ ok: false, error: "Too many code requests. Wait a few minutes." }, { status: 429 })
  }
  const operator = selectedOperator ?? (phone ? await getOperatorByPhone(phone) : null)
  if (!operator) return generic()

  const code = await createSmsLoginCode(operator).catch((error) => {
    console.error("Punch-code intent could not be created:", error)
    return ""
  })
  if (!code) return generic()
  after(() => sendSms({ to: phone, body: `${code} is your code for MCSW Jobs. It expires in 10 minutes.` })
    .catch((error) => console.error("Punch-code text failed after the generic response:", error)))
  return generic()
}
