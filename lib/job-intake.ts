import { randomUUID } from "node:crypto"
import type { CallSummary } from "@/lib/call-summary"
import { attachRecoveredCallArtifacts } from "@/lib/call-artifacts"
import { ingestCallSketchBuildFacts } from "@/lib/build-sheets"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { createLead } from "@/lib/leads"
import {
  findOrCreatePerson,
  findOpenLeadResolutionForPerson,
  normalizePhone,
  type PersonRow,
} from "@/lib/people"

export type CallIntakeStatus = "pending" | "saving" | "saved" | "dismissed" | "failed" | "unknown"

export type CallIntakeDraft = {
  id: number
  public_id: string
  call_sid: string
  person_id: number | null
  lead_id: number | null
  caller_name: string
  phone: string
  need: string
  status: CallIntakeStatus
  is_test: boolean
  created_at: string
  updated_at: string
  save_started_at: string | null
  saved_at: string | null
  dismissed_at: string | null
  last_error: string
  // Post-call read of the transcript (lib/call-summary.ts). Null until it runs.
  summary: CallSummary | null
  summary_status: string
  call_status: string
  duration_sec: number
  transcript_status: string
  transcript: string
}

export type PreparedInboundCall =
  | { kind: "existing"; leadId: number; person: PersonRow }
  | { kind: "draft"; draft: CallIntakeDraft; person: PersonRow | null }

function cleanCallerName(value: string) {
  const name = value.replace(/\s+/g, " ").trim().slice(0, 120)
  return /^(unknown|anonymous|private)$/i.test(name) ? "" : name
}

async function projectRecoveredTestCallBuildFacts(callSid: string, leadId: number, isTest: boolean) {
  if (!isTest) return
  const sql = getSql()
  await sql`
    INSERT INTO build_sketch_job_links (lead_id, call_sid, is_test)
    SELECT l.id, ${callSid}::text, true
    FROM leads l
    WHERE l.id = ${leadId}::bigint AND l.is_test = true
    ON CONFLICT (lead_id) DO UPDATE SET call_sid = EXCLUDED.call_sid
    WHERE build_sketch_job_links.is_test = true`
  await ingestCallSketchBuildFacts(leadId)
}

export async function prepareInboundCallIntake(input: {
  callSid: string
  phone: string
  callerName?: string
  isTest?: boolean
}): Promise<PreparedInboundCall> {
  const sql = getSql()
  const phone = normalizePhone(input.phone) ?? ""
  const callerName = cleanCallerName(input.callerName ?? "")
  const isTest = Boolean(input.isTest || callerName.includes("[INTERNAL TEST]"))
  const person = phone
    ? await findOrCreatePerson({
        phone,
        displayName: callerName || `Caller ${phone.slice(-4)}`,
        isTest,
      })
    : null

  if (person) {
    const openLead = await findOpenLeadResolutionForPerson(person.id, person.is_test)
    if (openLead.leadId && !openLead.needsJobMatch) {
      await sql`
        UPDATE calls SET lead_id = COALESCE(lead_id, ${openLead.leadId}::bigint),
          person_id = COALESCE(person_id, ${person.id}::bigint),
          detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({
            isTest: person.is_test,
            reconciliationHandled: true,
            reconciliationOutcome: "existing-job",
          })}::jsonb,
          updated_at = now()
        WHERE twilio_sid = ${input.callSid}::text`
      await attachRecoveredCallArtifacts(input.callSid, openLead.leadId, person.id, person.is_test)
      await projectRecoveredTestCallBuildFacts(input.callSid, openLead.leadId, person.is_test)
      return { kind: "existing", leadId: openLead.leadId, person }
    }
  }

  const generatedId = randomUUID()
  const rows = (await sql`
    INSERT INTO call_intake_drafts (
      public_id, call_sid, person_id, caller_name, phone, status, is_test
    ) VALUES (
      ${generatedId}::text, ${input.callSid}::text, ${person?.id ?? null}::bigint,
      ${callerName || person?.display_name || (phone ? `Caller ${phone.slice(-4)}` : "Private caller")}::text,
      ${phone}::text, 'pending', ${person?.is_test ?? isTest}::boolean
    ) ON CONFLICT (call_sid) DO UPDATE SET
      person_id = COALESCE(call_intake_drafts.person_id, EXCLUDED.person_id),
      caller_name = CASE WHEN call_intake_drafts.caller_name = '' THEN EXCLUDED.caller_name ELSE call_intake_drafts.caller_name END,
      phone = CASE WHEN call_intake_drafts.phone = '' THEN EXCLUDED.phone ELSE call_intake_drafts.phone END,
      is_test = call_intake_drafts.is_test OR EXCLUDED.is_test,
      updated_at = now()
    RETURNING *`) as CallIntakeDraft[]
  await sql`
    UPDATE calls SET person_id = COALESCE(person_id, ${person?.id ?? null}::bigint),
      detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({
        isTest: person?.is_test ?? isTest,
        reconciliationHandled: true,
        reconciliationOutcome: "call-draft",
      })}::jsonb,
      updated_at = now()
    WHERE twilio_sid = ${input.callSid}::text`
  const draft = await getCallIntakeDraft(rows[0].public_id)
  if (!draft) throw new Error("The incoming call draft could not be read after it was filed.")
  return { kind: "draft", draft, person }
}

