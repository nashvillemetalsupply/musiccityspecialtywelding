import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { markWireRead } from "@/lib/notify"

export async function POST(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { ids?: unknown[] } | null
  const ids = (body?.ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 50)
  await markWireRead(operator.id, ids)
  return Response.json({ ok: true, read: ids.length })
}
