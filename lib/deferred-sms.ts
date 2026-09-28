/** A provider handoff happens only when the durable conditional claim returned a row. */
export async function sendIfClaimed<T>(claim: () => Promise<T | null | undefined>, send: (intent: T) => Promise<unknown>) : Promise<boolean> {
  const intent = await claim()
  if (!intent) return false
  await send(intent)
  return true
}
