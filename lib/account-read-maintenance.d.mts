export const ACCOUNT_READ_REPAIR_GUARD_MS: number

export function scheduleAccountReadRepair(input: {
  key: string
  after: (task: () => void | Promise<void>) => void
  write: () => Promise<unknown> | unknown
  now?: () => number
  onError?: (error: unknown) => void
}): boolean
