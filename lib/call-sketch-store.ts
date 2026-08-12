import { getSql } from "@/lib/db"
import { buildSheetsEnabled } from "@/lib/build-sheets-access"
import { ingestCallSketchBuildFacts } from "@/lib/build-sheets"
import { buildClarificationForSketch } from "@/lib/build-sheets-continuation.mjs"
import { confirmedCallSketch, deriveCallSketch, emptyCallSketchSpec, type CallSketchSpec } from "@/lib/call-sketch-live.mjs"
import { recordEvent } from "@/lib/events"

export type LiveTranscriptionEvent = {
  callSid: string
  transcriptionSid: string
  event: string
  sequenceId: number
  track: string
  timestamp: string
  transcriptionData: string
  final: boolean
  stability: number | null
}

type TranscriptItem = {
  sequence_id: number
  track: string
  is_final: boolean
  transcript: string
  stability: number | null
  confidence: number | null
  provider_timestamp: string | null
}

function parseTranscriptionData(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { transcript?: unknown; confidence?: unknown }
    const transcript = typeof parsed.transcript === "string" ? parsed.transcript.replace(/\s+/g, " ").trim().slice(0, 10_000) : ""
    const confidence = Number(parsed.confidence)
    return { transcript, confidence: Number.isFinite(confidence) ? confidence : null }
  } catch {
    return { transcript: "", confidence: null }
  }
}

function safeTimestamp(value: string) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

async function sketchUtterances(callSid: string) {
  const sql = getSql()
  return (await sql`
    WITH final_items AS (
      SELECT sequence_id, track, is_final, transcript, stability, confidence, provider_timestamp
      FROM call_live_transcript_items
      WHERE call_sid = ${callSid}::text AND is_final = true
      ORDER BY sequence_id DESC
      LIMIT 400
    ), last_final AS (
      SELECT track, max(sequence_id) AS sequence_id
      FROM call_live_transcript_items
      WHERE call_sid = ${callSid}::text AND is_final = true
      GROUP BY track
    ), latest_partial AS (
      SELECT DISTINCT ON (item.track) item.*
      FROM call_live_transcript_items item
      LEFT JOIN last_final final ON final.track = item.track
      WHERE item.call_sid = ${callSid}::text AND item.is_final = false
        AND item.sequence_id > COALESCE(final.sequence_id, 0)
      ORDER BY item.track, item.sequence_id DESC
    )
    SELECT sequence_id, track, is_final, transcript, stability, confidence, provider_timestamp
    FROM final_items
    UNION ALL
    SELECT sequence_id, track, is_final, transcript, stability, confidence, provider_timestamp
    FROM latest_partial
    ORDER BY sequence_id ASC`) as TranscriptItem[]
}

async function finalTranscriptUtterances(callSid: string) {
  const sql = getSql()
  return (await sql`
    SELECT sequence_id, track, is_final, transcript, stability, confidence, provider_timestamp
    FROM call_live_transcript_items
    WHERE call_sid = ${callSid}::text AND is_final = true
    ORDER BY sequence_id ASC
    LIMIT 2000`) as TranscriptItem[]
}

async function rebuildObservedSketch(callSid: string, status?: string, eventSequenceId = 0, transcriptionSid = "") {
  const sql = getSql()
  const utterances = await sketchUtterances(callSid)
  const spec = deriveCallSketch(utterances.map((item) => ({
    sequenceId: Number(item.sequence_id),
    track: item.track,
    transcript: item.transcript,
  })))
  const observedThroughSequence = utterances.reduce(
    (latest, item) => Math.max(latest, Number(item.sequence_id) || 0),
    Math.max(0, eventSequenceId),
  )
  await sql`
    INSERT INTO call_sketches (
      call_sid, transcription_sid, status, observed_spec, observed_through_sequence, last_event_at, updated_at
    ) VALUES (
      ${callSid}::text, ${transcriptionSid}::text, ${status ?? "listening"}::text, ${JSON.stringify(spec)}::jsonb,
      ${observedThroughSequence}::int, now(), now()
    )
    ON CONFLICT (call_sid) DO UPDATE SET
      transcription_sid = CASE
        WHEN EXCLUDED.transcription_sid <> '' THEN EXCLUDED.transcription_sid
        ELSE call_sketches.transcription_sid
      END,
      status = CASE
        WHEN call_sketches.status = 'confirmed' THEN 'confirmed'
        WHEN call_sketches.status = 'error' THEN 'error'
        WHEN call_sketches.status IN ('review','stopped') AND EXCLUDED.status = 'listening' THEN call_sketches.status
        ELSE EXCLUDED.status
      END,
      observed_spec = CASE
        WHEN call_sketches.observed_through_sequence <= EXCLUDED.observed_through_sequence THEN EXCLUDED.observed_spec
        ELSE call_sketches.observed_spec
      END,
      observed_through_sequence = GREATEST(call_sketches.observed_through_sequence, EXCLUDED.observed_through_sequence),
      last_event_at = now(),
      updated_at = now()`
  return { spec, utterances }
}

