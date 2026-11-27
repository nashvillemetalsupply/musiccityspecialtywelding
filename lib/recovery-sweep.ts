import { randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"
import { markLeadDelivery, recoverMissingQuoteEvents, type LeadRow } from "@/lib/leads"
import { recoverUnattemptedQuoteEmail } from "@/lib/quote-email"
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

async function recoverQuoteEmails() {
  const result = { reviews: 0, recovered: 0 }
  const environment = process.env.VERCEL_ENV
  if (environment !== "production") return result
  const sql = getSql()
  const pending = (await sql`
    SELECT intent.id, intent.lead_id, intent.person_id, intent.external_id,
      intent.detail->>'audience' AS audience, intent.detail->>'frozenPayload' AS frozen_payload,
      intent.recorded_at AS created_at, intake.environment IS NULL AS origin_unknown,
      eligibility.needs_review, failure.id AS failure_event_id, failure.body AS failure_error,
      keys.review_key, keys.failure_key
    FROM events intent JOIN leads l ON l.id = intent.lead_id
    LEFT JOIN quote_intakes intake ON intake.lead_id = l.id AND intake.intake_key = l.intake_key
    CROSS JOIN LATERAL (
      SELECT 'quote-email-review:' || intent.id::text AS review_key,
        split_part(intent.external_id, ':', 1) || '-delivery:' ||
          split_part(intent.external_id, ':', 2) || ':failed' AS failure_key
    ) keys
    LEFT JOIN LATERAL (
      SELECT updated_at AS last_attempt_at FROM sync_state WHERE key = keys.review_key
    ) recovery ON true
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE rejection.detail->>'requestNotSent' IS DISTINCT FROM 'true') AS attempt_count,
        min(attempt.occurred_at) FILTER (WHERE rejection.id IS NULL) AS unresolved_at,
        max(rejection.id) FILTER (WHERE attempt.detail->>'recovery' = 'true'
          AND rejection.detail->>'requestNotSent' IS DISTINCT FROM 'true') AS recovery_failure_id
      FROM events attempt
      LEFT JOIN events rejection ON rejection.kind = 'email.failed'
        AND rejection.external_id = 'request-failed:' || attempt.id::text
        AND rejection.lead_id = intent.lead_id
        AND rejection.detail->>'sourceEventId' = intent.id::text
        AND rejection.detail->>'attemptEventId' = attempt.id::text
        AND (rejection.detail->>'requestNotSent' = 'true'
          OR (rejection.detail->>'providerStatus' ~ '^4[0-9]{2}$'
            AND rejection.detail->>'providerStatus' NOT IN ('408', '409', '429')))
      WHERE attempt.lead_id = intent.lead_id AND attempt.kind = 'email.attempt'
        AND attempt.detail->>'sourceEventId' = intent.id::text
    ) attempts
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN attempts.attempt_count > 0 THEN attempts.unresolved_at
        WHEN intent.detail->>'frozenPayload' IS NOT NULL THEN intent.recorded_at
        ELSE COALESCE((
          SELECT min(receipt.occurred_at) FROM events receipt
          WHERE receipt.lead_id = intent.lead_id AND receipt.kind = 'email.unknown'
            AND receipt.detail->>'sourceEventId' = intent.id::text
        ), intent.recorded_at)
      END AS review_at
    ) clock
    LEFT JOIN events failure ON failure.id = attempts.recovery_failure_id
    CROSS JOIN LATERAL (
      SELECT attempts.attempt_count = 0 AND intent.detail->>'frozenPayload' IS NOT NULL
        AND intent.recorded_at < now() - interval '15 minutes'
        AND clock.review_at > now() - interval '23 hours' AS can_recover,
        clock.review_at <= now() - interval '23 hours' OR intake.environment IS NULL AS needs_review
    ) eligibility
    WHERE intent.kind = 'email.out' AND intent.is_test = false AND l.is_test = false
      AND (intent.external_id LIKE 'quote-owner:%' OR intent.external_id LIKE 'quote-customer:%')
      AND (intake.environment = ${environment}::text OR intake.environment IS NULL)
      AND (recovery.last_attempt_at IS NULL OR recovery.last_attempt_at <= now() - interval '15 minutes')
      AND NOT EXISTS (
        SELECT 1 FROM events receipt
        WHERE receipt.lead_id = l.id AND receipt.kind IN ('email.accepted', 'email.delivered')
          AND receipt.detail->>'sourceEventId' = intent.id::text
      )
      -- Older attribution stores a relative landing path, so a null intake
      -- environment is insufficient evidence for an automatic send.
      AND (eligibility.can_recover OR clock.review_at <= now() - interval '23 hours' OR failure.id IS NOT NULL)
      AND (
        (eligibility.can_recover AND NOT eligibility.needs_review AND failure.id IS NULL)
        OR EXISTS (
          SELECT 1 FROM operators o WHERE o.active AND o.role = 'owner' AND NOT EXISTS (
            SELECT 1 FROM notifications n WHERE n.operator_id = o.id AND n.is_test = false
              AND n.dedupe_key = CASE WHEN failure.id IS NOT NULL THEN keys.failure_key ELSE keys.review_key END
          )
        )
      )
    ORDER BY recovery.last_attempt_at NULLS FIRST, clock.review_at, intent.id LIMIT 20`) as {
      id: number; lead_id: number; person_id: number | null; external_id: string;
      audience: "shop" | "customer"; frozen_payload: string | null; created_at: string; needs_review: boolean;
      origin_unknown: boolean; failure_event_id: number | null; failure_error: string | null;
      review_key: string; failure_key: string;
    }[]
  for (const intent of pending) {
    try {
      // Claim before preparation as well as review to back off failed attachment
      // reads, even when they prevent a provider attempt receipt.
      const [claim] = (await sql`
        INSERT INTO sync_state (key, value, updated_at)
        SELECT ${intent.review_key}::text, jsonb_build_object('last_recovery_attempt_at', now()), now()
        WHERE NOT EXISTS (
          SELECT 1 FROM events receipt
          WHERE receipt.lead_id = ${intent.lead_id}::bigint AND receipt.kind IN ('email.accepted', 'email.delivered')
            AND receipt.detail->>'sourceEventId' = ${String(intent.id)}::text
        )
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        WHERE sync_state.updated_at <= now() - interval '15 minutes'
        RETURNING key`) as { key: string }[]
      if (!claim) continue

      if (intent.failure_event_id) {
        await fileQuoteRecoveryFailure(intent, Number(intent.failure_event_id), intent.failure_error ?? "")
        continue
      }
      if (!intent.needs_review) {
        const send = await recoverUnattemptedQuoteEmail({
          leadId: Number(intent.lead_id), personId: intent.person_id, intent: intent.external_id, audience: intent.audience,
        }, intent)
        if (send.state === "pending") throw new Error(send.error)
        result.recovered++
        if (send.state === "failed") {
          await fileQuoteRecoveryFailure(intent, send.receiptEventId, send.error)
        } else if (intent.audience === "shop" && send.state === "accepted") {
          await markLeadDelivery(Number(intent.lead_id), "accepted")
        }
        continue
      }
      const filed = await notifyAll({
        priority: "digest",
        stock: "red",
        title: intent.audience === "shop" ? "Quote saved, owner email unconfirmed" : "Quote saved, customer email unconfirmed",
        body: intent.origin_unknown
          ? "The intake environment could not be confirmed. Verify the submission and follow up from the saved quote."
          : "Check the email provider and open the saved quote to follow up.",
        url: `/ops/leads/${intent.lead_id}#spike`,
        sourceEventId: Number(intent.id),
        ownerOnly: true,
        dedupeKey: intent.review_key,
      })
      if (filed.length > 0) result.reviews++
    } catch (error) {
      console.error(`Quote email recovery failed for intent ${intent.id}:`, error)
    }
  }
  return result
}

async function fileQuoteRecoveryFailure(intent: {
  lead_id: number; audience: "shop" | "customer"; failure_key: string;
}, receiptEventId: number | null, error: string) {
  const ownerEmail = intent.audience === "shop"
  if (ownerEmail) await markLeadDelivery(Number(intent.lead_id), "failed", error)
  await notifyAll({
    priority: "digest",
    stock: "red",
    title: ownerEmail ? "Quote saved, owner email did not send" : "Customer confirmation did not send",
    body: error,
    crewBody: ownerEmail ? "The owner email needs a delivery check." : "The customer confirmation needs an owner delivery check.",
    url: `/ops/leads/${intent.lead_id}#spike`,
    sourceEventId: receiptEventId,
    ownerOnly: true,
    dedupeKey: intent.failure_key,
  })
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
    try {
      await sql`DELETE FROM rate_limits WHERE ts < now() - interval '1 day'`
    } catch (error) {
      console.warn("Rate-limit cleanup failed during recovery sweep:", error)
    }

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

    let recoveredQuoteEvents: number[] = []
    try {
      const { eventIds, failures } = await recoverMissingQuoteEvents()
      recoveredQuoteEvents = eventIds
      if (failures.length > 0) detail.quoteEventRepairFailures = failures
    } catch (error) {
      detail.quoteEventDiscoveryError = error instanceof Error ? error.message : String(error)
      console.error("Quote event discovery failed:", error)
    }
    try {
      const { reviews, recovered } = await recoverQuoteEmails()
      detail.quoteEmailReviews = reviews
      detail.quoteEmailRecoveries = recovered
    } catch (error) {
      detail.quoteEmailReviewError = error instanceof Error ? error.message : String(error)
      console.error("Quote email review failed:", error)
    }
    const unprocessed = (await sql`
      SELECT id FROM events
      WHERE processed_at IS NULL
        AND (recorded_at < now() - interval '10 minutes' OR id = ANY(${recoveredQuoteEvents}::bigint[]))
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
    if (process.env.NEXT_PUBLIC_ASSISTANT_CHAT === "1" || process.env.ASSISTANT_VOICE === "1") {
      const { recoverAssistantHandoffs } = await import("@/lib/assistant/handoff.ts")
      detail.assistantHandoffs = await recoverAssistantHandoffs()
    }

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
