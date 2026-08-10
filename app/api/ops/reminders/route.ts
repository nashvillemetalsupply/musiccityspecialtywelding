import { dbConfigured, getSql } from "@/lib/db"
import type { LeadRow } from "@/lib/leads"
import { isAuthorizedCron } from "@/lib/ops-auth"
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

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Hourly sweep. Operator-facing delivery always goes through the Wire gate.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  if (!dbConfigured()) {
    return Response.json({ ok: false, error: "Database not configured." }, { status: 503 })
  }

  const sql = getSql()
  let ok = false
  const detail: Record<string, unknown> = {}

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
        if (failed[0]?.extraction_status === "dead") await notifyAll({ priority: "digest", stock: "red", title: "One update needs review", body: "MCSW Jobs stopped after eight safe retries; the original record is intact.", url: `/ops?view=updates&receipt=${event.id}#receipt`, sourceEventId: Number(event.id), ownerOnly: true, dedupeKey: `extraction-dead:${event.id}` })
        console.error(`Extraction retry ${event.id} failed:`, error)
      }
    }
    detail.extractionRetries = unprocessed.length
    detail.attachmentRetries = await retryPendingAttachments()
    detail.callTranscriptRetries = await retryCallTranscriptions()
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
    return Response.json({ ok: true, ...detail }, { status: 200 })
  } catch (err) {
    detail.error = err instanceof Error ? err.message : String(err)
    console.error("Reminder error:", err)
    return Response.json({ ok: false, ...detail }, { status: 500 })
  } finally {
    try {
      await sql`
        INSERT INTO automation_runs (job, ok, detail)
        VALUES ('follow-up-reminders'::text, ${ok}::boolean, ${JSON.stringify(detail)}::jsonb)`
    } catch (logError) {
      console.error("Automation log error:", logError)
    }
  }
}
