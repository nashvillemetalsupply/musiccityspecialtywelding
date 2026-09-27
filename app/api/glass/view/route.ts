import { getGlassJob, noteGlassView } from "@/lib/glass"
import { recordEvent } from "@/lib/events"
import { getSql } from "@/lib/db"
import { notifyAll } from "@/lib/notify"

export const dynamic = "force-dynamic"

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(req.url).origin
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Request origin did not match.", { status: 403 })
  const input = await req.json().catch(() => null) as { token?: unknown } | null
  const token = typeof input?.token === "string" ? input.token : ""
  const job = await getGlassJob(token)
  if (!job || job.status === "closed") return new Response("This Customer Page is closed.", { status: 410 })
  if (job.is_test) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })

  const view = await noteGlassView(job)
  if (!view) return new Response("This Customer Page is closed.", { status: 410 })
  if (Number(view.daily_view_count) >= 3) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date())
    const externalId = `glass:${job.token_hash}:${day}:buying-signal`
    let eventId = await recordEvent({
      kind: "glass.view",
      actorType: "customer",
      leadId: job.lead_id,
      externalId,
      body: "Customer checked the Customer Page 3 times today",
      crewBody: "Customer checked the Customer Page 3 times today",
    })
    if (!eventId) {
      const existing = (await getSql()`SELECT id FROM events WHERE kind = 'glass.view' AND external_id = ${externalId}::text LIMIT 1`) as { id: number }[]
      eventId = Number(existing[0]?.id) || null
    }
    if (eventId) await notifyAll({
      priority: "digest",
      stock: "white",
      title: `${job.first_name} checked the Customer Page 3×`,
      body: "They are watching the job today.",
      crewBody: "They are watching the job today.",
      url: `/ops/leads/${job.lead_id}`,
      sourceEventId: eventId,
    })
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
}
