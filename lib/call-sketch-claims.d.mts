import type { CallSketchSpec } from "./call-sketch-live.mjs"

export type ExtractedClaim = { predicate: string; value: unknown }

export function sketchValuesFromClaims(rows: ExtractedClaim[] | null | undefined): {
  values: Partial<Record<"kind" | "width" | "height" | "stockSize" | "railCount" | "hingeSide" | "latchSide" | "swing" | "material", string | number>>
  evidence: Record<string, string>
}

export function mergeClaimFacts(spec: CallSketchSpec, rows: ExtractedClaim[] | null | undefined): CallSketchSpec
