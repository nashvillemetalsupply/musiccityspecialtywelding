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

// Direct Claude JSON calls use the shop's Anthropic account independently of
// gateway availability. Keep the model choice shared by every direct caller.
export const CLAUDE_MODEL = "claude-haiku-5-5"

export function claudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

type ClaudeInput = { system: string; prompt: string; maxTokens?: number; signal?: AbortSignal; maxRetries?: number; isTest?: boolean; operation?: string; onModelDiagnostics?: (diagnostics: ClaudeModelDiagnostics) => void }

export type ClaudeModelDiagnostics = {
  stop_reason: string | null
  content_block_types: string[]
  usage: Record<string, number> | null
}

export class ClaudeResponseError extends Error {
  readonly modelDiagnostics: ClaudeModelDiagnostics

  constructor(message: string, modelDiagnostics: ClaudeModelDiagnostics) {
    super(message)
    this.name = "ClaudeResponseError"
    this.modelDiagnostics = modelDiagnostics
  }
}

type ClaudeMessage = { content?: { type?: string; text?: unknown }[]; stop_reason?: string; usage?: unknown }

function claudeModelDiagnostics(message: ClaudeMessage): ClaudeModelDiagnostics {
  const stopReasons = ["end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal", "model_context_window_exceeded"]
  const blockTypes = ["text", "thinking", "redacted_thinking", "tool_use", "server_tool_use", "tool_result", "web_search_tool_result", "web_fetch_tool_result", "code_execution_tool_result", "bash_code_execution_tool_result", "text_editor_code_execution_tool_result", "container_upload", "image", "document"]
  const usage: Record<string, number> = {}
  if (message.usage && typeof message.usage === "object") {
    for (const field of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
      const count = (message.usage as Record<string, unknown>)[field]
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) usage[field] = count
    }
  }
  return {
    stop_reason: typeof message.stop_reason === "string" && stopReasons.includes(message.stop_reason) ? message.stop_reason : null,
    content_block_types: Array.isArray(message.content) ? message.content.map((block) => typeof block?.type === "string" && blockTypes.includes(block.type) ? block.type : "unknown") : [],
    usage: Object.keys(usage).length ? usage : null,
  }
}

// Find the first object without mistaking braces inside JSON strings for its
// boundary. Markdown fences and a short prose introduction are harmless here.
function firstJsonObject(content: string): string {
  const start = content.indexOf("{")
  if (start < 0) throw new Error("Missing JSON object")
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < content.length; index++) {
    const character = content[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === "{") depth++
    else if (character === "}" && --depth === 0) return content.slice(start, index + 1)
  }
  throw new Error("Incomplete JSON object")
}

async function postClaude(input: ClaudeInput, responseFormat: "text" | "json") {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.")
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? AI_MAX_RETRIES, 4))
  return runAiCall({ operation: input.operation ?? `claude-${responseFormat}`, provider: "anthropic", model: CLAUDE_MODEL, isTest: input.isTest }, async () => {
    const request = async (maxTokens: number, previousDiagnostics?: ClaudeModelDiagnostics): Promise<ClaudeMessage> => {
      try {
        const response = await retryAiRequest(() => fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: CLAUDE_MODEL,
            system: responseFormat === "json" ? `${input.system}\nReturn only one valid JSON object, without markdown or any other text.` : input.system,
            messages: [{ role: "user", content: input.prompt }],
            max_tokens: maxTokens,
            stream: false,
          }),
          signal: input.signal ?? AbortSignal.timeout(30_000),
        }), (candidate) => !candidate.ok && (candidate.status === 429 || candidate.status >= 500), maxRetries)
        if (!response.ok) throw new ClaudeResponseError(`Claude refused the request (${response.status}).`, claudeModelDiagnostics({}))
        try {
          const message: unknown = await response.json()
          if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid Messages response")
          return message as ClaudeMessage
        } catch {
          throw new ClaudeResponseError("Claude returned an invalid response.", claudeModelDiagnostics({}))
        }
      } catch (error) {
        if (!previousDiagnostics) throw error
        // A failed retry has no replacement response metadata. Retain the
        // truncated response's evidence without copying transport error text.
        const failure = new ClaudeResponseError(error instanceof ClaudeResponseError ? error.message : "Claude request failed.", previousDiagnostics)
        if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) failure.name = error.name
        throw failure
      }
    }
    const maxTokens = input.maxTokens ?? (responseFormat === "json" ? 2000 : 1000)
    let json = await request(maxTokens)
    // A truncated response is never parsed, even if its text happens to contain
    // a complete object. Retry once with room for the full response instead.
    if (json.stop_reason === "max_tokens") json = await request(maxTokens * 2, claudeModelDiagnostics(json))
    const diagnostics = claudeModelDiagnostics(json)
    input.onModelDiagnostics?.(diagnostics)
    if (json.stop_reason !== "end_turn" && json.stop_reason !== "stop_sequence") {
      throw new ClaudeResponseError("Claude did not finish its response.", diagnostics)
    }
    const content = (Array.isArray(json.content) ? json.content : [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text).join("").trim()
    if (!content) throw new ClaudeResponseError("Claude returned no text.", diagnostics)
    let parsed: unknown
    if (responseFormat === "json") {
      try {
        parsed = JSON.parse(firstJsonObject(content))
      } catch {
        // JSON.parse errors can quote the model's answer; keep failure records
        // to protocol metadata and a stable error message instead.
        throw new ClaudeResponseError("Claude returned an invalid JSON object.", diagnostics)
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ClaudeResponseError("Claude returned an invalid JSON object.", diagnostics)
      }
    }
    return { content, parsed, usage: json.usage ?? null }
  })
}

export async function draftWithClaude(input: ClaudeInput): Promise<string> {
  const result = await postClaude(input, "text")
  return result.content
}

export async function jsonWithClaude(input: ClaudeInput): Promise<unknown> {
  const result = await postClaude(input, "json")
  return result.parsed
}
