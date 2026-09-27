export type DeliveryErrorRow = { occurred_at: string; title: string; error: string; is_test: boolean }
export type RecentDeliveryError = { at: string; title: string; error: string }
export function normalizeRecentDeliveryErrors(rows: DeliveryErrorRow[], nowMs?: number): RecentDeliveryError[]
