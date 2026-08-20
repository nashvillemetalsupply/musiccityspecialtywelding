export type ParsedLineItem = {
  label: string
  note: string
  amountCents: number
}

export const MAX_LINE_ITEMS: number

export function parseLineItemsText(text: string | null | undefined): {
  items: ParsedLineItem[]
  errors: string[]
}
export function formatLineItemsText(items: readonly ParsedLineItem[] | null | undefined): string
export function lineItemsTotalCents(items: readonly ParsedLineItem[] | null | undefined): number
