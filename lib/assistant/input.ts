export const ASSISTANT_MAX_MESSAGE = 2000
export const ASSISTANT_MAX_TURNS = 30
export const ASSISTANT_MAX_BODY_BYTES = 12_000

export class AssistantRequestError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export type AssistantInput = {
  session_id: string
  turn_index: number
  message: string
  is_test: boolean
}

export function validateAssistantInput(value: unknown): AssistantInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AssistantRequestError("Send a chat message.")
  const input = value as Record<string, unknown>
  if (typeof input.session_id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.session_id)) {
    throw new AssistantRequestError("Start a new chat and try again.")
  }
  if (!Number.isInteger(input.turn_index) || Number(input.turn_index) < 0 || Number(input.turn_index) >= ASSISTANT_MAX_TURNS) {
    throw new AssistantRequestError("This chat has reached its limit. Please call the shop.")
  }
  if (typeof input.message !== "string" || !input.message.trim()) throw new AssistantRequestError("Type a message first.")
  if (input.message.length > ASSISTANT_MAX_MESSAGE) throw new AssistantRequestError("Keep each message to 2,000 characters or less.", 413)
  if (input.is_test !== undefined && typeof input.is_test !== "boolean") throw new AssistantRequestError("Invalid test flag.")
  return {
    session_id: input.session_id.toLowerCase(),
    turn_index: Number(input.turn_index),
    message: input.message.trim(),
    is_test: input.is_test === true || /\[INTERNAL TEST\]/i.test(input.message) || Boolean(process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production"),
  }
}

// Bound the stream itself; Content-Length alone is not a trusted size limit.
export async function readAssistantInput(request: Request): Promise<AssistantInput> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AssistantRequestError("Send JSON chat messages.", 415)
  }
  const length = Number(request.headers.get("content-length"))
  if (Number.isFinite(length) && length > ASSISTANT_MAX_BODY_BYTES) throw new AssistantRequestError("That message is too long.", 413)
  const reader = request.body?.getReader()
  if (!reader) throw new AssistantRequestError("Send a chat message.")
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let bytes = 0
  let body = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > ASSISTANT_MAX_BODY_BYTES) {
        await reader.cancel()
        throw new AssistantRequestError("That message is too long.", 413)
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    return validateAssistantInput(JSON.parse(body))
  } catch (error) {
    if (error instanceof AssistantRequestError) throw error
    throw new AssistantRequestError("That chat message could not be read.")
  } finally {
    reader.releaseLock()
  }
}