export async function recordLiveTranscriptionEvent(input: LiveTranscriptionEvent) {
  const sql = getSql()
  if (input.event === "transcription-started") {
    await sql`
      INSERT INTO call_sketches (call_sid, transcription_sid, status, observed_spec, last_event_at, updated_at)
      VALUES (${input.callSid}::text, ${input.transcriptionSid}::text, 'listening', ${JSON.stringify(emptyCallSketchSpec())}::jsonb, now(), now())
      ON CONFLICT (call_sid) DO UPDATE SET
        transcription_sid = EXCLUDED.transcription_sid,
        status = CASE
          WHEN call_sketches.status = 'confirmed' THEN 'confirmed'
          WHEN call_sketches.status IN ('review','stopped','error') THEN call_sketches.status
          ELSE 'listening'
        END,
        last_event_at = now(), last_error = '', updated_at = now()`
    return
  }

  if (input.event === "transcription-content") {
    if (!["inbound_track", "outbound_track"].includes(input.track)) return
    const content = parseTranscriptionData(input.transcriptionData)
    if (!content.transcript) return
    await sql`
      INSERT INTO call_live_transcript_items (
        call_sid, transcription_sid, sequence_id, track, is_final, transcript,
        stability, confidence, provider_timestamp
      ) VALUES (
        ${input.callSid}::text, ${input.transcriptionSid}::text, ${input.sequenceId}::int,
        ${input.track}::text, ${input.final}::boolean, ${content.transcript}::text,
        ${input.stability}::double precision, ${content.confidence}::double precision,
        ${safeTimestamp(input.timestamp)}::timestamptz
      ) ON CONFLICT (transcription_sid, sequence_id, track) DO UPDATE SET
        is_final = EXCLUDED.is_final,
        transcript = EXCLUDED.transcript,
        stability = EXCLUDED.stability,
        confidence = EXCLUDED.confidence,
        provider_timestamp = EXCLUDED.provider_timestamp`
    if (!input.final && input.stability != null && input.stability < 0.6) return
    await rebuildObservedSketch(input.callSid, "listening", input.sequenceId, input.transcriptionSid)
    return
  }

  if (input.event === "transcription-stopped") {
    const calls = (await sql`
      SELECT direction, lead_id, person_id,
        lower(COALESCE(detail->>'isTest', 'false')) = 'true' AS is_test
      FROM calls WHERE twilio_sid = ${input.callSid}::text LIMIT 1`) as Array<{
        direction: string
        lead_id: number | null
        person_id: number | null
        is_test: boolean
      }>
    const call = calls[0]
    if (!call) throw new Error("The call receipt does not exist yet.")
    // A stopped callback has no transcript content. Do not advance the
    // observed-content watermark with its event sequence: a final utterance
    // delivered just after it must still be allowed to refresh the drawing.
    await rebuildObservedSketch(input.callSid, "review", 0, input.transcriptionSid)
    const finalTranscript = (await finalTranscriptUtterances(input.callSid))
      .map((item) => {
        const speaker = call.direction === "out"
          ? item.track === "inbound_track" ? "Shop" : "Customer"
          : item.track === "inbound_track" ? "Customer" : "Shop"
        return `${speaker}: ${item.transcript}`
      })
      .join("\n")
      .slice(0, 100_000)
    if (finalTranscript) {
      await sql`
        UPDATE calls SET transcript = ${finalTranscript}::text,
          transcript_status = 'ready', transcript_error = '', updated_at = now()
        WHERE twilio_sid = ${input.callSid}::text`
      const transcriptEventId = await recordEvent({
        kind: "call.transcript",
        actorType: "system",
        leadId: call.lead_id,
        personId: call.person_id,
        externalId: `${input.transcriptionSid}:transcript`,
        body: finalTranscript,
        detail: {
          callSid: input.callSid,
          isTest: call.is_test,
          source: "twilio-live-transcription",
          transcriptionSid: input.transcriptionSid,
        },
      })
      // The call may have been attached to a test job before the final words
      // arrived. Re-project the now-complete sketch after its transcript
      // receipt exists; the projector is idempotent by source event and item.
      if (call.is_test && call.lead_id !== null) {
        await ingestCallSketchBuildFacts(Number(call.lead_id))
      }
      await sql`
        DELETE FROM call_live_transcript_items
        WHERE call_sid = ${input.callSid}::text AND is_final = false`
      return { transcriptEventId }
    }
    return
  }

  if (input.event === "transcription-error") {
    await sql`
      INSERT INTO call_sketches (call_sid, transcription_sid, status, observed_spec, last_event_at, last_error, updated_at)
      VALUES (${input.callSid}::text, ${input.transcriptionSid}::text, 'error', ${JSON.stringify(emptyCallSketchSpec())}::jsonb, now(), 'Twilio live transcription stopped unexpectedly.', now())
      ON CONFLICT (call_sid) DO UPDATE SET
        status = CASE WHEN call_sketches.status = 'confirmed' THEN 'confirmed' ELSE 'error' END,
        last_event_at = now(), last_error = EXCLUDED.last_error, updated_at = now()`
  }
}

