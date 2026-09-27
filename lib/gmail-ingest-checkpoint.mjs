export const GMAIL_MESSAGE_CAP = 50

export function splitGmailMessageBatch(ids, cap = GMAIL_MESSAGE_CAP) {
  const safeCap = Math.max(1, Math.min(Number.isInteger(cap) ? cap : GMAIL_MESSAGE_CAP, GMAIL_MESSAGE_CAP))
  return { batch: ids.slice(0, safeCap), remaining: ids.slice(safeCap) }
}

export function pendingGmailMessageIds({ batch, remaining, processedIndex, retryIds = [] }) {
  return [
    ...batch.slice(processedIndex + 1),
    ...remaining,
    ...retryIds,
  ]
}

export function canAdvanceGmailCheckpoint({ failures, pendingIds }) {
  return failures === 0 && Array.isArray(pendingIds) && pendingIds.length === 0
}

export function shouldNotifyGmailDeadLetter(isTest) {
  return !isTest
}

export async function settleGmailRun({ job, ok, detail, release, recordRun, onReleaseError = () => {} }) {
  let finalOk = ok
  let finalDetail = detail
  try {
    await release()
  } catch (error) {
    finalOk = false
    const message = error instanceof Error ? error.message : String(error)
    finalDetail = { ...detail, leaseReleaseError: message.slice(0, 500) }
    onReleaseError(error)
  }
  await recordRun({ job, ok: finalOk, detail: finalDetail })
}
