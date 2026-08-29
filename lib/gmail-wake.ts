import "server-only"

import { CANONICAL_ORIGIN } from "@/lib/ops-auth"
import { evaluateGmailWakePolicy, GMAIL_WAKE_PRODUCTION_ORIGIN } from "@/lib/gmail-wake-policy.mjs"

export type GmailWakeResult = {
  ok: boolean
  attempted: boolean
  skipped?: boolean
  reason?: "outside-production" | "not-configured" | "request-failed" | "ingest-failed"
}

/**
 * Wakes the one canonical Gmail ingestion route. Preview and local processes
 * fail closed so they can never use a copied secret to mutate the live inbox
 * checkpoint. The route remains the sole owner of Gmail's lease and cursor.
 */
export async function wakeGmailIngest(callerOrigin: string): Promise<GmailWakeResult> {
  const policy = evaluateGmailWakePolicy({
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    callerOrigin,
    configuredOrigin: CANONICAL_ORIGIN,
  })
  if (!policy.allowed) {
    return {
      ok: false,
      attempted: false,
      reason: policy.reason === "not-configured" ? "not-configured" : "outside-production",
    }
  }

  const secret = process.env.CRON_SECRET?.trim() ?? ""
  if (Buffer.byteLength(secret, "utf8") < 32) {
    return { ok: false, attempted: false, reason: "not-configured" }
  }

  let response: Response
  try {
    const target = new URL("/api/ingest/gmail", GMAIL_WAKE_PRODUCTION_ORIGIN)
    response = await fetch(target, {
      headers: {
        Authorization: `Bearer ${secret}`,
        "User-Agent": "MCSW-Shop-Brain-Gmail-Wake/1.0",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    return { ok: false, attempted: true, reason: "request-failed" }
  }

  const payload = await response.json().catch(() => null) as { ok?: unknown; skipped?: unknown } | null
  if (!response.ok || payload?.ok !== true) {
    return { ok: false, attempted: true, reason: "ingest-failed" }
  }
  return { ok: true, attempted: true, skipped: Boolean(payload.skipped) }
}
