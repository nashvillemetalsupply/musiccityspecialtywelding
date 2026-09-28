export const GMAIL_MESSAGE_CAP: number = 50

export function splitGmailMessageBatch(ids: string[], cap: number = GMAIL_MESSAGE_CAP) : { batch: string[]; remaining: string[] } {
  const safeCap = Math.max(1, Math.min(Number.isInteger(cap) ? cap : GMAIL_MESSAGE_CAP, GMAIL_MESSAGE_CAP))
  return { batch: ids.slice(0, safeCap), remaining: ids.slice(safeCap) }
}

export function pendingGmailMessageIds({ batch, remaining, processedIndex, retryIds = [] }: { batch: string[]; remaining: string[]; processedIndex: number; retryIds?: string[] }) : string[] {
  return [
    ...batch.slice(processedIndex + 1),
    ...remaining,
    ...retryIds,
  ]
}

export function canAdvanceGmailCheckpoint({ failures, pendingIds }: { failures: number; pendingIds: string[] }) : boolean {
  return failures === 0 && Array.isArray(pendingIds) && pendingIds.length === 0
}

export function shouldNotifyGmailDeadLetter(isTest: boolean) : boolean {
  return !isTest
}

export async function settleGmailRun({ job, ok, detail, release, recordRun, onReleaseError = () => {} }: { job: string; ok: boolean; detail: Record<string, unknown>; release(): Promise<unknown>; recordRun(run: { job: string; ok: boolean; detail: Record<string, unknown> }): Promise<unknown>; onReleaseError?(error: unknown): void }) : Promise<void> {
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
