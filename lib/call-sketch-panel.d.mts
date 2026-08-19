import type { CallSketchSpec, SketchFact } from "./call-sketch-live.mjs"

export type PanelFactKey = "kind" | "width" | "height" | "stockSize" | "railCount" | "hingeSide" | "latchSide"
export type PanelFactTone = "said" | "ambig" | "none"

export const PANEL_FACT_KEYS: readonly PanelFactKey[]
export const PANEL_FACT_LABELS: Readonly<Record<PanelFactKey, string>>

export function factIsAnswered(fact: SketchFact<unknown> | null | undefined): boolean
export function answeredFactCount(spec: CallSketchSpec | null | undefined): number
export function factTone(fact: SketchFact<unknown> | null | undefined): PanelFactTone
export function factText(key: PanelFactKey, fact: SketchFact<unknown> | null | undefined): string
export function pricingGap(spec: CallSketchSpec | null | undefined): string[]
export function pricingSentence(spec: CallSketchSpec | null | undefined): string
export function sketchAriaLabel(spec: CallSketchSpec | null | undefined): string
export function dimensionMark(fact: SketchFact<number> | null | undefined): string
