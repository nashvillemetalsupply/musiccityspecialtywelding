import type { LockedBuildSheet } from "./build-sheets-domain.mjs"

export function compileBuildPaperwork(input: {
  kind: "drawing" | "dxf"
  sheet: LockedBuildSheet
}): Readonly<{
  kind: "drawing" | "dxf"
  sourceBuildSheetNumber: number
  content: string
  contentType: string
  extension: "svg" | "dxf"
  contentHash: string
}>

export function paperworkIssueDecision(input: {
  kind: string
  status: string
  issueState: string
  sourceBuildSheetNumber: number
  currentBuildSheetNumber: number
  fabricationReady: boolean
}): { allowed: boolean; reason: string }
