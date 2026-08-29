import { createHash } from "node:crypto"
import { getGlassJob } from "@/lib/glass"
import { recordEvent } from "@/lib/events"
import { notifyAll } from "@/lib/notify"
import { getShopPhone } from "@/lib/shop-contact"
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
  return new Response("Use the correction button on your Customer Page.", {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return new Response("Request origin did not match.", { status: 403 })
  const formData = await req.formData().catch(() => null)
  const actionKey = String(formData?.get("actionKey") ?? "").trim().slice(0, 180)
  if (!/^glass-correction:[a-z0-9-]{36}$/i.test(actionKey)) {
    return new Response("Reload the Customer Page before sending a correction.", { status: 400 })
  }
  const { token } = await params
  const job = await getGlassJob(token)
  if (!job) return new Response("Customer Page not found.", { status: 404 })
  if (job.status === "closed") return new Response("This Customer Page is closed.", { status: 410 })
  if (job.is_test) return new Response("Internal test Customer Page — no shop alert sent.", { status: 200 })
  const fact = new URL(req.url).searchParams.get("fact")?.slice(0, 80) || "job"
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
  const limitKey = `glass-correction:${rateLimitFingerprint(`${token}:${ip}`)}`
  if (await consumeStrictRateLimit(limitKey, 10 * 60 * 1000, 3)) {
    return new Response("The shop already has your correction. Call if it is urgent.", { status: 429 })
  }
  const correctionKey = createHash("sha256")
    .update(`${job.token_hash}:${fact}:${actionKey}`)
    .digest("hex")
  const externalId = `glass-correction:${correctionKey}`
  let eventId = await recordEvent({
    kind: "glass.correction",
    actorType: "customer",
    leadId: job.lead_id,
    externalId,
    body: `Customer questioned the ${fact}`,
    detail: { actionKeyHash: correctionKey },
  })
  if (!eventId) {
    const sql = (await import("@/lib/db")).getSql()
    const existing = (await sql`
      SELECT id FROM events
      WHERE kind = 'glass.correction' AND external_id = ${externalId}::text
      LIMIT 1`) as { id: number }[]
    eventId = Number(existing[0]?.id) || null
  }
  if (eventId) {
    await notifyAll({ priority: "interrupt", stock: "red", title: `${job.first_name} spotted something`, body: `They questioned the ${fact} on the Customer Page.`, url: `/ops/leads/${job.lead_id}`, sourceEventId: eventId })
  }
  const shopPhone = getShopPhone()
  return Response.redirect(shopPhone.textReady
    ? `${shopPhone.smsHref}?&body=${encodeURIComponent(`Something looks wrong with the ${fact} on my MCSW Customer Page: `)}`
    : shopPhone.href, 303)
}
