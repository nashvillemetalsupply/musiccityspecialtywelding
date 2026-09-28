export async function processTranscriptEventIfUnclaimed(eventId, hasSourceClaim, processEvent) {
  if (await hasSourceClaim(eventId)) return { processed: false, reason: "source-claim-exists" }
  await processEvent(eventId)
  return { processed: true }
}
