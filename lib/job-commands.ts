import { put } from "@vercel/blob"
import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { getSql } from "@/lib/db"
import { LEAD_STATUSES, recordLeadEvent, type LeadStatus } from "@/lib/leads"
import { canAccessInternalTests, type Operator } from "@/lib/operators"
import { processEvent } from "@/lib/extract"
import { notifyAll } from "@/lib/notify"
import { validateCloseoutReview } from "@/lib/closeout-domain.ts"
import { buildSheetsEnabled } from "@/lib/build-sheets-access"
import { attachCloseoutPhotoToLead, getCloseoutPhotoUpload, isCloseoutUploadId } from "@/lib/closeout-photo-uploads"
import { scheduleQuoteFollowUp } from "@/lib/quote-follow-up.ts"

// The three job-state writers shared by the ops dashboard server actions
// (app/ops/actions.ts) and the operator text-in path
// (app/api/twilio/sms/route.ts). This file is deliberately NOT a "use server"
// module: these take an already-authenticated operator and a lead id the caller
// has already authorised, so they must never be reachable as client-callable
// server actions. The FormData wrappers stay in actions.ts and still do the
// session lookup and lead-access checks.

function actorId(operator: Operator) {
  return String(operator.id)
}

// Operator-facing reminder only; the customer is never contacted. The status or
// clear that triggered it has already been saved, so a failure here is logged
// rather than shown to the operator as if their change had failed.
export async function scheduleQuoteFollowUpForLead(leadId: number) {
  try {
    await scheduleQuoteFollowUp(getSql(), recordLeadEvent, leadId)
  } catch (error) {
    console.warn("Quote follow-up scheduling failed:", error)
  }
}

export async function applyLeadStatus(
  operator: Operator,
  input: { leadId: number; status: LeadStatus; reason: string },
) {
  const { leadId, status, reason } = input
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Invalid status.")
  }
  if (status === "won") throw new Error("Use Swipe to Finish to complete work.")
  if (operator.role !== "owner" && (status === "lost" || status === "spam")) {
    throw new Error("Only the owner can remove work from Active Jobs.")
  }
  if ((status === "lost" || status === "spam") && !reason) {
    throw new Error("A reason is required to mark a lead lost or spam.")
  }

  const sql = getSql()
  const changed = (await sql`
    WITH lead_update AS (
    UPDATE leads SET
      status = ${status}::text,
      status_reason = ${reason}::text,
      first_response_at = CASE
        WHEN ${status}::text IN ('contacted', 'qualified', 'quoted', 'won')
          AND first_response_at IS NULL THEN now()
        ELSE first_response_at END,
      first_response_channel = CASE
        WHEN ${status}::text IN ('contacted', 'qualified', 'quoted', 'won')
          AND first_response_at IS NULL AND first_response_channel = ''
          THEN 'ops-dashboard'
        ELSE first_response_channel END,
      quoted_at = CASE WHEN ${status}::text = 'quoted' AND quoted_at IS NULL THEN now() ELSE quoted_at END,
      won_at = CASE WHEN ${status}::text = 'won' AND won_at IS NULL THEN now() ELSE won_at END,
      lost_at = CASE WHEN ${status}::text = ANY(ARRAY['lost','spam']::text[])
        THEN COALESCE(lost_at, now()) ELSE NULL END,
      updated_at = now()
    WHERE id = ${leadId}::bigint AND completed_at IS NULL AND handed_off_at IS NULL
    RETURNING id, person_id, is_test
    ), immutable_receipt AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, person_id,
        external_id, body, crew_body, detail, is_test
      )
      SELECT now(), 'status.changed'::text, 'operator'::text,
        ${actorId(operator)}::text, u.id, u.person_id, ''::text,
        CASE WHEN u.is_test THEN '[INTERNAL TEST] '::text ELSE ''::text END || ${reason}::text,
        NULL::text,
        ${JSON.stringify({ status, reason: reason || null, legacyType: "status_changed" })}::jsonb
          || CASE WHEN u.is_test THEN '{"isTest":true}'::jsonb ELSE '{}'::jsonb END,
        mcsw_is_test_row(u.id, u.person_id, NULL::bigint, NULL::text,
          ${JSON.stringify({ status, reason: reason || null, legacyType: "status_changed" })}::jsonb
            || CASE WHEN u.is_test THEN '{"isTest":true}'::jsonb ELSE '{}'::jsonb END,
          ${reason}::text)
      FROM lead_update u
      RETURNING lead_id
    )
    SELECT lead_id AS id FROM immutable_receipt`) as { id: number }[]
  if (!changed[0]) throw new Error("Finished jobs are locked. Use Undo finish before changing their status.")
  if (status === "quoted") await scheduleQuoteFollowUpForLead(leadId)
  if (status === "spam") {
    await sql`
      UPDATE notifications n SET
        read_at = COALESCE(n.read_at, now()),
        delivery_status = CASE
          WHEN n.sent_at IS NULL AND n.delivery_status IN ('pending','sending','retry') THEN 'filed'
          ELSE n.delivery_status END,
        delivery_next_attempt_at = NULL,
        interrupt_reserved_at = NULL,
        delivery_error = CASE
          WHEN n.sent_at IS NULL THEN 'Suppressed after the work order was marked Not a job.'
          ELSE n.delivery_error END
      FROM events e
      WHERE e.id = n.source_event_id AND e.lead_id = ${leadId}::bigint`
  }
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
  // The board shows open work and prices leads against ad spend; both change
  // the moment a job is marked Not a job, and the board can be the page the
  // press came from.
  revalidatePath("/board")
}

