import { buildSheetsEnabled } from "@/lib/build-sheets-access"
import { respondToCustomerBuildFact } from "@/lib/build-sheets"
import { getGlassJob } from "@/lib/glass"
import { consumeStrictRateLimit, rateLimitFingerprint } from "@/lib/rate-limit"

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(req.url).origin
  } catch {
    return false
  }
}

export async function GET() {
  return new Response("Use the confirmation controls on your Customer Page.", {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return new Response("Request origin did not match.", { status: 403 })
  if (!buildSheetsEnabled()) return new Response("Not found.", { status: 404 })
  const { token } = await params
  const job = await getGlassJob(token)
  if (!job || !job.is_test) return new Response("Not found.", { status: 404 })
  if (job.status === "closed") return new Response("This Customer Page is closed.", { status: 410 })
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
  const limitKey = `customer-build:${rateLimitFingerprint(`${token}:${ip}`)}`
  if (await consumeStrictRateLimit(limitKey, 10 * 60 * 1000, 12)) {
    return new Response("Your responses are already reaching the shop. Wait a moment before trying again.", { status: 429 })
  }
  const formData = await req.formData()
  const intent = String(formData.get("intent") ?? "")
  const buildSheetNumber = Number(formData.get("buildSheetNumber"))
  const claimId = Number(formData.get("claimId"))
  const responseKey = String(formData.get("responseKey") ?? "")
  if (!["accept", "correct"].includes(intent) || !Number.isInteger(buildSheetNumber) || !Number.isInteger(claimId)) {
    return new Response("Choose a current build fact.", { status: 400 })
  }
  try {
    const response = await respondToCustomerBuildFact({
      leadId: Number(job.lead_id),
      tokenHash: job.token_hash,
      buildSheetNumber,
      claimId,
      intent: intent as "accept" | "correct",
      correction: String(formData.get("correction") ?? ""),
      responseKey,
    })
    const target = new URL(`/j/${token}`, req.url)
    target.searchParams.set("build", response.state)
    target.hash = "what-we-understand"
    return Response.redirect(target, 303)
  } catch (error) {
    const message = error instanceof Error ? error.message : "The build response could not be filed."
    return new Response(message, { status: /newer Build Sheet/i.test(message) ? 409 : 400 })
  }
}
