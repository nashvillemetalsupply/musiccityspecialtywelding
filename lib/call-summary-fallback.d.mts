export function readWithSchemaFallback<T>(input: { primary(): Promise<unknown>; fallback(): Promise<unknown>; fallbackConfigured: boolean; parse(value: unknown): T }): Promise<T>
export function applyOnlyValidatedSummary<T, R>(read: () => Promise<T>, apply: (summary: T) => Promise<R>): Promise<T>
