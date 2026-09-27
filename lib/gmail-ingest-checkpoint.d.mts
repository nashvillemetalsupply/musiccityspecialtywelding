export const GMAIL_MESSAGE_CAP: number
export function splitGmailMessageBatch(ids: string[], cap?: number): { batch: string[]; remaining: string[] }
export function pendingGmailMessageIds(input: { batch: string[]; remaining: string[]; processedIndex: number; retryIds?: string[] }): string[]
export function shouldNotifyGmailDeadLetter(isTest: boolean): boolean
export function settleGmailRun(input: { job: string; ok: boolean; detail: Record<string, unknown>; release(): Promise<unknown>; recordRun(run: { job: string; ok: boolean; detail: Record<string, unknown> }): Promise<unknown>; onReleaseError?(error: unknown): void }): Promise<void>
