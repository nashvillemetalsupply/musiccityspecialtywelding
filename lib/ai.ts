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

export async function draftWithDeepSeek(input: { system: string; prompt: string; maxTokens?: number }) {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set.")
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt },
      ],
      max_tokens: input.maxTokens ?? 300,
      stream: false,
    }),
  })
  if (!response.ok) {
    // The body carries DeepSeek's own reason -- out of balance, bad key, unknown
    // model. It is quoted back rather than flattened into "it failed", which is
    // the mistake that cost an afternoon on the gateway's 403.
    const detail = (await response.text().catch(() => "")).slice(0, 300)
    throw new Error(`DeepSeek refused the request (${response.status}). ${detail}`)
  }
  const json = await response.json() as { choices?: { message?: { content?: string } }[] }
  return String(json.choices?.[0]?.message?.content ?? "")
}

// Same DeepSeek path, asked for a JSON object. The gateway's free tier
// rate-limits a burst -- the first call-summary sweep lost 14 of 30 to "Free
// tier requests on this model are rate-limited" -- and the shop already pays
// for this key. The caller validates the object; this only parses it.
export async function jsonWithDeepSeek(input: { system: string; prompt: string; maxTokens?: number }): Promise<unknown> {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set.")
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: input.maxTokens ?? 600,
      stream: false,
    }),
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300)
    throw new Error(`DeepSeek refused the request (${response.status}). ${detail}`)
  }
  const json = await response.json() as { choices?: { message?: { content?: string } }[] }
  const content = String(json.choices?.[0]?.message?.content ?? "").trim()
  if (!content) throw new Error("DeepSeek returned no content.")
  return JSON.parse(content)
}
