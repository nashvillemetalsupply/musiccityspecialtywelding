import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { generateText, Output } from "ai"
import { MockLanguageModelV3 } from "ai/test"
import { EXTRACTION_FACT_LIMIT, extractionSchema, normalizeDueAt, sanitizeExtraction } from "../lib/extraction-schema.ts"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")

function commitment(due_at_iso) {
  return { direction: "we_promised", summary: "Call back with the rail quote", due_at_iso, confidence: 0.9, crew_safe_summary: "Call back", matches_existing_commitment_id: null, marks_existing_as: null }
}

function extraction(overrides = {}) {
  return {
    crew_safe_body: "Customer wants a handrail.",
    commitments: [],
    facts: [],
    auto_reply_type: "none",
    customer_update: null,
    glass_caption_draft: null,
    contact_churn: null,
    urgency: null,
    ...overrides,
  }
}

function fact(predicate, value) {
  return { predicate, value, confidence: 0.9, supersedes_claim_id: null }
}

// Drive the response through the real AI SDK structured-output path, the way
// processEvent does, so a schema that rejects the response fails here exactly
// as it failed in production (AI_NoObjectGeneratedError).
async function generateExtraction(response) {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(response) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  })
  const result = await generateText({ model, output: Output.object({ schema: extractionSchema }), prompt: "extract" })
  return sanitizeExtraction(result.output)
}

// Production, event 2164: the model returned hour 26 and Postgres refused it
// (22008), losing the whole extraction on every retry.
test("an impossible model due date becomes null and the promise is kept", async () => {
  const output = await generateExtraction(extraction({ commitments: [commitment("2026-09-28T26:28:37.371Z")] }))
  assert.equal(output.commitments.length, 1)
  assert.equal(output.commitments[0].due_at_iso, null)
  assert.equal(output.commitments[0].summary, "Call back with the rail quote")
})

test("a stored extraction_result with a bad due date is sanitized on retry", () => {
  const stored = extractionSchema.parse(extraction({ commitments: [commitment("2026-09-28T26:28:37.371Z"), commitment("2026-10-06T15:00:00-05:00")] }))
  const output = sanitizeExtraction(stored)
  assert.deepEqual(output.commitments.map((item) => item.due_at_iso), [null, "2026-10-06T15:00:00-05:00"])
})

test("normalizeDueAt keeps only values Postgres accepts as timestamptz", () => {
  for (const good of ["2026-09-28T16:28:37.371Z", "2026-10-06T15:00:00-05:00", "2026-10-06", "2028-02-29T09:00:00Z", "2026-10-06T15:00Z", "2026-10-06 15:00:00+0530"]) {
    assert.equal(normalizeDueAt(good), good, good)
  }
  for (const bad of ["2026-09-28T26:28:37.371Z", "2026-02-30T10:00:00Z", "2027-02-29", "2026-13-01", "2026-10-06T12:60:00Z", "2026-10-06T23:59:60Z", "2026-10-06T10:00:00+25:00", "tomorrow", "", "  ", null, undefined, 1730000000000]) {
    assert.equal(normalizeDueAt(bad), null, String(bad))
  }
})

// Production, event 2470: gemini-2.5-flash-lite returned 13 facts, 7 of them
// exact duplicates, and `.max(12)` rejected the entire response.
test("an over-limit fact list with duplicates still produces an extraction", async () => {
  const facts = [
    ...Array.from({ length: 7 }, () => fact("material", "aluminum")),
    fact("quoted_price_cents", 45000),
    fact("rail_length_ft", 12),
    fact("finish", { color: "black", type: "powder" }),
    fact("finish", { color: "black", type: "powder" }),
    fact("site", "front porch"),
    fact("stairs", 4),
  ]
  assert.equal(facts.length, 13)
  const output = await generateExtraction(extraction({ facts }))
  assert.deepEqual(output.facts.map((item) => item.predicate), ["material", "quoted_price_cents", "rail_length_ft", "finish", "site", "stairs"])
})

test("unique facts beyond the limit are capped, not rejected", async () => {
  const facts = Array.from({ length: 20 }, (_, index) => fact(`fact_${index}`, index))
  const output = await generateExtraction(extraction({ facts }))
  assert.equal(EXTRACTION_FACT_LIMIT, 12)
  assert.equal(output.facts.length, 12)
  assert.equal(output.facts[11].predicate, "fact_11")
})

test("the facts limit reaches the model as a hint, not a validator", () => {
  const facts = extractionSchema.shape.facts
  assert.match(facts.description ?? "", /At most 12 facts/)
  assert.equal(facts.safeParse(Array.from({ length: 13 }, (_, index) => fact(`f${index}`, index))).success, true)
})

test("every commitment write and every extraction path goes through the sanitizer", () => {
  const extract = source("lib/extract.ts")
  assert.match(extract, /object = sanitizeExtraction\(extractionSchema\.parse\(event\.extraction_result\)\)/)
  assert.match(extract, /object = sanitizeExtraction\(result\.output\)/)
  assert.doesNotMatch(extract, /const extractionSchema = z\.object/)
  const commitments = source("lib/commitments.ts")
  const add = commitments.slice(commitments.indexOf("export async function addCommitment"), commitments.indexOf("export async function listCommitments"))
  assert.match(add, /input = \{ \.\.\.input, dueAt: normalizeDueAt\(input\.dueAt\) \}/)
  assert.ok(add.indexOf("normalizeDueAt(") < add.indexOf("SELECT id FROM commitments"), "the due date is normalized before any SQL")
})

// Production, daily since 2026-08-14: the brief asked for anthropic/claude-sonnet-5,
// which the gateway refuses on the free tier, so the prose always fell back.
test("the morning brief uses the same model setting as extraction", () => {
  const brief = source("app/api/ops/brief/route.ts")
  assert.match(brief, /runAiCall\(\{ operation: "morning-brief-copy", model: AI_MODELS\.extraction \}, \(\) => generateText\(\{ model: AI_MODELS\.extraction,/)
  assert.match(brief, /briefModel = AI_MODELS\.extraction/)
  assert.doesNotMatch(brief, /AI_MODELS\.reasoning/)
  assert.match(brief, /console\.error\("Morning brief AI prose failed; using deterministic copy:"/)
})
