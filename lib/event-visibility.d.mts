export const OWNER_ONLY_EVENT_KINDS: readonly string[]
export const OWNER_ONLY_EVENT_NAMESPACE_PATTERN: string
export const OWNER_ONLY_EVENT_SENSITIVITIES: readonly string[]
export function eventIsOwnerOnly(kindValue: unknown, detailValue?: Record<string, unknown> | null): boolean
