import { cookies } from "next/headers"
import { dbConfigured } from "@/lib/db"
import { OPS_SESSION_COOKIE, validateSessionToken } from "@/lib/ops-auth"
import { pushConfigured, removeSubscription, saveSubscription } from "@/lib/push"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function requireOperator() {
  const cookieStore = await cookies()
  return validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
}

export async function POST(req: Request) {
  const operator = await requireOperator()
  if (!operator) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 })
  if (!dbConfigured() || !pushConfigured()) {
    return Response.json({ ok: false, error: "Push not configured." }, { status: 503 })
  }

  const body = (await req.json().catch(() => null)) as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  } | null
  if (
    !body?.endpoint?.startsWith("https://") ||
    !body.keys?.p256dh ||
    !body.keys.auth ||
    body.endpoint.length > 1000
  ) {
    return Response.json({ ok: false, error: "Invalid subscription." }, { status: 400 })
  }

  await saveSubscription({
    endpoint: body.endpoint,
    keys: { p256dh: body.keys.p256dh.slice(0, 300), auth: body.keys.auth.slice(0, 100) },
  }, operator.id)
  return Response.json({ ok: true }, { status: 200 })
}

export async function DELETE(req: Request) {
  const operator = await requireOperator()
  if (!operator) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null
  if (!body?.endpoint) {
    return Response.json({ ok: false, error: "Invalid subscription." }, { status: 400 })
  }
  await removeSubscription(body.endpoint)
  return Response.json({ ok: true }, { status: 200 })
}
