import type { OperatorRole } from "./operators"

export type OpsPulse = {
  eventId: string | null
  eventsSignature: string | null
  callsUpdatedAt: string | null
  callsSignature: string | null
  callSketchesUpdatedAt: string | null
  callSketchesSignature: string | null
  callTranscriptSignature: string | null
  callDraftsSignature: string | null
  unreadNotifications: number
  notificationsSignature: string | null
}

export function readOpsPulse(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>,
  role: OperatorRole,
  operatorId?: number | null,
): Promise<OpsPulse>

export function createOpsPulseGetHandler(input: {
  getOperator: () => Promise<{ id?: number; role: string } | null>
  getSql: () => (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
}): () => Promise<Response>
