import { z } from "zod"

// Kept free of "@/" imports so node:test can load it directly.

/** Stored cap on facts per extraction. Also stated to the model in the schema description. */
export const EXTRACTION_FACT_LIMIT = 12

// No `.max` on facts, deliberately. A validated `.max(12)` made the AI SDK
// reject the whole response when the model returned 13 (seven of them exact
// duplicates), so the event lost every commitment and fact and was retried
// until it died. The limit is a hint to the model here and enforced in
// sanitizeExtraction after parse.
//
// due_at_iso stays a plain nullable string for the same reason: a zod
// transform or refinement would either change the JSON schema sent to the
// model or fail the parse. normalizeDueAt nulls a bad value after parse.
export const extractionSchema = z.object({
  crew_safe_body: z.string().max(30000),
  commitments: z.array(z.object({
    direction: z.enum(["we_promised", "they_promised"]),
    summary: z.string().max(300),
    due_at_iso: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    crew_safe_summary: z.string().max(300),
    matches_existing_commitment_id: z.number().int().positive().nullable(),
    marks_existing_as: z.enum(["kept", "superseded"]).nullable(),
  })).max(8),
  facts: z.array(z.object({ predicate: z.string().max(80), value: z.unknown(), confidence: z.number().min(0).max(1), supersedes_claim_id: z.number().int().positive().nullable() }))
    .describe(`At most ${EXTRACTION_FACT_LIMIT} facts. Never repeat a fact with the same predicate and value.`),
  auto_reply_type: z.enum(["none", "temporary_ooo", "contact_departed"]),
  customer_update: z.object({
    display_name: z.string().max(120).nullable(),
    company: z.string().max(160).nullable(),
    service: z.string().max(180).nullable(),
    confidence: z.number().min(0).max(1),
  }).nullable(),
  glass_caption_draft: z.string().max(180).nullable(),
  contact_churn: z.object({
    left_name: z.string(),
    successors: z.array(z.object({ name: z.string(), email: z.string().optional(), phone: z.string().optional() })),
    evidence: z.string().max(500),
    confidence: z.number().min(0).max(1),
  }).nullable(),
  urgency: z.enum(["interrupt", "normal"]).nullable(),
})

export type Extraction = z.infer<typeof extractionSchema>

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i

/**
 * A due date Postgres will accept as timestamptz, or null.
 *
 * The model once returned `2026-09-28T26:28:37.371Z`. Postgres refused it
 * (22008), the INSERT threw, and the whole extraction was lost. Every field is
 * range-checked against the calendar rather than trusted to Date.parse, which
 * rolls `02-30` over into March instead of refusing it. A valid value is
 * returned unchanged so existing promises keep their exact due instant.
 */
export function normalizeDueAt(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  const match = ISO_INSTANT.exec(text)
  if (!match) return null
  const [, y, mo, d, h = "0", mi = "0", s = "0", zone] = match
  const year = Number(y), month = Number(mo), day = Number(d)
  const hour = Number(h), minute = Number(mi), second = Number(s)
  if (year < 1 || month < 1 || month > 12 || day < 1) return null
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  if (zone && zone.toUpperCase() !== "Z") {
    const digits = zone.slice(1).replace(":", "")
    const offsetHours = Number(digits.slice(0, 2))
    const offsetMinutes = digits.length > 2 ? Number(digits.slice(2)) : 0
    if (offsetHours > 14 || offsetMinutes > 59) return null
  }
  return text
}

/**
 * Makes a schema-valid extraction safe to apply: bad due dates become null
 * (the promise is kept, undated), duplicate facts (same predicate and same
 * JSON value) are dropped, and the list is capped at EXTRACTION_FACT_LIMIT.
 * Runs on fresh model output and on a stored extraction_result alike.
 */
export function sanitizeExtraction(input: Extraction): Extraction {
  const seen = new Set<string>()
  const facts = input.facts.filter((fact) => {
    const key = JSON.stringify([fact.predicate, fact.value ?? null])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, EXTRACTION_FACT_LIMIT)
  const commitments = input.commitments.map((item) => ({ ...item, due_at_iso: normalizeDueAt(item.due_at_iso) }))
  return { ...input, commitments, facts }
}
