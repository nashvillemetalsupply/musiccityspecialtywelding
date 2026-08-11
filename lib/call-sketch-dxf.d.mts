export type GateDxfInput = {
  kind?: "gate" | "frame"
  width: number
  height: number
  stockSize: number
  railCount: number
  hingeSide?: "left" | "right"
  latchSide?: "left" | "right"
  title?: string
}

export function formatShopInches(value: number): string
export function createGateDxf(input: GateDxfInput): string
