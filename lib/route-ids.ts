/** @param {unknown} value @returns {number | null} */
export function parsePositiveRouteId(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** @param {unknown} value @param {() => never} notFound @returns {number} */
export function requirePositiveRouteId(value: unknown, notFound: () => never): number {
  const id = parsePositiveRouteId(value)
  return id === null ? notFound() : id
}

/** @template T @param {T | null | undefined} value @param {() => never} notFound @returns {T} */
export function requireRouteValue<T>(value: T | null | undefined, notFound: () => never): T {
  return value == null ? notFound() : value
}
