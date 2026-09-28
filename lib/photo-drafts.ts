import { get } from "@vercel/blob"
import { Output, generateText } from "ai"
import { addClaim, supersedeClaimWithExisting } from "@/lib/claims"
import { AI_MAX_RETRIES, AI_MODELS, runAiCall } from "@/lib/ai"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import {
  applyPhotoDraftDecision,
  photoDraftFlagEnabled,
  photoDraftOutputSchema,
  runPhotoDraftWorkflow,
  type PhotoDraftWorkflowInput,
} from "@/lib/photo-draft-workflow.mjs"

const MAX_PHOTO_BYTES = 20 * 1024 * 1024
const AI_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export function photoDraftsEnabled() {
  return photoDraftFlagEnabled(process.env)
}

async function readPrivatePhoto(pathname: string, contentType: string, expectedSize: number) {
  if (!AI_IMAGE_TYPES.has(contentType)) throw new Error("This photo format is not supported for draft review.")
  if (!Number.isInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_PHOTO_BYTES) {
    throw new Error("This photo is outside the draft review size limit.")
  }
  const result = await get(pathname, { access: "private" })
  if (!result || result.statusCode !== 200 || !result.stream) throw new Error("The filed photo could not be read for draft review.")
  const reader = result.stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_PHOTO_BYTES || total > expectedSize) throw new Error("The filed photo exceeded its upload size.")
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  if (total !== expectedSize) throw new Error("The filed photo size did not match its upload receipt.")
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

export async function draftStoredGlassUpload(uploadId: string) {
  if (!photoDraftsEnabled()) return { status: "disabled", claimIds: [] }
  const sql = getSql()
  const rows = (await sql`
    SELECT u.id, u.lead_id, u.pathname, u.filename, u.content_type, u.size_bytes,
      l.is_test, l.glass_caption_draft
    FROM glass_uploads u
    JOIN leads l ON l.id = u.lead_id
    WHERE u.id = ${uploadId}::text AND u.status = 'stored' AND l.status <> 'lost'
    LIMIT 1`) as Array<{
      id: string
      lead_id: number
      pathname: string
      filename: string
      content_type: string
      size_bytes: number
      is_test: boolean
      glass_caption_draft: string | null
    }>
  const upload = rows[0]
  if (!upload || !upload.content_type.startsWith("image/")) return { status: "not-photo", claimIds: [] }

  const input: PhotoDraftWorkflowInput = {
    uploadId: upload.id,
    leadId: Number(upload.lead_id),
    filename: upload.filename,
    caption: upload.glass_caption_draft ?? "",
    photoReference: "photo-1",
    isTest: Boolean(upload.is_test),
  }
  const externalId = `glass-photo-draft:${upload.id}`
  return runPhotoDraftWorkflow(input, {
    persistIntent: async () => {
      await recordEvent({
        kind: "photo.draft.intent",
        actorType: "ai",
        leadId: input.leadId,
        externalId,
        body: "Owner photo-detail draft requested.",
        detail: {
          uploadId: input.uploadId,
          isTest: input.isTest,
          sensitivity: "owner-only",
          photoReference: input.photoReference,
        },
      })
      const intents = (await sql`
        SELECT id, extraction_status AS status FROM events
        WHERE kind = 'photo.draft.intent' AND external_id = ${externalId}::text
        LIMIT 1`) as { id: number; status: string }[]
      if (!intents[0]) throw new Error("The photo draft intent could not be filed.")
      return { id: Number(intents[0].id), status: intents[0].status }
    },
    claimIntent: async (intentId) => {
      const claimed = (await sql`
        UPDATE events SET extraction_status = 'processing',
          extraction_attempts = extraction_attempts + 1,
          extraction_next_attempt_at = NULL
        WHERE id = ${intentId}::bigint AND kind = 'photo.draft.intent'
          AND extraction_status = 'pending' AND processed_at IS NULL
        RETURNING id`) as { id: number }[]
      return Boolean(claimed[0])
    },
    generate: async ({ system, prompt, isTest }) => {
      const image = await readPrivatePhoto(upload.pathname, upload.content_type, Number(upload.size_bytes))
      const result = await runAiCall({
        operation: "photo-draft-claims",
        model: AI_MODELS.extraction,
        isTest,
      }, () => generateText({
        model: AI_MODELS.extraction,
        output: Output.object({ schema: photoDraftOutputSchema }),
        system,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image", image, mediaType: upload.content_type },
          ],
        }],
        maxRetries: AI_MAX_RETRIES,
      }))
      if (!result.output) throw new Error("Photo draft extraction returned no structured output.")
      return result.output
    },
    writeClaim: async (claim) => addClaim({
      subjectType: "lead",
      subjectId: claim.leadId,
      predicate: `photo_draft_${claim.kind}`,
      value: {
        kind: claim.kind,
        text: claim.text,
        photoReference: upload.pathname,
      },
      confidence: 0.5,
      sourceEventId: claim.sourceEventId,
      extractedBy: AI_MODELS.extraction,
      itemKey: `photo-draft:${claim.uploadId}:${claim.index}`,
    }),
    finishIntent: async (intentId, outcome) => {
      const result = JSON.stringify(outcome.status === "done" ? { claimIds: outcome.claimIds } : null)
      await sql`
        UPDATE events SET extraction_status = ${outcome.status}::text,
          extraction_result = ${result}::jsonb,
          extraction_last_error = ${outcome.status === "failed" ? outcome.error.slice(0, 500) : ""}::text,
          extraction_next_attempt_at = NULL, processed_at = now()
        WHERE id = ${intentId}::bigint AND kind = 'photo.draft.intent'` 
    },
  })
}

