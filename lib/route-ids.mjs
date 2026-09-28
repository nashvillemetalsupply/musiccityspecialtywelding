/** @param {unknown} value @returns {number | null} */
export function parsePositiveRouteId(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** @param {unknown} value @param {() => never} notFound @returns {number} */
export function requirePositiveRouteId(value, notFound) {
  const id = parsePositiveRouteId(value)
  return id === null ? notFound() : id
}

/** @template T @param {T | null | undefined} value @param {() => never} notFound @returns {T} */
export function requireRouteValue(value, notFound) {
  return value == null ? notFound() : value
}
