export type AiUsageRun = {
  job: "ai-usage"
  ok: boolean
  detail: { operation: string; provider: string; model: string; error?: string }
  meta: { usage: unknown; isTest: boolean }
}

export type AiCallOptions = { operation: string; provider?: string; model: string; isTest?: boolean; fallbackUsage?: unknown }

export type AiCallRecord = AiCallOptions & { ok: boolean; usage?: unknown; error?: string }

export const AI_MAX_RETRIES = 2 as const

export async function retryAiRequest<T>(run: () => Promise<T>, shouldRetryResponse: (response: T) => boolean, maxRetries: number = AI_MAX_RETRIES, wait: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) : Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response
    try {
      response = await run()
    } catch (error) {
      if (attempt >= maxRetries) throw error
      await wait(250 * (attempt + 1))
      continue
    }
    if (!shouldRetryResponse(response) || attempt >= maxRetries) return response
    await wait(250 * (attempt + 1))
  }
  throw new Error("AI request retries ended without a response.")
}

export function buildAiUsageRun(input: AiCallRecord) : AiUsageRun {
  const detail = {
    operation: input.operation,
    provider: input.provider || "gateway",
    model: input.model,
    ...(input.error ? { error: input.error.slice(0, 500) } : {}),
  }
  return {
    job: "ai-usage",
    ok: input.ok,
    detail,
    meta: {
      usage: input.usage ?? null,
      isTest: Boolean(input.isTest),
    },
  }
}

export async function runLoggedAiCall<T>(input: AiCallOptions, run: () => Promise<T>, writeUsage: (run: AiUsageRun) => Promise<unknown>, onLoggingError: (error: unknown) => void = () => {}) : Promise<T> {
  const save = async (row: AiCallRecord) => {
    try {
      await writeUsage(buildAiUsageRun(row))
    } catch (error) {
      onLoggingError(error)
    }
  }
  try {
    const result = await run()
    const usage = result && typeof result === "object"
      ? (result as { totalUsage?: unknown; usage?: unknown }).totalUsage ?? (result as { totalUsage?: unknown; usage?: unknown }).usage ?? input.fallbackUsage
      : input.fallbackUsage
    await save({ ...input, ok: true, usage })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await save({ ...input, ok: false, usage: null, error: message })
    throw error
  }
}
