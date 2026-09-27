export const AI_MAX_RETRIES: 2
export type AiUsageRun = {
  job: "ai-usage"
  ok: boolean
  detail: { operation: string; provider: string; model: string; error?: string }
  meta: { usage: unknown; isTest: boolean }
}
export type AiCallOptions = { operation: string; provider?: string; model: string; isTest?: boolean; fallbackUsage?: unknown }
export type AiCallRecord = AiCallOptions & { ok: boolean; usage?: unknown; error?: string }
export function buildAiUsageRun(input: AiCallRecord): AiUsageRun
export function runLoggedAiCall<T>(input: AiCallOptions, run: () => Promise<T>, writeUsage: (run: AiUsageRun) => Promise<unknown>, onLoggingError?: (error: unknown) => void): Promise<T>
