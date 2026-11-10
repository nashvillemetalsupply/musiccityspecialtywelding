import { stripAssistantMoney } from "./money.ts"

export const CHAT_STORAGE_KEY = "mcsw-assistant-chat-v1"
export const CHAT_MESSAGE_LIMIT = 2000
export const CHAT_TURN_LIMIT = 30

type ChatMessage = { role: "user" | "assistant"; content: string }
export type ChatSession = {
  id: string
  nextTurn: number
  messages: ChatMessage[]
  pending: string | null
  leadSaved: boolean
}

type ChatStorage = Pick<Storage, "getItem" | "setItem">
// Match the public API's v4 session identity, including after browser restore.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function newChatSession(id: string): ChatSession {
  return { id, nextTurn: 0, messages: [], pending: null, leadSaved: false }
}

export function readChatSession(storage: ChatStorage | null, makeId: () => string): ChatSession {
  try {
    const raw = storage?.getItem(CHAT_STORAGE_KEY)
    if (raw && raw.length <= 140_000) {
      const value = JSON.parse(raw) as ChatSession
      if (SESSION_ID.test(value.id) && Number.isInteger(value.nextTurn)
        && value.nextTurn >= 0 && value.nextTurn <= CHAT_TURN_LIMIT
        && Array.isArray(value.messages) && value.messages.length === value.nextTurn * 2
        && value.messages.every((item, index) => item
          && item.role === (index % 2 === 0 ? "user" : "assistant")
          && typeof item.content === "string" && item.content.length <= CHAT_MESSAGE_LIMIT
          && stripAssistantMoney(item.content).length <= CHAT_MESSAGE_LIMIT)
        && (value.pending === null || (typeof value.pending === "string"
          && value.pending.length > 0 && value.pending.length <= CHAT_MESSAGE_LIMIT
          && stripAssistantMoney(value.pending).length > 0
          && stripAssistantMoney(value.pending).length <= CHAT_MESSAGE_LIMIT))) {
        return {
          id: value.id,
          nextTurn: value.nextTurn,
          messages: value.messages.map((item) => ({ ...item, content: stripAssistantMoney(item.content) })),
          pending: value.pending === null ? null : stripAssistantMoney(value.pending),
          leadSaved: value.leadSaved === true,
        }
      }
    }
  } catch {
    // Private browsing and disabled storage still allow an in-memory chat.
  }
  return newChatSession(makeId())
}

export function writeChatSession(storage: ChatStorage | null, session: ChatSession): void {
  try {
    storage?.setItem(CHAT_STORAGE_KEY, JSON.stringify({
      ...session,
      messages: session.messages.map((item) => ({ ...item, content: stripAssistantMoney(item.content) })),
      pending: session.pending === null ? null : stripAssistantMoney(session.pending),
    }))
  } catch {
    // Keep the same request identity in memory when browser storage is full.
  }
}

export function prepareChatRequest(session: ChatSession, draft: string) {
  if (session.nextTurn >= CHAT_TURN_LIMIT) throw new Error("Please call the shop to keep going.")
  const message = session.pending ?? draft.trim()
  if (!message || message.length > CHAT_MESSAGE_LIMIT) throw new Error("Use 1 to 2,000 characters per message.")
  const cleanMessage = stripAssistantMoney(message)
  if (cleanMessage.length > CHAT_MESSAGE_LIMIT) throw new Error("Use 1 to 2,000 characters per message.")
  const nextSession = { ...session, pending: cleanMessage }
  return {
    session: nextSession,
    payload: { session_id: session.id, turn_index: session.nextTurn, message: nextSession.pending },
  }
}

export function acceptChatReply(session: ChatSession, reply: string, leadSaved: boolean): ChatSession {
  if (session.pending === null) throw new Error("There is no pending message.")
  if (!reply.trim() || reply.length > CHAT_MESSAGE_LIMIT) throw new Error("The reply could not be read. Retry your message or call the shop.")
  return {
    ...session,
    nextTurn: session.nextTurn + 1,
    messages: [...session.messages,
      { role: "user", content: session.pending },
      { role: "assistant", content: stripAssistantMoney(reply) },
    ],
    pending: null,
    leadSaved: session.leadSaved || leadSaved,
  }
}
