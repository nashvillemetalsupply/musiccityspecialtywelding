import { randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"
import type { LeadRow } from "@/lib/leads"
import { notifyAll, retryPendingInterrupts } from "@/lib/notify"
import { EXTRACTABLE_EVENT_KINDS, processEvent } from "@/lib/extract"
import { retryPendingAttachments } from "@/lib/attachment-retry"
import { retryCallTranscriptions } from "@/lib/call-transcription"
import { retryVoiceTranscriptions } from "@/lib/voice-transcription"
import { reconcileStaleSmsIntents } from "@/lib/messages"
import { reconcileRawInboundCalls } from "@/lib/ingest"
import { reconcileStaleOutboundCalls } from "@/lib/calls"
import { reconcileStaleCommitmentReschedules } from "@/lib/commitments"
import { reconcileGlassUploads } from "@/lib/glass-uploads"
import { reconcileStaleCallIntakes } from "@/lib/job-intake"
import { summarizePendingCalls } from "@/lib/call-summary"

export type RecoveryTrigger =
  | "github-schedule"
  | "vercel-daily"
  | "owner-board"
  | "owner-manual"
  | "twilio-sms"
  | "twilio-call"

export type RecoverySweepResult = {
  ok: boolean
  trigger: RecoveryTrigger
  skipped?: boolean
  reason?: "lease-active-or-recent"
  detail?: Record<string, unknown>
  error?: string
}

const RECOVERY_LEASE_KEY = "follow-up-reminders"

async function acquireRecoveryLease(force: boolean) {
  const sql = getSql()
  const holder = randomUUID()
  const rows = (await sql`
    INSERT INTO automation_leases (
      key, holder, lease_expires_at, last_finished_at, updated_at
    ) VALUES (
      ${RECOVERY_LEASE_KEY}::text, ${holder}::text,
      now() + interval '15 minutes', NULL::timestamptz, now()
    )
    ON CONFLICT (key) DO UPDATE SET
      holder = EXCLUDED.holder,
      lease_expires_at = EXCLUDED.lease_expires_at,
      updated_at = now()
    WHERE automation_leases.lease_expires_at <= now()
      AND (
        ${force}::boolean OR automation_leases.last_finished_at IS NULL
        OR automation_leases.last_finished_at <= now() - interval '10 minutes'
      )
    RETURNING key`) as Array<{ key: string }>
  return rows[0] ? holder : null
}

async function releaseRecoveryLease(holder: string) {
  const sql = getSql()
  const rows = (await sql`
    UPDATE automation_leases SET
      holder = ''::text,
      lease_expires_at = now(),
      last_finished_at = now(),
      updated_at = now()
    WHERE key = ${RECOVERY_LEASE_KEY}::text AND holder = ${holder}::text
    RETURNING key`) as Array<{ key: string }>
  if (!rows[0]) throw new Error("Recovery lease ownership was lost before release.")
}

/**
 * Runs the complete Shop Brain recovery pass behind one database lease.
 * Automatic callers are coalesced for ten minutes. A manual force bypasses
 * that cooldown, but never an active holder, so two provider retries cannot
 * overlap even when different platforms wake the app at the same time.
 */
export async function runRecoverySweep({
  trigger,
  force = false,
}: {
  trigger: RecoveryTrigger
  force?: boolean
}): Promise<RecoverySweepResult> {
  let holder: string | null = null
  try {
    holder = await acquireRecoveryLease(force)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Recovery lease acquisition failed:", error)
    return { ok: false, trigger, error: message }
  }

  // Skips are deliberately not automation runs. Health freshness must prove
  // that useful recovery work actually ran, not that another wake-up bounced.
  if (!holder) return {
    ok: true,
    trigger,
    skipped: true,
    reason: "lease-active-or-recent",
  }

  const sql = getSql()
  let ok = false
  const detail: Record<string, unknown> = { trigger }

  try {
    const due = (await sql`
      SELECT * FROM leads
      WHERE next_follow_up_at IS NOT NULL
        AND next_follow_up_at <= now()
        AND (follow_up_notified_at IS NULL OR follow_up_notified_at < next_follow_up_at)
        AND completed_at IS NULL AND status NOT IN ('lost', 'spam')
        AND is_test = false
      ORDER BY next_follow_up_at ASC LIMIT 50`) as LeadRow[]

    detail.due = due.length
    if (due.length > 0) {
      const ids = due.map((lead) => Number(lead.id))
      const filed = await notifyAll({
        priority: "digest",
        stock: "manila",
        title: `Follow-up due: ${due.length} lead${due.length === 1 ? "" : "s"}`,
        body: due.slice(0, 3).map((lead) => `${lead.first_name} · ${lead.service}`).join(" · "),
        url: "/ops",
        dedupeKey: `follow-up:${ids.join(",")}:${due.map((lead) => lead.next_follow_up_at ?? "").join(",")}`,
      })
      await sql`
        UPDATE leads SET follow_up_notified_at = now() WHERE id = ANY(${ids}::bigint[])`
      detail.notificationsFiled = filed.length
      detail.delivery = "wire"
    } else {
      detail.delivery = "none"
    }

    const unprocessed = (await sql`
      SELECT id FROM events
      WHERE processed_at IS NULL AND recorded_at < now() - interval '10 minutes'
        AND body <> '' AND kind = ANY(${[...EXTRACTABLE_EVENT_KINDS]}::text[])
        AND extraction_status <> 'dead'
        AND (extraction_next_attempt_at IS NULL OR extraction_next_attempt_at <= now())
        AND (extraction_status <> 'processing' OR extraction_next_attempt_at <= now())
      ORDER BY COALESCE(extraction_next_attempt_at, recorded_at) ASC LIMIT 20`) as { id: number }[]
    for (const event of unprocessed) {
      const claimed = (await sql`
        UPDATE events SET extraction_status = 'processing', extraction_next_attempt_at = now() + interval '15 minutes'
        WHERE id = ${event.id}::bigint AND processed_at IS NULL AND extraction_status <> 'dead'
          AND (extraction_status <> 'processing' OR extraction_next_attempt_at <= now())
        RETURNING id`) as { id: number }[]
      if (!claimed[0]) continue
      try {
        const outcome = await processEvent(Number(event.id))
        if (!outcome.processed && outcome.reason === "not-configured") await sql`
          UPDATE events SET extraction_status = 'pending', extraction_next_attempt_at = NULL WHERE id = ${event.id}::bigint`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const failed = (await sql`
          UPDATE events SET
            extraction_attempts = extraction_attempts + 1,
            extraction_last_error = ${message.slice(0, 1000)}::text,
            extraction_status = CASE WHEN extraction_attempts + 1 >= 8 THEN 'dead' ELSE 'failed' END,
            extraction_next_attempt_at = CASE WHEN extraction_attempts + 1 >= 8 THEN NULL ELSE now() + (LEAST(360, (15 * power(2, extraction_attempts))::int) || ' minutes')::interval END
          WHERE id = ${event.id}::bigint
          RETURNING extraction_attempts, extraction_status`) as { extraction_attempts: number; extraction_status: string }[]
        if (failed[0]?.extraction_status === "dead") await notifyAll({ priority: "digest", stock: "red", title: "One update needs review", body: "MCSW Jobs stopped after eight safe retries; the original record is intact.", url: `/board/updates?receipt=${event.id}#receipt`, sourceEventId: Number(event.id), ownerOnly: true, dedupeKey: `extraction-dead:${event.id}` })
        console.error(`Extraction retry ${event.id} failed:`, error)
      }
    }
    detail.extractionRetries = unprocessed.length
    detail.attachmentRetries = await retryPendingAttachments()
    detail.callTranscriptRetries = await retryCallTranscriptions()
    detail.callSummaries = await summarizePendingCalls()
    detail.voiceTranscriptRetries = await retryVoiceTranscriptions()
    detail.smsReconciliation = await reconcileStaleSmsIntents()
    detail.rawCallReconciliation = await reconcileRawInboundCalls()
    detail.callIntakeReconciliation = await reconcileStaleCallIntakes()
    detail.outboundCallReconciliation = await reconcileStaleOutboundCalls()
    detail.promiseTextReconciliation = await reconcileStaleCommitmentReschedules()
    detail.glassUploadReconciliation = await reconcileGlassUploads()
    detail.interruptDeliveryRetries = await retryPendingInterrupts()

    const expiring = (await sql`
      SELECT id, filename, expires_at FROM shop_documents
      WHERE kind = 'coi' AND status = 'ready'
        AND expires_at <= now() + interval '14 days'
      LIMIT 1`) as { id: number; filename: string; expires_at: string }[]
    if (expiring[0]) {
      const stamp = new Date(expiring[0].expires_at).toISOString()
      const state = (await sql`SELECT value FROM sync_state WHERE key = 'coi-expiry'::text LIMIT 1`) as { value: { expiresAt?: string } }[]
      if (state[0]?.value?.expiresAt !== stamp) {
        await notifyAll({
          priority: "digest",
          stock: "red",
          title: new Date(stamp).getTime() <= Date.now() ? "Insurance certificate is expired" : "Insurance certificate expires soon",
          body: `${expiring[0].filename} · ${new Date(stamp).toLocaleDateString("en-US")}`,
          url: "/ops/shop",
          ownerOnly: true,
          dedupeKey: `coi-expiry:${stamp}`,
        })
        await sql`
          INSERT INTO sync_state (key, value, updated_at)
          VALUES ('coi-expiry'::text, ${JSON.stringify({ expiresAt: stamp })}::jsonb, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
      }
    }

    ok = true
  } catch (error) {
    detail.error = error instanceof Error ? error.message : String(error)
    console.error("Recovery sweep failed:", error)
  }

  try {
    await releaseRecoveryLease(holder)
  } catch (error) {
    detail.leaseReleaseError = error instanceof Error ? error.message : String(error)
    ok = false
    console.error("Recovery lease release failed:", error)
  }

  // Lease release is part of the run's truth. Record only after its outcome is
  // known so health cannot show a green recovery whose holder stayed stuck.
  try {
    await sql`
      INSERT INTO automation_runs (job, ok, detail)
      VALUES ('follow-up-reminders'::text, ${ok}::boolean, ${JSON.stringify(detail)}::jsonb)`
  } catch (error) {
    detail.logError = error instanceof Error ? error.message : String(error)
    ok = false
    console.error("Recovery automation log failed:", error)
  }

  return ok
    ? { ok: true, trigger, detail }
    : { ok: false, trigger, detail, error: String(detail.error ?? detail.logError ?? detail.leaseReleaseError ?? "Recovery failed.") }
}
