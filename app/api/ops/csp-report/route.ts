import { createCspReportPost } from "@/lib/csp-report.ts"
import { consumeStrictRateLimit, rateLimitFingerprint } from "@/lib/rate-limit"
import { isTestContext, writeTroubleReport } from "@/lib/trouble-reports"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const postCspReport = createCspReportPost({
  rateLimit: async (request) => {
    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")?.trim()
      || "unknown"
    const ip = clientIp.slice(0, 128) || "unknown"
    const fingerprint = rateLimitFingerprint(ip)
    return consumeStrictRateLimit(`csp-report:ip:${fingerprint}`, 15 * 60 * 1000, 60)
  },
  writeTroubleReport,
  isTestContext,
})

export const POST = postCspReport