export async function recordPaymentRecord(
  operator: Operator,
  input: { leadId: number; amountCents: number; methodRaw: string; settles: boolean; receiptKey: string },
) {
  const { leadId, amountCents, methodRaw, settles, receiptKey } = input
  const method = ["cash", "check", "card", "other"].includes(methodRaw) ? methodRaw : "other"
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(receiptKey)) {
    throw new Error("The payment receipt is missing. Reload this work order before recording payment.")
  }
  const externalId = `manual-payment:${receiptKey}`
  const baseBody = `$${(amountCents / 100).toLocaleString("en-US")} ${method} in hand`

  const sql = getSql()
  const result = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id, person_id, is_test,
        COALESCE(paid_amount_cents, 0::bigint) AS paid_amount_cents,
        invoice_total_cents, invoice_number
      FROM leads
      WHERE id = ${leadId}::bigint
      FOR UPDATE
    ), existing_key AS MATERIALIZED (
      SELECT e.id, e.lead_id, e.detail,
        EXISTS (
          SELECT 1 FROM events reversal
          WHERE reversal.kind = 'payment.reversed' AND reversal.lead_id = e.lead_id
            AND reversal.id > e.id
        ) AS reversed_after
      FROM events e
      WHERE e.kind = ANY(ARRAY['invoice.payment-received','invoice.paid']::text[])
        AND e.external_id = ${externalId}::text
      ORDER BY
        CASE WHEN COALESCE(e.detail->>'paidTotalCents', '') ~ '^[0-9]+$'
          THEN (e.detail->>'paidTotalCents')::numeric ELSE -1::numeric END DESC,
        e.id DESC
      LIMIT 1
    ), calculation AS MATERIALIZED (
      SELECT t.*,
        (t.paid_amount_cents + ${amountCents}::bigint) AS paid_total_cents,
        (${settles}::boolean OR (
          t.invoice_total_cents IS NOT NULL
          AND t.paid_amount_cents + ${amountCents}::bigint >= t.invoice_total_cents
        )) AS fully_paid
      FROM target t
    ), event_write AS (
      INSERT INTO events (
        kind, actor_type, actor_id, lead_id, person_id, external_id, body, crew_body, detail, is_test
      )
      SELECT 'invoice.payment-received'::text,
        'operator'::text, ${String(operator.id)}::text, c.id, c.person_id,
        ${externalId}::text,
        CASE WHEN c.is_test THEN '[INTERNAL TEST] '::text ELSE ''::text END
          || ${baseBody}::text
          || CASE WHEN c.invoice_number <> '' THEN ' — INV #'::text || c.invoice_number ELSE ''::text END
          || CASE WHEN c.fully_paid THEN ', squared up'::text ELSE ''::text END,
        NULL::text,
        jsonb_build_object(
          'amountCents', ${amountCents}::bigint,
          'method', ${method}::text,
          'paidTotalCents', c.paid_total_cents,
          'fullyPaid', c.fully_paid,
          'manual', true,
          'isTest', c.is_test
        ),
        mcsw_is_test_row(c.id, c.person_id, NULL::bigint, NULL::text,
          jsonb_build_object('isTest', c.is_test), ${baseBody}::text)
      FROM calculation c
      WHERE NOT EXISTS (SELECT 1 FROM existing_key)
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id, lead_id, detail
    ), receipt_scope AS MATERIALIZED (
      SELECT w.id, w.lead_id,
        (w.detail->>'paidTotalCents')::bigint AS paid_total_cents,
        (w.detail->>'fullyPaid')::boolean AS fully_paid
      FROM event_write w
      UNION ALL
      SELECT e.id, e.lead_id,
        CASE WHEN e.reversed_after THEN t.paid_amount_cents
          ELSE (e.detail->>'paidTotalCents')::bigint END AS paid_total_cents,
        CASE WHEN e.reversed_after THEN
          (t.invoice_total_cents IS NOT NULL AND t.paid_amount_cents >= t.invoice_total_cents)
          ELSE (e.detail->>'fullyPaid')::boolean END AS fully_paid
      FROM existing_key e JOIN target t ON t.id = e.lead_id
      WHERE COALESCE(e.detail->>'paidTotalCents', '') ~ '^[0-9]+$'
        AND lower(COALESCE(e.detail->>'fullyPaid', '')) = ANY(ARRAY['true','false']::text[])
        AND lower(COALESCE(e.detail->>'manual', 'false')) = 'true'
        AND NOT EXISTS (SELECT 1 FROM event_write)
    ), projection_write AS (
      UPDATE leads l SET
        paid_amount_cents = GREATEST(COALESCE(l.paid_amount_cents, 0::bigint), r.paid_total_cents),
        paid_at = CASE WHEN r.fully_paid THEN COALESCE(l.paid_at, now()) ELSE l.paid_at END,
        updated_at = now()
      FROM target t CROSS JOIN receipt_scope r
      WHERE l.id = t.id AND r.lead_id = t.id
      RETURNING l.id
    )
    SELECT t.id AS lead_id, r.id AS event_id, (p.id IS NOT NULL) AS projected,
      (SELECT e.lead_id FROM existing_key e LIMIT 1) AS key_lead_id
    FROM target t
    LEFT JOIN receipt_scope r ON r.lead_id = t.id
    LEFT JOIN projection_write p ON p.id = t.id
    LIMIT 1`) as Array<{ lead_id: number; event_id: number | null; projected: boolean; key_lead_id: number | null }>
  if (!result[0]) throw new Error("Work order not found.")
  if (!result[0].event_id || !result[0].projected) {
    // A simultaneous duplicate can lose the INSERT race after this statement's
    // snapshot was taken. The winning statement already wrote and projected
    // atomically, so that no-row outcome is a successful idempotent replay.
    if (result[0].key_lead_id === null) {
      const winner = (await sql`
        SELECT lead_id FROM events
        WHERE kind = ANY(ARRAY['invoice.payment-received','invoice.paid']::text[])
          AND external_id = ${externalId}::text
        ORDER BY id DESC LIMIT 1`) as Array<{ lead_id: number | null }>
      if (Number(winner[0]?.lead_id) !== leadId) {
        throw new Error("That payment receipt was used by another work order. Reload before trying again.")
      }
      revalidatePath(`/ops/leads/${leadId}`)
      revalidatePath("/board")
      return
    }
    throw new Error("That payment receipt is already attached elsewhere or cannot repair this work order.")
  }

  revalidatePath(`/ops/leads/${leadId}`)
  revalidatePath("/board")
}

export async function completeLeadRecord(operator: Operator, leadId: number, formData: FormData) {
  const reviewedCloseoutRequested = String(formData.get("reviewedCloseout") ?? "") === "1"
  const sql = getSql()
  const before = (await sql`
    SELECT status, public_id, first_name, service, person_id, is_test,
      glass_caption_draft, won_at, assigned_operator_id
    FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as {
      status: LeadStatus
      public_id: string
      first_name: string
      service: string
      person_id: number | null
      is_test: boolean
      glass_caption_draft: string
      won_at: string | null
      assigned_operator_id: number | null
    }[]
  if (!before[0]) throw new Error("Job not found.")
  if (before[0].is_test && !canAccessInternalTests(operator.role)) throw new Error("Owner access is required for internal test jobs.")
  const reviewedCloseoutEnabled = operator.role === "owner" && before[0].is_test && buildSheetsEnabled()
  if (reviewedCloseoutRequested && !reviewedCloseoutEnabled) throw new Error("Reviewed closeout is unavailable for this job.")
  const closeout = reviewedCloseoutEnabled ? validateCloseoutReview({
    completion: String(formData.get("completion") ?? "") as "complete" | "partial",
    fit: String(formData.get("fit") ?? "") as "fit" | "adjusted" | "not-checked",
    extraTrips: Number(formData.get("extraTrips")),
    rework: String(formData.get("rework") ?? "") as "yes" | "no",
    asBuiltDifferences: String(formData.get("asBuiltDifferences") ?? "").slice(0, 2000),
    remainingWork: String(formData.get("remainingWork") ?? "").slice(0, 2000),
    sourceWords: String(formData.get("sourceWords") ?? "").slice(0, 2000),
    reviewed: String(formData.get("reviewed") ?? "") === "1",
  }) : null
  const note = closeout?.sourceWords ?? ""
  const noteSource = String(formData.get("noteSource") ?? "typed") === "voice" ? "voice" : "typed"
  const photoUploadId = String(formData.get("photoUploadId") ?? "").trim()
  if (photoUploadId && !isCloseoutUploadId(photoUploadId)) throw new Error("The closeout photo receipt is invalid.")
  if (closeout?.completion === "partial" && photoUploadId) throw new Error("File closeout photos after the job is finished.")
  const closeoutPhoto = photoUploadId ? await getCloseoutPhotoUpload({
    id: photoUploadId,
    leadId,
    operatorId: Number(operator.id),
    mode: "completion",
    isTest: before[0].is_test,
  }) : null
  const voiceIntentId = String(formData.get("voiceIntentId") ?? "").trim()
  const hasVoiceIntent = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(voiceIntentId)
  if (voiceIntentId && !hasVoiceIntent) throw new Error("That saved voice note is not valid.")
  const recoveredVoice = hasVoiceIntent ? (await sql`
    SELECT blob_path, content_type FROM voice_transcription_intents
    WHERE id = ${voiceIntentId}::text AND operator_id = ${operator.id}::bigint
      AND lead_id = ${leadId}::bigint AND recovery_key = ${`closeout:${leadId}`}::text
      AND status = 'completed' AND blob_path <> '' LIMIT 1`) as Array<{ blob_path: string; content_type: string }> : []
  if (noteSource === "voice" && (!hasVoiceIntent || !recoveredVoice[0])) {
    throw new Error("That saved voice note does not belong to this closeout.")
  }
  if (closeout?.completion === "partial") {
    const closeoutKey = String(formData.get("closeoutKey") ?? "").trim().slice(0, 120)
    if (!closeoutKey) throw new Error("The closeout update receipt is missing. Reload this job.")
    const externalId = `job-closeout-update:${leadId}:${closeoutKey}`
    const updates = (await sql`
      WITH event_write AS (
        INSERT INTO events (kind, actor_type, actor_id, lead_id, person_id, external_id, body, crew_body, detail, is_test)
        SELECT 'job.closeout-update'::text, 'operator'::text, ${String(operator.id)}::text,
          l.id, l.person_id, ${externalId}::text, ${note}::text,
          'Partial work update filed. Job remains open.'::text,
          ${JSON.stringify({ closeout, noteSource, voiceIntentId: hasVoiceIntent ? voiceIntentId : null, ...(recoveredVoice[0] ? { voicePath: recoveredVoice[0].blob_path, voiceContentType: recoveredVoice[0].content_type, recoveredVoiceIntentId: voiceIntentId } : {}), sensitivity: "owner-only", isTest: true })}::jsonb,
          mcsw_is_test_row(l.id, l.person_id, NULL::bigint, NULL::text,
            ${JSON.stringify({ isTest: true })}::jsonb, ${note}::text)
        FROM leads l WHERE l.id = ${leadId}::bigint AND l.is_test = true AND l.completed_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM events keyed
            WHERE keyed.kind = 'job.closeout-update' AND keyed.external_id = ${externalId}::text
              AND (keyed.detail->'closeout' IS DISTINCT FROM ${JSON.stringify(closeout)}::jsonb
                OR COALESCE(keyed.detail->>'noteSource', '') <> ${noteSource}::text
                OR COALESCE(keyed.detail->>'voiceIntentId', '') <> ${hasVoiceIntent ? voiceIntentId : ""}::text)
          )
        ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
        RETURNING id
      ), event_scope AS (
        SELECT id FROM event_write
        UNION ALL
        SELECT id FROM events WHERE kind = 'job.closeout-update' AND external_id = ${externalId}::text
          AND detail->'closeout' = ${JSON.stringify(closeout)}::jsonb
          AND COALESCE(detail->>'noteSource', '') = ${noteSource}::text
          AND COALESCE(detail->>'voiceIntentId', '') = ${hasVoiceIntent ? voiceIntentId : ""}::text
          AND NOT EXISTS (SELECT 1 FROM event_write)
        LIMIT 1
      ), update_write AS (
        INSERT INTO job_closeout_updates (
          lead_id, source_event_id, completion_state, fit_state, extra_trips,
          rework_state, as_built_differences, remaining_work, source_words,
          reviewed_by, reviewed_at, is_test
        )
        SELECT ${leadId}::bigint, event.id, 'partial'::text, ${closeout.fit}::text,
          ${closeout.extraTrips}::int, ${closeout.rework}::text,
          ${closeout.asBuiltDifferences}::text, ${closeout.remainingWork}::text,
          ${closeout.sourceWords}::text, ${operator.id}::bigint, now(), true
        FROM event_scope event
        ON CONFLICT (source_event_id) DO NOTHING
        RETURNING id, source_event_id
      )
      SELECT id, source_event_id FROM update_write
      UNION ALL
      SELECT stored.id, stored.source_event_id FROM job_closeout_updates stored JOIN event_scope event ON event.id = stored.source_event_id
      WHERE NOT EXISTS (SELECT 1 FROM update_write)
      LIMIT 1`) as Array<{ id: number; source_event_id: number }>
    const update = updates[0]
    if (!update) throw new Error("The closeout update could not be filed.")
    revalidatePath(`/ops/leads/${leadId}`)
    return
  }
  const voiceNote = formData.get("voiceNote")
  if (voiceNote instanceof File && voiceNote.size > 0 && (voiceNote.size > 8 * 1024 * 1024 || !voiceNote.type.startsWith("audio/"))) {
    throw new Error("Closeout voice notes must be audio under 8 MB.")
  }
  const deliveryCommitments = (await sql`
    SELECT id FROM commitments
    WHERE lead_id = ${leadId}::bigint
      AND status = 'open'
      AND direction = 'we_promised'
      AND summary ~* '(ready|finish|finished|complete|completed|done|weld|repair|install|deliver|delivery|pick[ -]?up)'
    ORDER BY created_at ASC`) as { id: number }[]
  const closedCommitmentIds = deliveryCommitments.map((item) => Number(item.id))
  const completionDetail = {
    note: note || null,
    noteSource,
    previousStatus: before[0].status,
    previousCaption: before[0].glass_caption_draft,
    previousWonAt: before[0].won_at,
    previousAssignedOperatorId: before[0].assigned_operator_id,
    operatorName: operator.name,
    isTest: before[0].is_test,
    closedCommitmentIds,
    ...(hasVoiceIntent ? { voiceIntentId } : {}),
    ...(recoveredVoice[0] ? { voicePath: recoveredVoice[0].blob_path, voiceContentType: recoveredVoice[0].content_type, recoveredVoiceIntentId: voiceIntentId } : {}),
    ...(closeout ? { closeout } : {}),
  }
  const completion = (await sql`
    WITH target AS (
      SELECT id, person_id, is_test FROM leads
      WHERE id = ${leadId}::bigint AND completed_at IS NULL
        AND (${canAccessInternalTests(operator.role)}::boolean OR is_test = false)
      FOR UPDATE
    ), immutable_receipt AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, person_id,
        external_id, body, detail, is_test
      )
      SELECT now(), 'job.completed'::text, 'operator'::text,
        ${String(operator.id)}::text, t.id, t.person_id,
        ''::text,
        CASE WHEN t.is_test THEN '[INTERNAL TEST] '::text ELSE ''::text END || ${note}::text,
        ${JSON.stringify({ ...completionDetail, legacyType: "completed" })}::jsonb,
        mcsw_is_test_row(t.id, t.person_id, NULL::bigint, NULL::text,
          ${JSON.stringify(completionDetail)}::jsonb, ${note}::text)
      FROM target t
      RETURNING id
    ), closeout_write AS (
      INSERT INTO job_closeouts (
        lead_id, completion_event_id, completion_state, fit_state, extra_trips,
        rework_state, as_built_differences, remaining_work, source_words,
        reviewed_by, reviewed_at, is_test
      )
      SELECT t.id, receipt.id, ${closeout?.completion ?? "complete"}::text, ${closeout?.fit ?? "not-checked"}::text,
        ${closeout?.extraTrips ?? 0}::int, ${closeout?.rework ?? "no"}::text,
        ${closeout?.asBuiltDifferences ?? ""}::text, ${closeout?.remainingWork ?? ""}::text,
        ${closeout?.sourceWords ?? ""}::text, ${operator.id}::bigint, now(), ${before[0].is_test}::boolean
      FROM target t CROSS JOIN immutable_receipt receipt
      WHERE ${Boolean(closeout)}::boolean
      ON CONFLICT (completion_event_id) DO NOTHING
      RETURNING lead_id, completion_event_id
    ), lead_update AS (
      UPDATE leads l SET
        completed_at = now(), status = 'won', won_at = COALESCE(l.won_at, now()),
        handed_off_at = NULL,
        assigned_operator_id = COALESCE(l.assigned_operator_id, ${operator.id}::bigint),
        updated_at = now()
      FROM target t CROSS JOIN immutable_receipt r
      WHERE (${Boolean(closeout)}::boolean = false OR EXISTS (SELECT 1 FROM closeout_write))
        AND l.id = t.id RETURNING l.id
    ), glass_update AS (
      UPDATE glass_links g SET expires_at = COALESCE(g.expires_at, now() + interval '90 days')
      FROM immutable_receipt r
      WHERE g.lead_id = ${leadId}::bigint AND g.revoked_at IS NULL RETURNING g.token_hash
    ), promise_update AS (
      UPDATE commitments c SET
        status = 'kept',
        status_changed_at = now(),
        status_source_event_id = r.id,
        confirmed_by = COALESCE(confirmed_by, ${operator.id}::bigint)
      FROM immutable_receipt r
      WHERE c.lead_id = ${leadId}::bigint
        AND c.id = ANY(${closedCommitmentIds}::bigint[]) AND c.status = 'open'
      RETURNING c.id
    ), wire_receipts AS (
      INSERT INTO notifications (
        operator_id, priority, stock, title, body, url, source_event_id,
        owner_only, dedupe_key, is_test
      )
      SELECT o.id, 'digest'::text, 'white'::text,
        ${`${operator.name || "The crew"} closed ${before[0].first_name}'s job`}::text,
        CASE WHEN o.role = 'owner'::text
          THEN ${note || `${before[0].service} marked finished.`}::text
          ELSE ${`${before[0].first_name}'s job marked finished.`}::text
        END,
        ${`/ops/leads/${leadId}#spike`}::text, r.id, false,
        ('completion:' || r.id::text),
        mcsw_is_test_row(NULL::bigint, NULL::bigint, r.id, NULL::text, NULL::jsonb,
          concat_ws(' ', ${`${operator.name || "The crew"} closed ${before[0].first_name}'s job`}::text,
            ${note || `${before[0].service} marked finished.`}::text))
      FROM immutable_receipt r CROSS JOIN operators o
      WHERE o.active = true AND ${!before[0].is_test}::boolean
      ON CONFLICT (operator_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
      RETURNING id
    )
    SELECT id FROM immutable_receipt`) as { id: number }[]
  const completionEventId = completion[0] ? Number(completion[0].id) : null
  if (!completionEventId) {
    revalidatePath(`/ops/leads/${leadId}`)
    return
  }
  if (note) {
    after(() => processEvent(completionEventId).catch((error) => console.error("DONE note extraction failed:", error)))
  }

  if (voiceNote instanceof File && voiceNote.size > 0) {
    try {
      const extension = voiceNote.type.includes("ogg") ? "ogg" : voiceNote.type.includes("mp4") ? "m4a" : "webm"
      const blob = await put(`leads/${before[0].public_id}/voice/${completionEventId}.${extension}`, voiceNote, { access: "private", contentType: voiceNote.type, allowOverwrite: true })
      await sql`
        UPDATE events SET detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ voicePath: blob.pathname, voiceContentType: voiceNote.type })}::jsonb
        WHERE id = ${completionEventId}::bigint`
    } catch (error) {
      console.error("Closeout voice-note storage failed after durable DONE:", error)
    }
  }

  if (closeoutPhoto) {
    try {
      const added = await attachCloseoutPhotoToLead({
        upload: closeoutPhoto,
        eventId: completionEventId,
        leadId,
        completionEventId,
      })
      if (added) await recordLeadEvent(leadId, "photo_added", actorId(operator), {
        pathname: closeoutPhoto.pathname,
        closeout: true,
        shared: false,
        isTest: closeoutPhoto.is_test,
        sourceCompletionEventId: completionEventId,
        sourceCloseoutUploadId: closeoutPhoto.id,
      })
    } catch (error) {
      console.error("Closeout photo failed after durable DONE:", error)
      if (!before[0].is_test) {
        await notifyAll({ priority: "digest", stock: "red", title: `${before[0].first_name} is DONE — photo needs another try`, body: "The closeout was saved. The photo was not.", url: `/ops/leads/${leadId}`, sourceEventId: completionEventId })
      }
    }
  }
  revalidatePath("/ops")
  revalidatePath(`/ops/leads/${leadId}`)
}
