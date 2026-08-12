import type { BuildClaim, LockedBuildSheet } from "./build-sheets-domain.mjs"

type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<unknown>

export function persistObservedBuildFacts(input: {
  sql: SqlTag
  leadId: number
  callSid: string
  sourceEventId: number
  facts: Array<{ fact: Omit<BuildClaim, "id" | "sourceEventId">; itemKey: string }>
}): Promise<number[]>

export function persistLockedBuildSheet(input: {
  sql: SqlTag
  leadId: number
  operatorId: number
  lockKey: string
  candidate: LockedBuildSheet
}): Promise<{
  inserted: boolean
  sheet: { id: number; sequence: number; snapshot: LockedBuildSheet; locked_at: string }
}>
