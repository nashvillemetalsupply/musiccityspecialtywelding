export type CloseoutReview = {
  completion: "complete" | "partial"
  fit: "fit" | "adjusted" | "not-checked"
  extraTrips: number
  rework: "yes" | "no"
  asBuiltDifferences: string
  remainingWork: string
  sourceWords: string
  reviewed: boolean
}

export function deriveCloseoutDraft(sourceWords: string): Readonly<CloseoutReview>
export function validateCloseoutReview(review: CloseoutReview): Readonly<CloseoutReview & { reviewed: true }>
