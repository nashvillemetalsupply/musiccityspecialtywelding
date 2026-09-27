import type { OperatorRole } from "./operators"

export type OpsPulse = {
  eventId: string | null
  callsUpdatedAt: string | null
}

export function readOpsPulse(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>,
  role: OperatorRole,
): Promise<OpsPulse>

export function createOpsPulseGetHandler(input: {
  getOperator: () => Promise<{ role: string } | null>
  getSql: () => (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
}): () => Promise<Response>
