import { getAuthenticatedOperator, getOpsCacheSessionId } from "@/lib/ops-auth"

export const dynamic = "force-dynamic"

export async function GET() {
  if (!await getAuthenticatedOperator()) {
    return Response.json({ error: "Sign in required." }, {
      status: 401,
      headers: { "Cache-Control": "private, no-store" },
    })
  }
  const sessionId = await getOpsCacheSessionId()
  if (!sessionId) return Response.json({ error: "Sign in required." }, {
    status: 401,
    headers: { "Cache-Control": "private, no-store" },
  })
  return Response.json({ sessionId }, { headers: { "Cache-Control": "private, no-store" } })
}
