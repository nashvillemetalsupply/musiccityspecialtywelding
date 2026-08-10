import { claimGlassReviewClick, getGlassJob } from "@/lib/glass"
import { recordEvent } from "@/lib/events"

export async function GET() {
  return new Response("Use the review button on your Customer Page.", { status: 405, headers: { Allow: "POST", "X-Robots-Tag": "noindex" } })
}

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const job = await getGlassJob(token)
  const reviewUrl = process.env.GOOGLE_REVIEW_URL?.trim()
  if (!job || job.status === "closed" || !job.completed_at || !job.paid_at || !reviewUrl) return new Response("Review card is closed.", { status: 410 })
  const claimed = await claimGlassReviewClick(job)
  if (claimed && !job.is_test) await recordEvent({ kind: "glass.review-clicked", actorType: "customer", leadId: job.lead_id, externalId: `glass-review:${job.token_hash}`, body: "Customer opened the Google review card", crewBody: "Customer opened the Google review card" })
  return Response.redirect(reviewUrl, 303)
}
