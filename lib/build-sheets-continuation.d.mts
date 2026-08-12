import type { LockedBuildSheet } from "./build-sheets-domain.mjs"

export type BuildDrawingProjection = {
  sourceBuildSheetNumber: number
  width: number
  height: number
  stockSize: number
  railCount: number
  hingeSide: string
  latchSide: string
  fabricationReady: boolean
}

export type CustomerBuildFact = {
  claimId: number
  factKey: string
  label: string
  value: string
  reference: string
  state: "customer-confirmed" | "customer-correction-proposed" | "shop-confirmed" | "working-number"
  respondedAt: string | null
}

export type CustomerBuildDrawingProjection = Omit<BuildDrawingProjection, "fabricationReady">

export function projectBuildDrawing(sheet: LockedBuildSheet): BuildDrawingProjection

export function createCustomerBuildProjection(input: {
  sheet: LockedBuildSheet
  customerConfirmations?: Array<{
    claimId: number
    state: "accepted" | "corrected"
    respondedAt?: string
  }>
}): {
  buildSheetNumber: number
  lockedAt: string
  scope: string
  drawing: CustomerBuildDrawingProjection | null
  facts: CustomerBuildFact[]
}

export function createCrewBuildProjection(input: {
  sheet: LockedBuildSheet
  paperwork?: Array<{
    id: number
    label: string
    status: string
    issueState: string
    sourceBuildSheetNumber: number
  }>
}): {
  buildSheetNumber: number
  lockedAt: string
  drawing: BuildDrawingProjection
  facts: Array<Omit<CustomerBuildFact, "respondedAt">>
  paperwork: Array<{ id: number; label: string; sourceBuildSheetNumber: number }>
}

export function buildClarificationForSketch(spec?: {
  width?: { value?: number | null; evidence?: string | null }
}): null | { question: string; reason: string }
