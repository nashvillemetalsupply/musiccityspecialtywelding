export async function readWithSchemaFallback<T>({ primary, fallback, fallbackConfigured, parse }: { primary(): Promise<unknown>; fallback(): Promise<unknown>; fallbackConfigured: boolean; parse(value: unknown): T }) : Promise<T> {
  try {
    return parse(await primary())
  } catch (primaryError) {
    if (!fallbackConfigured) throw primaryError
    return parse(await fallback())
  }
}

export async function applyOnlyValidatedSummary<T, R>(read: () => Promise<T>, apply: (summary: T) => Promise<R>) : Promise<T> {
  const summary = await read()
  await apply(summary)
  return summary
}
