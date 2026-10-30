import { getAuthenticatedOperator, getOpsCacheSessionId } from "@/lib/ops-auth"
import { voiceOperatorScope } from "@/lib/voice-outbox-scope.ts"

export const dynamic = "force-dynamic"

export async function GET() {
  const operator = await getAuthenticatedOperator()
  if (!operator) {
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
  return Response.json({ sessionId, voiceScope: voiceOperatorScope(operator), role: operator.role }, { headers: { "Cache-Control": "private, no-store" } })
}
