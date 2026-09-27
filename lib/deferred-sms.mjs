/** A provider handoff happens only when the durable conditional claim returned a row. */
export async function sendIfClaimed(claim, send) {
  const intent = await claim()
  if (!intent) return false
  await send(intent)
  return true
}
