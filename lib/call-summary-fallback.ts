export async function readWithSchemaFallback({ primary, fallback, fallbackConfigured, parse }) {
  try {
    return parse(await primary())
  } catch (primaryError) {
    if (!fallbackConfigured) throw primaryError
    return parse(await fallback())
  }
}

export async function applyOnlyValidatedSummary(read, apply) {
  const summary = await read()
  await apply(summary)
  return summary
}
