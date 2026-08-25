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

export function hasDrawing(spec: CallSketchSpec | null | undefined): boolean

export type SketchGeometry = {
  isGate: boolean
  hasDrawing: boolean
  outlineUncertain: boolean
  x: number
  y: number
  w: number
  h: number
  stroke: number
  rails: number[]
  railsStated: boolean
  hinge: { x: number; ys: number[]; r: number } | null
  latch: { x: number; y: number; size: number } | null
  widthDim: string
  heightDim: string
  widthText: { x: number; y: number }
  heightText: { x: number; y: number }
  stockText: { x: number; y: number }
}

export function sketchGeometry(spec: CallSketchSpec | null | undefined): SketchGeometry