export type PhotoDraftEntry = {
  intent_event_id: number
  extraction_status: string
  claim_id: number | null
  predicate: string | null
  value: unknown
}

export async function listPhotoDraftEntries(leadId: number): Promise<PhotoDraftEntry[]> {
  const sql = getSql()
  return (await sql`
    SELECT intent.id AS intent_event_id, intent.extraction_status,
      draft.id AS claim_id, draft.predicate, draft.value
    FROM events intent
    LEFT JOIN claims draft ON draft.source_event_id = intent.id
      AND draft.superseded_by IS NULL
      AND draft.predicate = ANY(ARRAY[
        'photo_draft_scope', 'photo_draft_material', 'photo_draft_dimension'
      ]::text[])
    WHERE intent.kind = 'photo.draft.intent'
      AND intent.lead_id = ${leadId}::bigint
      AND (intent.extraction_status IN ('pending', 'processing', 'failed') OR draft.id IS NOT NULL)
    ORDER BY intent.occurred_at DESC, draft.created_at ASC`) as PhotoDraftEntry[]
}

export async function getActivePhotoDraft(leadId: number, claimId: number) {
  const sql = getSql()
  const rows = (await sql`
    SELECT draft.id, draft.predicate, draft.value, draft.source_event_id
    FROM claims draft
    JOIN events intent ON intent.id = draft.source_event_id
    WHERE draft.id = ${claimId}::bigint AND draft.subject_type = 'lead'
      AND draft.subject_id = ${leadId}::bigint AND draft.superseded_by IS NULL
      AND draft.predicate = ANY(ARRAY[
        'photo_draft_scope', 'photo_draft_material', 'photo_draft_dimension'
      ]::text[])
      AND intent.kind = 'photo.draft.intent'
    LIMIT 1`) as Array<{ id: number; predicate: string; value: unknown; source_event_id: number }>
  return rows[0] ?? null
}

export async function decidePhotoDraft(input: {
  leadId: number
  claimId: number
  operatorId: number
  isTest: boolean
  decision: "accept" | "reject"
}) {
  const draft = await getActivePhotoDraft(input.leadId, input.claimId)
  if (!draft) throw new Error("That photo detail is no longer awaiting review.")
  return applyPhotoDraftDecision({ ...input, draft }, {
    recordDecisionEvent: async (eventInput) => {
      const externalId = `photo-draft-decision:${eventInput.draftClaimId}`
      const detail = {
        draftClaimId: eventInput.draftClaimId,
        intentEventId: eventInput.intentEventId,
        decision: eventInput.decision,
        isTest: eventInput.isTest,
        sensitivity: "owner-only",
      }
      await recordEvent({
        kind: "photo.draft.decided",
        actorType: "operator",
        actorId: eventInput.operatorId,
        leadId: eventInput.leadId,
        externalId,
        body: `${eventInput.isTest ? "[INTERNAL TEST] " : ""}Photo detail suggestion ${eventInput.decision === "accept" ? "accepted" : "rejected"} by owner.`,
        detail,
      })
      const existing = (await getSql()`
        SELECT id, detail->>'decision' AS decision FROM events
        WHERE kind = 'photo.draft.decided' AND external_id = ${externalId}::text
        LIMIT 1`) as { id: number; decision: string }[]
      return existing[0] ? { id: Number(existing[0].id), decision: existing[0].decision } : null
    },
    addClaim,
    supersedeClaim: supersedeClaimWithExisting,
  })
}
