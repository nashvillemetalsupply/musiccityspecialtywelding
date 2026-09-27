import { dbConfigured } from "@/lib/db"
import { isAuthorizedCron } from "@/lib/ops-auth"
import { runRecoverySweep, type RecoveryTrigger } from "@/lib/recovery-sweep"
import { sendDeferredSms } from "@/lib/messages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  if (!dbConfigured()) {
    return Response.json({ ok: false, error: "Database not configured." }, { status: 503 })
  }

  const trigger: RecoveryTrigger = req.headers.get("user-agent")?.toLowerCase().includes("vercel-cron")
    ? "vercel-daily"
    : "github-schedule"
  const deferredSms = await sendDeferredSms()
  const result = await runRecoverySweep({ trigger })
  return Response.json({ ...result, deferredSms }, { status: result.ok ? 200 : 500 })
}
