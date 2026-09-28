export function createInProcessTtlCache<T>(load: () => Promise<T> | T, ttlMs: number, now: () => number = Date.now) : () => Promise<T> {
  let value: T | undefined
  let expiresAt = Number.NEGATIVE_INFINITY
  let pending: Promise<T> | undefined

  return async function getCachedValue() {
    const currentTime = now()
    if (value !== undefined && currentTime >= 0 && currentTime < expiresAt) return value
    if (pending) return pending

    pending = Promise.resolve()
      .then(load)
      .then((loaded) => {
        value = loaded
        expiresAt = now() + ttlMs
        return loaded
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
}
