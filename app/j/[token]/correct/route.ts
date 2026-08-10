import { getGlassJob } from "@/lib/glass"
import { recordEvent } from "@/lib/events"
import { notifyAll } from "@/lib/notify"
import { getShopPhone } from "@/lib/shop-contact"
import { consumeStrictRateLimit, rateLimitFingerprint } from "@/lib/rate-limit"

export async function GET() {
  return new Response("Use the correction button on your Customer Page.", {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
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
  const bucket = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date())
  let eventId = await recordEvent({
    kind: "glass.correction",
    actorType: "customer",
    leadId: job.lead_id,
    externalId: `glass-correction:${job.token_hash}:${fact}:${bucket}`,
    body: `Customer questioned the ${fact}`,
  })
  if (!eventId) {
    const sql = (await import("@/lib/db")).getSql()
    const existing = (await sql`
      SELECT id FROM events
      WHERE kind = 'glass.correction' AND external_id = ${`glass-correction:${job.token_hash}:${fact}:${bucket}`}::text
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
