export type ClaudeModelDiagnostics = {
  stop_reason: string | null
  content_block_types: string[]
  usage: Record<string, number> | null
}

export type ClaudeRequestDiagnostics = { http_status: number | null; attempt_count: number }

export class ClaudeResponseError extends Error {
  readonly modelDiagnostics: ClaudeModelDiagnostics

  constructor(message: string, modelDiagnostics: ClaudeModelDiagnostics) {
    super(message)
    this.name = "ClaudeResponseError"
    this.modelDiagnostics = modelDiagnostics
  }
}

// Keep transport metadata out of serialized errors, and preserve the identity
// of caller aborts (including errors that cannot be extended).
const requests = new WeakMap<object, ClaudeRequestDiagnostics>()

export function recordClaudeRequestDiagnostics(error: unknown, diagnostics: ClaudeRequestDiagnostics): void {
  if (error && typeof error === "object") requests.set(error, { ...diagnostics })
}

export function assistantModelErrorDiagnostics(error: unknown, elapsedMs: number) {
  const failure = error && typeof error === "object" ? error as Record<string, unknown> : {}
  const request = requests.get(failure)
  const model = failure.modelDiagnostics && typeof failure.modelDiagnostics === "object" ? failure.modelDiagnostics as Record<string, unknown> : {}
  const names = ["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "ClaudeResponseError"]
  const reasons = ["end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal", "model_context_window_exceeded"]
  const messages = ["ANTHROPIC_API_KEY is not set.", "Claude returned an invalid response.", "Claude request failed.", "Claude did not finish its response.", "Claude returned no text.", "Claude returned an invalid JSON object."]
  // Even a forged/mutated error cannot turn this diagnostic into a text sink.
  const message = error instanceof ClaudeResponseError && (messages.includes(error.message) || /^Claude refused the request \([1-5]\d{2}\)\.$/.test(error.message)) ? error.message : null
  return {
    name: typeof failure.name === "string" && names.includes(failure.name) ? failure.name : "Error",
    message,
    http_status: request && Number.isInteger(request.http_status) && request.http_status! >= 100 && request.http_status! <= 599 ? request.http_status : null,
    elapsed_ms: Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : 0,
    attempt_count: request && Number.isInteger(request.attempt_count) && request.attempt_count >= 0 ? request.attempt_count : 0,
    stop_reason: typeof model.stop_reason === "string" && reasons.includes(model.stop_reason) ? model.stop_reason : null,
  }
}