export async function getCallIntakeDraft(publicId: string): Promise<CallIntakeDraft | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT d.*, c.status AS call_status, COALESCE(c.duration_sec, 0)::int AS duration_sec,
      c.transcript_status, c.transcript
    FROM call_intake_drafts d
    JOIN calls c ON c.twilio_sid = d.call_sid
    WHERE d.public_id = ${publicId.slice(0, 80)}::text
    LIMIT 1`) as CallIntakeDraft[]
  return rows[0] ?? null
}

export async function listPendingCallIntakes(options: { page?: number; pageSize?: number } = {}): Promise<{ items: CallIntakeDraft[]; total: number; page: number; pageSize: number }> {
  const sql = getSql()
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? 3), 1), 20)
  const requestedPage = Math.max(1, Math.floor(options.page ?? 1))
  // The count carries the same calls join as the page query below: a draft
  // whose call row is missing never renders, so it must not be counted either.
  const totals = (await sql`
    SELECT count(*)::int AS total_count
    FROM call_intake_drafts d
    JOIN calls c ON c.twilio_sid = d.call_sid
    WHERE d.status = ANY(ARRAY['pending','failed','unknown','saving']::text[])
      AND d.is_test = false`) as { total_count: number }[]
  const total = Number(totals[0]?.total_count ?? 0)
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
  const offset = (page - 1) * pageSize
  const rows = (await sql`
    SELECT d.*, c.status AS call_status, COALESCE(c.duration_sec, 0)::int AS duration_sec,
      c.transcript_status, ''::text AS transcript
    FROM call_intake_drafts d
    JOIN calls c ON c.twilio_sid = d.call_sid
    WHERE d.status = ANY(ARRAY['pending','failed','unknown','saving']::text[])
      AND d.is_test = false
    ORDER BY d.created_at DESC
    LIMIT ${pageSize}::bigint OFFSET ${offset}::bigint`) as CallIntakeDraft[]
  return { items: rows, total, page, pageSize }
}

export async function saveInboundCallAsJob(input: {
  publicId: string
  // Null when the read of the call saved it, with nobody at a keyboard. The
  // byline then says "system", because attribution names who changed the
  // record and no operator did.
  operatorId: number | null
  automatic?: boolean
  name: string
  phone: string
  need: string
  service?: string
  referral?: string
  deferExtraction?: boolean
}): Promise<{ leadId: number; eventId: number | null }> {
  const sql = getSql()
  const draft = await getCallIntakeDraft(input.publicId)
  if (!draft) throw new Error("That call is no longer available.")
  if (draft.status === "dismissed") throw new Error("That call was marked as not a job.")
  if (draft.status === "saved" && draft.lead_id) return { leadId: Number(draft.lead_id), eventId: null }

  const claimed = (await sql`
    UPDATE call_intake_drafts SET status = 'saving', save_started_at = now(),
      last_error = '', updated_at = now()
    WHERE id = ${draft.id}::bigint
      AND status = ANY(ARRAY['pending','failed','unknown']::text[])
    RETURNING id, save_started_at`) as { id: number; save_started_at: string }[]
  if (!claimed[0]) {
    const current = await getCallIntakeDraft(input.publicId)
    if (current?.status === "saved" && current.lead_id) {
      return { leadId: Number(current.lead_id), eventId: null }
    }
    if (current?.status === "dismissed") throw new Error("That call was marked as not a job.")
    throw new Error("That call is already being saved on another device. Reload before trying again.")
  }
  const saveReceiptKey = new Date(claimed[0].save_started_at).getTime()

  const phone = normalizePhone(input.phone) ?? draft.phone
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 120)
  const need = input.need.trim().slice(0, 2000)
  const referral = input.referral?.trim().slice(0, 160) ?? ""
  const intakeNote = [
    need || "Phone call saved. Details are in Calls & Messages.",
    referral ? `Referral: ${referral}` : "",
  ].filter(Boolean).join("\n").slice(0, 2000)
  const firstResponseNow = ["answered", "completed"].includes(draft.call_status) && draft.duration_sec > 0

  try {
    const created = await createLead({
      firstName: name || draft.caller_name || (phone ? `Caller ${phone.slice(-4)}` : "Caller"),
      lastName: "",
      phone,
      email: "",
      service: input.service?.trim().slice(0, 120) || "Inbound phone request",
      message: intakeNote,
      preferredContact: "Call",
      photoCount: 0,
      gclid: "",
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmTerm: "",
      utmContent: "",
      landingPage: "",
      referrer: "",
      ip: "",
      userAgent: "ops-call-intake",
      isTest: draft.is_test || intakeNote.includes("[INTERNAL TEST]"),
    }, {
      sourceOverride: "phone-in",
      actor: input.operatorId == null ? "system" : String(input.operatorId),
      firstResponseNow,
      intakeKey: `call:${draft.call_sid}`,
    })
    let restored = false
    if (!created.eventId) {
      const restoredRows = (await sql`
        UPDATE leads SET
          first_name = ${name || draft.caller_name || (phone ? `Caller ${phone.slice(-4)}` : "Caller")}::text,
          phone = ${phone}::text,
          service = ${input.service?.trim().slice(0, 120) || "Inbound phone request"}::text,
          message = ${intakeNote}::text,
          status = ${firstResponseNow ? "contacted" : "new"}::text,
          status_reason = '', lost_at = NULL,
          first_response_at = CASE WHEN ${firstResponseNow}::boolean THEN COALESCE(first_response_at, now()) ELSE first_response_at END,
          first_response_channel = CASE WHEN ${firstResponseNow}::boolean AND first_response_channel = '' THEN 'phone' ELSE first_response_channel END,
          updated_at = now()
        WHERE id = ${created.id}::bigint
          AND intake_key = ${`call:${draft.call_sid}`}::text
          AND status = 'lost' AND status_reason = 'Intake undone'
        RETURNING id`) as { id: number }[]
      if (restoredRows[0]) {
        restored = true
        await recordEvent({
          kind: "call.intake.resaved",
          actorType: input.operatorId == null ? "system" : "operator",
          actorId: input.operatorId ?? "",
          leadId: created.id,
          personId: draft.person_id,
          body: "Undone call intake saved again",
          crewBody: "Undone call intake saved again",
          detail: { callSid: draft.call_sid },
        })
      }
    }
    if (restored) {
      await sql`
        UPDATE events SET processed_at = NULL, extraction_status = 'pending',
          extraction_next_attempt_at = ${input.deferExtraction ? new Date(Date.now() + 11 * 60 * 1000).toISOString() : null}::timestamptz,
          extraction_last_error = ''
        WHERE lead_id = ${created.id}::bigint
          AND detail->>'intakeUndoDeferred' = 'true'`
    }
    const leads = (await sql`
      SELECT person_id, is_test FROM leads WHERE id = ${created.id}::bigint LIMIT 1`) as {
      person_id: number | null
      is_test: boolean
    }[]
    const personId = leads[0]?.person_id ?? draft.person_id
    await sql`
      UPDATE calls SET lead_id = ${created.id}::bigint,
        person_id = COALESCE(person_id, ${personId}::bigint),
        detail = COALESCE(detail, '{}'::jsonb) || '{"intakeOutcome":"saved"}'::jsonb,
        updated_at = now()
      WHERE twilio_sid = ${draft.call_sid}::text`
    await attachRecoveredCallArtifacts(draft.call_sid, created.id, personId, leads[0]?.is_test ?? draft.is_test)
    await projectRecoveredTestCallBuildFacts(draft.call_sid, created.id, leads[0]?.is_test ?? draft.is_test)
    await recordEvent({
      kind: "call.intake.saved",
      actorType: input.operatorId == null ? "system" : "operator",
      actorId: input.operatorId ?? "",
      leadId: created.id,
      personId,
      externalId: `${draft.call_sid}:intake-saved:${saveReceiptKey}`,
      body: input.automatic ? "Call saved as a job from what the caller said" : "Call saved as a job",
      crewBody: input.automatic ? "Call saved as a job from what the caller said" : "Call saved as a job",
      detail: { callSid: draft.call_sid },
    })
    const finalized = (await sql`
      UPDATE call_intake_drafts SET status = 'saved', lead_id = ${created.id}::bigint,
        person_id = COALESCE(person_id, ${personId}::bigint), caller_name = ${name || draft.caller_name}::text,
        phone = ${phone}::text, need = ${need}::text, saved_at = COALESCE(saved_at, now()),
        last_error = '', updated_at = now()
      WHERE id = ${draft.id}::bigint AND status = 'saving'
      RETURNING id`) as { id: number }[]
    if (!finalized[0]) {
      const current = await getCallIntakeDraft(input.publicId)
      if (current?.status !== "saved" || Number(current.lead_id) !== created.id) {
        throw new Error("That call changed while it was being saved. Reload MCSW Jobs.")
      }
    }
    if (input.deferExtraction) {
      await sql`
        UPDATE events SET extraction_next_attempt_at = now() + interval '11 minutes'
        WHERE lead_id = ${created.id}::bigint AND processed_at IS NULL
          AND kind = ANY(ARRAY['form.quote','call.transcript']::text[])`
    }
    return { leadId: created.id, eventId: created.eventId }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "The call could not be saved yet."
    await sql`
      UPDATE call_intake_drafts SET status = 'failed', last_error = ${message}::text, updated_at = now()
      WHERE id = ${draft.id}::bigint AND status = 'saving'`
    throw error
  }
}

// A repeat caller with a job already open does not get a second job. Ring
// time already files such calls (prepareInboundCallIntake above); this is the
// same filing for a draft whose caller's job was created after the call rang,
// which is how one caller ended up as two drafts and one job on 2026-09-03.
export async function fileCallOntoOpenLead(input: { publicId: string; leadId: number }): Promise<{ leadId: number }> {
  const sql = getSql()
  const draft = await getCallIntakeDraft(input.publicId)
  if (!draft) throw new Error("That call is no longer available.")
  if (draft.status === "saved" && draft.lead_id) return { leadId: Number(draft.lead_id) }
  const claimed = (await sql`
    UPDATE call_intake_drafts SET status = 'saving', save_started_at = now(), last_error = '', updated_at = now()
    WHERE id = ${draft.id}::bigint AND status = ANY(ARRAY['pending','failed','unknown']::text[])
    RETURNING id`) as { id: number }[]
  if (!claimed[0]) throw new Error("That call is already being saved.")
  try {
    const leads = (await sql`
      SELECT person_id, is_test FROM leads WHERE id = ${input.leadId}::bigint LIMIT 1`) as { person_id: number | null; is_test: boolean }[]
    if (!leads[0]) throw new Error("That job no longer exists.")
    const personId = leads[0].person_id ?? draft.person_id
    const isTest = leads[0].is_test || draft.is_test
    await sql`
      UPDATE calls SET lead_id = COALESCE(lead_id, ${input.leadId}::bigint),
        person_id = COALESCE(person_id, ${personId}::bigint),
        detail = COALESCE(detail, '{}'::jsonb) || '{"intakeOutcome":"filed"}'::jsonb,
        updated_at = now()
      WHERE twilio_sid = ${draft.call_sid}::text`
    await attachRecoveredCallArtifacts(draft.call_sid, input.leadId, personId, isTest)
    await projectRecoveredTestCallBuildFacts(draft.call_sid, input.leadId, isTest)
    await recordEvent({
      kind: "call.intake.saved",
      actorType: "system",
      actorId: "",
      leadId: input.leadId,
      personId,
      externalId: `${draft.call_sid}:intake-filed`,
      body: "Repeat call filed to this job",
      crewBody: "Repeat call filed to this job",
      detail: { callSid: draft.call_sid, filed: true },
    })
    await sql`
      UPDATE call_intake_drafts SET status = 'saved', lead_id = ${input.leadId}::bigint,
        person_id = COALESCE(person_id, ${personId}::bigint), saved_at = COALESCE(saved_at, now()),
        last_error = '', updated_at = now()
      WHERE id = ${draft.id}::bigint AND status = 'saving'`
    return { leadId: input.leadId }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "The call could not be filed."
    await sql`
      UPDATE call_intake_drafts SET status = 'failed', last_error = ${message}::text, updated_at = now()
      WHERE id = ${draft.id}::bigint AND status = 'saving'`
    throw error
  }
}

export async function dismissInboundCallDraft(input: { publicId: string; operatorId: number }) {
  const sql = getSql()
  const rows = (await sql`
    UPDATE call_intake_drafts SET status = 'dismissed', dismissed_at = COALESCE(dismissed_at, now()),
      updated_at = now(), last_error = ''
    WHERE public_id = ${input.publicId.slice(0, 80)}::text
      AND status = ANY(ARRAY['pending','failed','unknown']::text[])
    RETURNING id, call_sid, person_id, is_test`) as {
    id: number
    call_sid: string
    person_id: number | null
    is_test: boolean
  }[]
  if (!rows[0]) return { dismissed: false }
  await sql`
    UPDATE calls SET detail = COALESCE(detail, '{}'::jsonb) || '{"intakeOutcome":"dismissed"}'::jsonb,
      updated_at = now()
    WHERE twilio_sid = ${rows[0].call_sid}::text`
  await recordEvent({
    kind: "call.intake.dismissed",
    actorType: "operator",
    actorId: input.operatorId,
    personId: rows[0].person_id,
    externalId: `${rows[0].call_sid}:intake-dismissed`,
    body: "Call marked as not a job",
    crewBody: "Call marked as not a job",
    detail: { callSid: rows[0].call_sid, isTest: rows[0].is_test },
  })
  return { dismissed: true }
}

export async function restoreInboundCallDraft(input: { publicId: string; operatorId: number }) {
  const sql = getSql()
  const rows = (await sql`
    WITH target AS (
      SELECT id, call_sid, person_id, is_test, dismissed_at
      FROM call_intake_drafts
      WHERE public_id = ${input.publicId.slice(0, 80)}::text
        AND status = 'dismissed' AND lead_id IS NULL
      FOR UPDATE
    )
    UPDATE call_intake_drafts d SET status = 'pending', dismissed_at = NULL,
      save_started_at = NULL, updated_at = now(), last_error = ''
    FROM target t WHERE d.id = t.id
    RETURNING d.id, t.call_sid, t.person_id, t.is_test, t.dismissed_at`) as {
    id: number
    call_sid: string
    person_id: number | null
    is_test: boolean
    dismissed_at: string | null
  }[]
  if (!rows[0]) return { restored: false }
  await sql`
    UPDATE calls SET detail = COALESCE(detail, '{}'::jsonb) || '{"intakeOutcome":"pending"}'::jsonb,
      updated_at = now()
    WHERE twilio_sid = ${rows[0].call_sid}::text`
  const dispositionKey = rows[0].dismissed_at
    ? new Date(rows[0].dismissed_at).getTime()
    : rows[0].id
  await recordEvent({
    kind: "call.intake.restored",
    actorType: "operator",
    actorId: input.operatorId,
    personId: rows[0].person_id,
    externalId: `${rows[0].call_sid}:intake-restored:${dispositionKey}`,
    body: "Call restored to job intake",
    crewBody: "Call restored to job intake",
    detail: { callSid: rows[0].call_sid, isTest: rows[0].is_test },
  })
  return { restored: true }
}

export async function undoSavedJobIntake(input: {
  leadId: number
  operatorId: number
  operatorRole: "owner" | "crew"
  source: "call" | "manual"
  intakeRef: string
}) {
  const sql = getSql()
  const intakeRef = input.intakeRef.trim().slice(0, 80)
  if (!/^[a-zA-Z0-9-]{12,80}$/.test(intakeRef)) return { undone: false }

  if (input.source === "manual") {
    const rows = (await sql`
      WITH target AS (
        SELECT l.id, l.person_id, l.is_test
        FROM leads l
        WHERE l.id = ${input.leadId}::bigint
          AND l.intake_key = ${`manual:${intakeRef}`}::text
          AND l.status = ANY(ARRAY['new','contacted']::text[])
          AND l.created_at >= now() - interval '10 minutes'
          AND (
            ${input.operatorRole === "owner"}::boolean OR EXISTS (
              SELECT 1 FROM events created
              WHERE created.lead_id = l.id
                AND created.kind = ANY(ARRAY['form.quote','lead.intake.restored']::text[])
                AND created.actor_id = ${String(input.operatorId)}::text
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM events side_effect
            WHERE side_effect.lead_id = l.id
              AND (
                side_effect.kind ~ '^(email|sms|glass|invoice|payment)\\.' OR
                side_effect.kind = ANY(ARRAY[
                  'call.in','call.out','call.missed','call.answered','call.transcript',
                  'photo.added','quote.saved','job.completed',
                  'contact.logged','contact.first-response'
                ]::text[])
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM commitments c WHERE c.lead_id = l.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM claims c
            WHERE c.subject_type = 'lead' AND c.subject_id = l.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
            JOIN events source ON source.id = n.source_event_id
            WHERE source.lead_id = l.id AND n.created_at > l.created_at
          )
        FOR UPDATE OF l
      ), changed AS (
        UPDATE leads l SET status = 'lost', status_reason = 'Intake undone',
          lost_at = now(), updated_at = now()
        FROM target t WHERE l.id = t.id
        RETURNING l.id
      ), extraction_stop AS (
        UPDATE events e SET processed_at = now(), extraction_status = 'done',
          extraction_next_attempt_at = NULL,
          extraction_last_error = 'Intake undone before extraction.',
          detail = COALESCE(e.detail, '{}'::jsonb) || '{"intakeUndoDeferred":true}'::jsonb
        FROM changed c
        WHERE e.lead_id = c.id AND e.processed_at IS NULL
          AND e.kind = ANY(ARRAY['form.quote','call.transcript']::text[])
        RETURNING e.id
      ), receipt AS (
        INSERT INTO events (
          occurred_at, kind, actor_type, actor_id, lead_id, person_id,
          external_id, body, crew_body, detail
        )
        SELECT now(), 'job.intake-undone', 'operator', ${String(input.operatorId)}::text,
          t.id, t.person_id, '', 'New-job intake undone', 'New-job intake undone',
          ${JSON.stringify({ source: "manual" })}::jsonb
        FROM target t JOIN changed c ON c.id = t.id
        RETURNING id
      )
      SELECT id FROM receipt`) as { id: number }[]
    if (rows[0]) return { undone: true }
    const prior = (await sql`
      SELECT id FROM leads
      WHERE id = ${input.leadId}::bigint
        AND intake_key = ${`manual:${intakeRef}`}::text
        AND status = 'lost' AND status_reason = 'Intake undone'
      LIMIT 1`) as { id: number }[]
    return { undone: Boolean(prior[0]) }
  }

  const rows = (await sql`
    WITH target AS (
      SELECT l.id, l.person_id, l.is_test, d.id AS draft_id, d.call_sid
      FROM leads l
      JOIN call_intake_drafts d ON d.lead_id = l.id
      JOIN calls call_row ON call_row.twilio_sid = d.call_sid
      WHERE l.id = ${input.leadId}::bigint
        AND l.intake_key = ('call:' || d.call_sid)
        AND d.public_id = ${intakeRef}::text AND d.status = 'saved'
        AND d.saved_at >= now() - interval '10 minutes'
        AND l.status = ANY(ARRAY['new','contacted']::text[])
        AND (
          ${input.operatorRole === "owner"}::boolean OR EXISTS (
            SELECT 1 FROM events saved
            WHERE saved.lead_id = l.id AND saved.kind = 'call.intake.saved'
              AND saved.actor_id = ${String(input.operatorId)}::text
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM events side_effect
          WHERE side_effect.lead_id = l.id
            AND side_effect.occurred_at > d.saved_at
            AND (
              side_effect.kind ~ '^(email|sms|glass|invoice|payment)\\.' OR
              side_effect.kind = ANY(ARRAY[
                'call.in','call.out','call.missed','call.answered','call.transcript',
                'photo.added','quote.saved','job.completed',
                'contact.logged','contact.first-response'
              ]::text[])
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM commitments c WHERE c.lead_id = l.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM claims c
          WHERE c.subject_type = 'lead' AND c.subject_id = l.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          JOIN events source ON source.id = n.source_event_id
          WHERE source.lead_id = l.id AND n.created_at > d.saved_at
        )
      FOR UPDATE OF l, d, call_row
    ), lead_update AS (
      UPDATE leads l SET status = 'lost', status_reason = 'Intake undone',
        lost_at = now(), updated_at = now()
      FROM target t WHERE l.id = t.id
      RETURNING l.id
    ), draft_update AS (
      UPDATE call_intake_drafts d SET status = 'pending', lead_id = NULL,
        save_started_at = NULL, saved_at = NULL, last_error = '', updated_at = now()
      FROM target t JOIN lead_update l ON l.id = t.id
      WHERE d.id = t.draft_id
      RETURNING d.id
    ), call_update AS (
      UPDATE calls c SET
        lead_id = NULL,
        detail = COALESCE(c.detail, '{}'::jsonb) || '{"intakeOutcome":"pending"}'::jsonb,
        updated_at = now()
      FROM target t JOIN draft_update d ON d.id = t.draft_id
      WHERE c.twilio_sid = t.call_sid
      RETURNING c.twilio_sid
    ), extraction_stop AS (
      UPDATE events e SET processed_at = now(), extraction_status = 'done',
        extraction_next_attempt_at = NULL,
        extraction_last_error = 'Intake undone before extraction.',
        detail = COALESCE(e.detail, '{}'::jsonb) || '{"intakeUndoDeferred":true}'::jsonb
      FROM lead_update l
      WHERE e.lead_id = l.id AND e.processed_at IS NULL
        AND e.kind = ANY(ARRAY['form.quote','call.transcript']::text[])
      RETURNING e.id
    ), receipt AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, person_id,
        external_id, body, crew_body, detail
      )
      SELECT now(), 'job.intake-undone', 'operator', ${String(input.operatorId)}::text,
        t.id, t.person_id, '', 'Saved call intake undone', 'Saved call intake undone',
        ${JSON.stringify({ source: "call", draftId: intakeRef })}::jsonb
      FROM target t
      JOIN lead_update l ON l.id = t.id
      JOIN call_update c ON c.twilio_sid = t.call_sid
      RETURNING id
    )
    SELECT id FROM receipt`) as { id: number }[]
  if (rows[0]) return { undone: true }
  const prior = (await sql`
    SELECT l.id FROM leads l
    JOIN call_intake_drafts d ON d.call_sid = substring(l.intake_key from 6)
    WHERE l.id = ${input.leadId}::bigint
      AND d.public_id = ${intakeRef}::text AND d.status = 'pending' AND d.lead_id IS NULL
      AND l.status = 'lost' AND l.status_reason = 'Intake undone'
    LIMIT 1`) as { id: number }[]
  return { undone: Boolean(prior[0]) }
}

export async function reconcileStaleCallIntakes(limit = 20) {
  const sql = getSql()
  const rows = (await sql`
    SELECT id, call_sid, person_id, is_test FROM call_intake_drafts
    WHERE status = ANY(ARRAY['saving','unknown']::text[])
      AND updated_at < now() - interval '5 minutes'
    ORDER BY updated_at ASC LIMIT ${Math.min(Math.max(limit, 1), 50)}::bigint`) as {
    id: number
    call_sid: string
    person_id: number | null
    is_test: boolean
  }[]
  let saved = 0
  let reopened = 0
  for (const row of rows) {
    const leads = (await sql`
      SELECT id, person_id, is_test FROM leads WHERE intake_key = ${`call:${row.call_sid}`}::text LIMIT 1`) as {
      id: number
      person_id: number | null
      is_test: boolean
    }[]
    if (leads[0]) {
      await sql`
        UPDATE call_intake_drafts SET status = 'saved', lead_id = ${leads[0].id}::bigint,
          person_id = COALESCE(person_id, ${leads[0].person_id}::bigint), saved_at = COALESCE(saved_at, now()),
          last_error = '', updated_at = now()
        WHERE id = ${row.id}::bigint`
      await sql`
        UPDATE calls SET lead_id = ${leads[0].id}::bigint,
          person_id = COALESCE(person_id, ${leads[0].person_id}::bigint), updated_at = now()
        WHERE twilio_sid = ${row.call_sid}::text`
      await attachRecoveredCallArtifacts(row.call_sid, leads[0].id, leads[0].person_id ?? row.person_id, leads[0].is_test)
      await projectRecoveredTestCallBuildFacts(row.call_sid, leads[0].id, leads[0].is_test)
      saved += 1
    } else {
      await sql`
        UPDATE call_intake_drafts SET status = 'pending', save_started_at = NULL,
          last_error = 'The previous save did not finish. Nothing was duplicated; tap Save call as job again.', updated_at = now()
        WHERE id = ${row.id}::bigint`
      reopened += 1
    }
  }
  return { scanned: rows.length, saved, reopened }
}
