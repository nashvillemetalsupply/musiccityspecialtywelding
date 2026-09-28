import { getSql } from "@/lib/db"
import { AI_MAX_RETRIES, buildAiUsageRun, retryAiRequest, runLoggedAiCall, type AiCallOptions, type AiCallRecord, type AiUsageRun } from "@/lib/ai-usage.ts"

export { AI_MAX_RETRIES }

async function persistAiUsageRun(row: AiUsageRun): Promise<void> {
  try {
    const sql = getSql()
    await sql`
      INSERT INTO automation_runs (job, ok, detail, meta)
      VALUES (${row.job}::text, ${row.ok}::boolean, ${JSON.stringify(row.detail)}::jsonb, ${JSON.stringify(row.meta)}::jsonb)`
  } catch (error) {
    console.error("AI usage logging failed:", error)
  }
}

export async function recordAiUsage(input: AiCallRecord): Promise<void> {
  return persistAiUsageRun(buildAiUsageRun(input))
}

export async function runAiCall<T>(input: Omit<AiCallOptions, "ok" | "usage" | "error">, run: () => Promise<T>): Promise<T> {
  return runLoggedAiCall(input, run, persistAiUsageRun)
}

export const AI_MODELS = {
  extraction: process.env.AI_EXTRACTION_MODEL?.trim() || "anthropic/claude-haiku-4.5",
  reasoning: process.env.AI_REASONING_MODEL?.trim() || "anthropic/claude-sonnet-5",
  speech: process.env.AI_SPEECH_MODEL?.trim() || "openai/tts-1",
} as const

export function aiConfigured() {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() ||
    process.env.VERCEL_OIDC_TOKEN?.trim() ||
    process.env.VERCEL === "1"
  )
}

// The gateway refuses every paid model on the shop's plan -- "Free tier users do
// not have access to this model", which is what killed the first voice preview.
// The shop already pays DeepSeek for its own key, and DeepSeek speaks the OpenAI
// chat format, so one fetch reaches it: no provider package, no second billing
// relationship, and no Vercel credit. The gateway stays the path for everything
// that needs tools, streaming or structured output; this is for plain drafting.
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat"

export function deepseekConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim())
}

async function postDeepSeek(input: { system: string; prompt: string; maxTokens?: number; signal?: AbortSignal; maxRetries?: number; operation: string; isTest?: boolean }, responseFormat: "text" | "json") {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set.")
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? AI_MAX_RETRIES, 4))
  return runAiCall({ operation: input.operation, provider: "deepseek", model: DEEPSEEK_MODEL, isTest: input.isTest }, async () => {
    const response = await retryAiRequest(() => fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
        ...(responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
        max_tokens: input.maxTokens ?? (responseFormat === "json" ? 600 : 300),
        stream: false,
      }),
      signal: input.signal ?? AbortSignal.timeout(30_000),
    }), (candidate) => !candidate.ok && (candidate.status === 429 || candidate.status >= 500), maxRetries)
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300)
      throw new Error(`DeepSeek refused the request (${response.status}). ${detail}`)
    }
    const json = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: unknown }
    const content = String(json.choices?.[0]?.message?.content ?? "").trim()
    if (!content) throw new Error("DeepSeek returned no content.")
    return { content, parsed: responseFormat === "json" ? JSON.parse(content) : undefined, usage: json.usage ?? null }
  })
}

export async function draftWithDeepSeek(input: { system: string; prompt: string; maxTokens?: number; signal?: AbortSignal; maxRetries?: number; isTest?: boolean; operation?: string }) {
  const result = await postDeepSeek({ ...input, operation: input.operation ?? "deepseek-draft" }, "text")
  return result.content
}

export async function jsonWithDeepSeek(input: { system: string; prompt: string; maxTokens?: number; signal?: AbortSignal; maxRetries?: number; isTest?: boolean; operation?: string }): Promise<unknown> {
  const result = await postDeepSeek({ ...input, operation: input.operation ?? "deepseek-json" }, "json")
  return result.parsed
}
