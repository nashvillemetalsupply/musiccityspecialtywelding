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
