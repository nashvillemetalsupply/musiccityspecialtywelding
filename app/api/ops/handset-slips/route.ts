import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export const runtime = "nodejs"

export async function GET() {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  const sql = getSql()
  const slips = await sql`
    SELECT id, question, answer, receipt_ids, created_at FROM handset_slips
    WHERE operator_id = ${operator.id}::bigint AND operator_role = ${operator.role}::text
    ORDER BY created_at DESC LIMIT 6`
  return Response.json({ slips })
}

export async function POST(req: Request) {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  const body = await req.json().catch(() => null) as { question?: string; answer?: string; receiptIds?: number[] } | null
  const question = String(body?.question ?? "").trim().slice(0, 1000)
  const answer = String(body?.answer ?? "").trim().slice(0, 5000)
  const receiptIds = [...new Set((body?.receiptIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 30)
  if (!question || !answer) return Response.json({ error: "A saved answer requires a question and answer." }, { status: 400 })
  const sql = getSql()
  const rows = (await sql`
    WITH inserted AS (
      INSERT INTO handset_slips (operator_id, operator_role, question, answer, receipt_ids)
      VALUES (${operator.id}::bigint, ${operator.role}::text, ${question}::text, ${answer}::text, ${receiptIds}::bigint[])
      RETURNING id, question, answer, receipt_ids, created_at
    ), trimmed AS (
      DELETE FROM handset_slips WHERE operator_id = ${operator.id}::bigint AND operator_role = ${operator.role}::text
        AND id NOT IN (
          SELECT id FROM inserted
          UNION ALL
          (SELECT id FROM handset_slips
            WHERE operator_id = ${operator.id}::bigint AND operator_role = ${operator.role}::text
            ORDER BY id DESC LIMIT 5)
        )
    )
    SELECT * FROM inserted`) as Array<{ id: number; question: string; answer: string; receipt_ids: number[]; created_at: string }>
  return Response.json({ slip: rows[0] })
}

export async function DELETE() {
  const operator = await getAuthenticatedOperator()
  if (!operator) return Response.json({ error: "Sign in required." }, { status: 401 })
  const sql = getSql()
  await sql`DELETE FROM handset_slips WHERE operator_id = ${operator.id}::bigint AND operator_role = ${operator.role}::text`
  return Response.json({ ok: true })
}
