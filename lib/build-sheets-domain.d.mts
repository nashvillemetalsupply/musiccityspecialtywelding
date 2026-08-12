export type BuildClaim = {
  id: number
  sourceEventId: number
  factKey: string
  subject: string
  property: string
  value: number | string
  unit: string
  reference: string
  original: string
  speaker: string
  certainty: "stated" | "interpreted" | "corrected"
  critical: boolean
  interpretationGroup?: string
}

export type BuildDecision = {
  id?: number
  claimId: number
  state: "proposed" | "shop-confirmed" | "working-number" | "rejected" | "superseded"
  decidedAt?: string
}

export type BuildConflict = {
  key: string
  kind: "unresolved-reference" | "different-values"
  claimIds: number[]
}

export function deriveBuildDraft(input?: {
  claims?: BuildClaim[]
  decisions?: BuildDecision[]
}): {
  claims: BuildClaim[]
  decisions: BuildDecision[]
  conflicts: BuildConflict[]
  recommendedQuestion: null | { question: string; reason: string }
  factRows: Array<(BuildClaim & {
    label: string
    state: "heard-on-call" | "confirmed" | "working-number"
  }) | {
    factKey: string
    label: string
    state: "still-need"
    critical: boolean
  }>
  fabrication: { ready: boolean; blockers: string[] }
}

export function applyBuildDecision(
  state: { claims: BuildClaim[]; decisions: BuildDecision[] },
  command: {
    kind: "confirm" | "working" | "reject"
    claimId: number
    actorId: number
    purpose?: string
    decidedAt?: string
  },
): {
  newDecisions: Array<BuildDecision & { actorId: number; purpose: string; decidedAt: string }>
  draft: ReturnType<typeof deriveBuildDraft>
}

export type LockedBuildSheet = Readonly<{
  jobId: number
  number: number
  idempotencyKey: string
  lockedAt: string
  facts: ReadonlyArray<BuildClaim & { decisionState: "shop-confirmed" | "working-number" }>
  fabrication: Readonly<{ ready: boolean; blockers: ReadonlyArray<string> }>
}>

export function lockBuildSheet(input: {
  jobId: number
  sequence: number
  idempotencyKey: string
  lockedAt?: string
  claims: BuildClaim[]
  decisions: BuildDecision[]
}): LockedBuildSheet

export type PaperworkManifest = {
  id: number
  kind: string
  sourceBuildSheetNumber: number
  dependencies: string[]
}

export function classifyPaperwork(input: {
  manifests: PaperworkManifest[]
  sourceSheet: Pick<LockedBuildSheet, "number" | "facts">
  draft?: ReturnType<typeof deriveBuildDraft>
  releasedSheet?: Pick<LockedBuildSheet, "number" | "facts"> | null
}): Array<PaperworkManifest & {
  validForSource: true
  status: "current" | "hold" | "old-numbers" | "needs-update"
  reason: string
}>
