import { normalizePhone } from "@/lib/people"
import {
  OPS_SESSION_COOKIE,
  OPS_SESSION_MAX_AGE_SECONDS,
  redeemSmsLoginCode,
  redeemSmsVerificationIntent,
} from "@/lib/ops-auth"
import { consumeStrictRateLimit, rateLimitFingerprint } from "@/lib/rate-limit"
import { getOperatorByPhone, getOperatorByPunchSelector } from "@/lib/operators"
import { checkPhoneLoginVerification, twilioVerifyConfigured } from "@/lib/twilio"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { phone?: string; code?: string; selector?: string } | null
  const selectedOperator = body?.selector ? await getOperatorByPunchSelector(body.selector) : null
  const phone = normalizePhone(selectedOperator?.cell_phone || body?.phone || "")
  const code = String(body?.code ?? "").trim()
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
  const [ipLimited, phoneLimited] = await Promise.all([
    consumeStrictRateLimit(`ops-sms-verify:ip:${rateLimitFingerprint(ip)}`, 15 * 60 * 1000, 30),
    consumeStrictRateLimit(`ops-sms-verify:phone:${rateLimitFingerprint(phone || "invalid")}`, 15 * 60 * 1000, 8),
  ])
  if (ipLimited || phoneLimited) {
    return Response.json({ ok: false, error: "Too many code attempts. Request a fresh code later." }, { status: 429 })
  }
  const operator = selectedOperator ?? (phone ? await getOperatorByPhone(phone) : null)
  let session: string | null = null
  if (operator && phone && /^\d{6}$/.test(code)) {
    if (twilioVerifyConfigured()) {
      const approved = await checkPhoneLoginVerification(phone, code).catch((error) => {
        console.error("Twilio Verify sign-in check failed:", error)
        return false
      })
      session = approved ? await redeemSmsVerificationIntent(operator) : null
    } else {
      session = await redeemSmsLoginCode(phone, code)
    }
  }
  if (!session) {
    return Response.json({ ok: false, error: "That code is wrong or expired. Request another." }, { status: 400 })
  }
  const response = Response.json({ ok: true })
  response.headers.append(
    "Set-Cookie",
    `${OPS_SESSION_COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${OPS_SESSION_MAX_AGE_SECONDS}`
  )
  return response
}
