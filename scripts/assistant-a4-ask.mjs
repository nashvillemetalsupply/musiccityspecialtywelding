import assert from "node:assert/strict"

const usageFields = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
const stopReasons = new Set(["end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal", "model_context_window_exceeded"])
const blockTypes = new Set(["text", "thinking", "redacted_thinking", "tool_use", "server_tool_use", "web_search_tool_result", "web_fetch_tool_result", "code_execution_tool_result", "mcp_tool_use", "mcp_tool_result", "container_upload", "unknown"])
const handoffReasons = new Set(["human", "unknown", "model-error", "rate-limit"])
const branches = new Set(["model-answer", "unknown-capability-intake", "contact-handoff", "promise-guard-intake", "non-job-close",
  "expert-scope-intake", "expert-safety-intake", "expert-claim-intake", "model-error", "service-handoff"])

export function parseA4Args(args) {
  const options = { dry: false, preflight: false, envFile: null, asks: [] }
  const invalid = () => new Error("Use one environment file (positional or --env), optional repeated --ask messages, and either --dry or --preflight")
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--dry") options.dry = true
    else if (arg === "--preflight") options.preflight = true
    else if (arg === "--ask" || arg === "--env") {
      const value = args[++i]
      if (typeof value !== "string" || !value.trim() || value.startsWith("--")) throw invalid()
      if (arg === "--ask") options.asks.push(value)
      else {
        if (options.envFile) throw invalid()
        options.envFile = value
      }
    } else {
      if (arg.startsWith("--") || options.envFile) throw invalid()
      options.envFile = arg
    }
  }
  if (options.dry && options.preflight || options.preflight && options.asks.length) throw invalid()
  return options
}

// Provider metadata never crosses this output boundary verbatim. Only protocol
// enums and explicitly named numeric token counts are printable.
export function safeModelDiagnostics(value) {
  if (!value || typeof value !== "object") return null
  const usage = Object.fromEntries(usageFields
    .filter((key) => typeof value.usage?.[key] === "number" && Number.isFinite(value.usage[key]) && value.usage[key] >= 0)
    .map((key) => [key, value.usage[key]]))
  return {
    stop_reason: stopReasons.has(value.stop_reason) ? value.stop_reason : null,
    content_block_types: Array.isArray(value.content_block_types)
      ? value.content_block_types.map((type) => blockTypes.has(type) ? type : "unknown") : [],
    usage: Object.keys(usage).length ? usage : null,
  }
}

export async function runAskConversation({ messages, sessionId, postTurn, readTurn, onTurn, redact = String }) {
  const turns = []
  for (const [index, text] of messages.entries()) {
    const message = /^\s*\[INTERNAL TEST\]/i.test(text) ? text : `[INTERNAL TEST] ${text}`
    const response = await postTurn({ session_id: sessionId, turn_index: index, message })
    assert.equal(response.ok, true, "ask route must succeed")
    assert.equal(typeof response.reply, "string", "ask reply must be text")
    const stored = await readTurn(sessionId, index)
    const result = {
      turn: index + 1,
      reply: redact(response.reply),
      handoff_reason: handoffReasons.has(response.handoff_reason) ? response.handoff_reason : null,
      branch: branches.has(stored?.branch) ? stored.branch : null,
      model_diagnostics: safeModelDiagnostics(stored?.model_diagnostics),
    }
    turns.push(result)
    await onTurn(result)
  }
  return turns
}
