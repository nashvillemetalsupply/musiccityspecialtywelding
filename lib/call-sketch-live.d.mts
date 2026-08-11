export type SketchTruth = "unknown" | "uncertain" | "stated" | "confirmed"
export type SketchFact<T> = {
  value: T | null
  truth: SketchTruth
  evidence: string
  track: string
  sequenceId: number | null
}
export type CallSketchSpec = {
  version: 1
  kind: SketchFact<"gate" | "frame">
  width: SketchFact<number>
  height: SketchFact<number>
  stockSize: SketchFact<number>
  railCount: SketchFact<number>
  hingeSide: SketchFact<"left" | "right">
  latchSide: SketchFact<"left" | "right">
  swing: SketchFact<string>
  material: SketchFact<string>
  nextQuestion: string
  readyForReview: boolean
}
export type CallSketchUtterance = {
  transcript: string
  track?: string
  sequenceId?: number | null
}
export function emptyCallSketchSpec(): CallSketchSpec
export function deriveCallSketch(utterances?: CallSketchUtterance[]): CallSketchSpec
export function confirmedCallSketch(input: {
  kind?: "gate" | "frame"
  width: number
  height: number
  stockSize: number
  railCount?: number
  hingeSide?: "left" | "right"
  latchSide?: "left" | "right"
  swing?: string
  material?: string
}, evidence?: string): CallSketchSpec
