export function createInProcessTtlCache(load, ttlMs, now = Date.now) {
  let value
  let expiresAt = Number.NEGATIVE_INFINITY
  let pending

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
