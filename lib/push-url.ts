const PUSH_ORIGIN = "https://mcsw-push.invalid"
const FALLBACK_PUSH_URL = "/board"

export function isSafeRelativePushUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return false
  }
  try {
    return new URL(value, PUSH_ORIGIN).origin === PUSH_ORIGIN
  } catch {
    return false
  }
}

export function normalizePushUrl(value) {
  if (!isSafeRelativePushUrl(value)) return FALLBACK_PUSH_URL
  const requested = new URL(value, PUSH_ORIGIN)
  return `${requested.pathname}${requested.search}${requested.hash}`
}
