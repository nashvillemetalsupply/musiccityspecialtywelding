export function createInProcessTtlCache<T>(
  load: () => Promise<T> | T,
  ttlMs: number,
  now?: () => number,
): () => Promise<T>
