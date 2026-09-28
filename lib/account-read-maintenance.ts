export const ACCOUNT_READ_REPAIR_GUARD_MS: number = 15 * 60_000

const scheduledAtByKey = new Map()

function pruneExpired(nowMs: number) {
  for (const [key, schedule] of scheduledAtByKey) {
    if (nowMs < schedule.at || nowMs - schedule.at >= ACCOUNT_READ_REPAIR_GUARD_MS) {
      scheduledAtByKey.delete(key)
    }
  }
}

export function scheduleAccountReadRepair({ key, after, write, now = Date.now, onError = (error) => console.error("Account key repair failed:", error) }: {
  key: string
  after: (task: () => void | Promise<void>) => void
  write: () => Promise<unknown> | unknown
  now?: () => number
  onError?: (error: unknown) => void
}) : boolean {
  const nowMs = now()
  pruneExpired(nowMs)
  const lastSchedule = scheduledAtByKey.get(key)
  if (lastSchedule !== undefined && nowMs - lastSchedule.at < ACCOUNT_READ_REPAIR_GUARD_MS) return false

  const schedule = { at: nowMs }
  scheduledAtByKey.set(key, schedule)
  after(() => Promise.resolve()
    .then(write)
    .catch((error) => {
      if (scheduledAtByKey.get(key) === schedule) scheduledAtByKey.delete(key)
      onError(error)
    }))
  return true
}
