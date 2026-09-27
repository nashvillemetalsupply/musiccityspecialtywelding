import { claimGlassReviewClick, getGlassJob } from "@/lib/glass"
import { recordEvent } from "@/lib/events"

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
  return new Response("Use the review button on your Customer Page.", { status: 405, headers: { Allow: "POST", "X-Robots-Tag": "noindex" } })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return new Response("Request origin did not match.", { status: 403 })
  const { token } = await params
  const job = await getGlassJob(token)
  const reviewUrl = process.env.GOOGLE_REVIEW_URL?.trim()
  if (!job || job.status === "closed" || !job.completed_at || !job.paid_at || !reviewUrl) return new Response("Review card is closed.", { status: 410 })
  const claimed = await claimGlassReviewClick(job)
  if (claimed && !job.is_test) await recordEvent({ kind: "glass.review-clicked", actorType: "customer", leadId: job.lead_id, externalId: `glass-review:${job.token_hash}`, body: "Customer opened the Google review card", crewBody: "Customer opened the Google review card" })
  return Response.redirect(reviewUrl, 303)
}