export async function getCallSketchForDraft(publicId: string) {
  const sql = getSql()
  const rows = (await sql`
    SELECT d.call_sid, d.caller_name, d.phone, c.direction, c.status AS call_status,
      COALESCE(s.status, 'waiting') AS sketch_status,
      COALESCE(s.observed_spec, ${JSON.stringify(emptyCallSketchSpec())}::jsonb) AS observed_spec,
      s.confirmed_spec, COALESCE(s.revision, 0)::int AS revision,
      s.confirmed_at, COALESCE(s.last_error, '') AS last_error, s.last_event_at, d.is_test
    FROM call_intake_drafts d
    JOIN calls c ON c.twilio_sid = d.call_sid
    LEFT JOIN call_sketches s ON s.call_sid = d.call_sid
    WHERE d.public_id = ${publicId.slice(0, 80)}::text
      AND d.status = ANY(ARRAY['pending','saving','failed','unknown']::text[])
    LIMIT 1`) as Array<{
      call_sid: string
      caller_name: string
      phone: string
      direction: string
      call_status: string
      sketch_status: string
      observed_spec: CallSketchSpec
      confirmed_spec: CallSketchSpec | null
      revision: number
      confirmed_at: string | null
      last_error: string
      last_event_at: string | null
      is_test: boolean
    }>
  const sketch = rows[0]
  if (!sketch) return null
  const utterances = (await sketchUtterances(sketch.call_sid)).slice(-24)
  const buildQuestion = buildSheetsEnabled() && sketch.is_test && !sketch.confirmed_spec
    ? buildClarificationForSketch(sketch.observed_spec)
    : null
  return {
    callerName: sketch.caller_name,
    phone: sketch.phone,
    callStatus: sketch.call_status,
    status: sketch.sketch_status,
    observedSpec: sketch.observed_spec,
    confirmedSpec: sketch.confirmed_spec,
    revision: sketch.revision,
    confirmedAt: sketch.confirmed_at,
    lastError: sketch.last_error,
    lastEventAt: sketch.last_event_at,
    buildQuestion,
    utterances: utterances.map((item) => ({
      sequenceId: Number(item.sequence_id),
      speaker: sketch.direction === "in"
        ? item.track === "inbound_track" ? "Customer" : "Shop"
        : item.track === "inbound_track" ? "Shop" : "Customer",
      transcript: item.transcript,
      final: item.is_final,
      stability: item.stability,
      confidence: item.confidence,
      timestamp: item.provider_timestamp,
    })),
  }
}

export async function confirmCallSketchForDraft(input: {
  publicId: string
  operatorId: number
  expectedRevision: number
  spec: Parameters<typeof confirmedCallSketch>[0]
}) {
  const sql = getSql()
  const calls = (await sql`
    SELECT d.call_sid
    FROM call_intake_drafts d
    WHERE d.public_id = ${input.publicId.slice(0, 80)}::text
      AND d.status = ANY(ARRAY['pending','saving','failed','unknown']::text[])
    LIMIT 1`) as { call_sid: string }[]
  if (!calls[0]) throw new Error("That call sketch is no longer available.")
  const spec = confirmedCallSketch(input.spec)
  const updated = (await sql`
    INSERT INTO call_sketches (
      call_sid, status, observed_spec, confirmed_spec, revision, confirmed_by,
      confirmed_at, last_event_at, updated_at
    ) VALUES (
      ${calls[0].call_sid}::text, 'confirmed', ${JSON.stringify(spec)}::jsonb,
      ${JSON.stringify(spec)}::jsonb, 1, ${input.operatorId}::bigint, now(), now(), now()
    ) ON CONFLICT (call_sid) DO UPDATE SET
      status = 'confirmed', confirmed_spec = EXCLUDED.confirmed_spec,
      revision = call_sketches.revision + 1, confirmed_by = EXCLUDED.confirmed_by,
      confirmed_at = now(), last_error = '', updated_at = now()
    WHERE call_sketches.revision = ${input.expectedRevision}::int
    RETURNING revision, confirmed_at`) as { revision: number; confirmed_at: string }[]
  if (!updated[0]) throw new Error("The sketch changed on another device. Reload it before confirming.")
  return { spec, revision: Number(updated[0].revision), confirmedAt: updated[0].confirmed_at }
}

export async function getConfirmedCallSketchForDraft(publicId: string) {
  const sql = getSql()
  const rows = (await sql`
    SELECT s.confirmed_spec
    FROM call_intake_drafts d
    JOIN call_sketches s ON s.call_sid = d.call_sid
    WHERE d.public_id = ${publicId.slice(0, 80)}::text AND s.status = 'confirmed'
    LIMIT 1`) as { confirmed_spec: CallSketchSpec }[]
  return rows[0]?.confirmed_spec ?? null
}
