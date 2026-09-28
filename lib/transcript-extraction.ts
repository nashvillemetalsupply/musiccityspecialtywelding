export async function processTranscriptEventIfUnclaimed(eventId: number, hasSourceClaim: (sourceEventId: number) => Promise<boolean>, processEvent: (sourceEventId: number) => Promise<unknown>) : Promise<{ processed: boolean; reason?: string }> {
  if (await hasSourceClaim(eventId)) return { processed: false, reason: "source-claim-exists" }
  await processEvent(eventId)
  return { processed: true }
}
