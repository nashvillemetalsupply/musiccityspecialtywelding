export const AI_MAX_RETRIES = 2

export async function retryAiRequest(run, shouldRetryResponse, maxRetries = AI_MAX_RETRIES, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
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

export function buildAiUsageRun(input) {
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

export async function runLoggedAiCall(input, run, writeUsage, onLoggingError = () => {}) {
  const save = async (row) => {
    try {
      await writeUsage(buildAiUsageRun(row))
    } catch (error) {
      onLoggingError(error)
    }
  }
  try {
    const result = await run()
    const usage = result && typeof result === "object"
      ? result.totalUsage ?? result.usage ?? input.fallbackUsage
      : input.fallbackUsage
    await save({ ...input, ok: true, usage })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await save({ ...input, ok: false, usage: null, error: message })
    throw error
  }
}
