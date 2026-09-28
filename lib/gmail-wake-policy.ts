export const GMAIL_WAKE_PRODUCTION_ORIGIN = "https://musiccityspecialtywelding.com"

function isExactProductionOrigin(value) {
  try {
    const parsed = new URL(value)
    return (
      parsed.origin === GMAIL_WAKE_PRODUCTION_ORIGIN &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
    )
  } catch {
    return false
  }
}

/** Pure fail-closed boundary shared by runtime code and regression tests. */
export function evaluateGmailWakePolicy({ vercel, vercelEnv, callerOrigin, configuredOrigin }) {
  if (vercel !== "1" || vercelEnv !== "production" || !isExactProductionOrigin(callerOrigin)) {
    return { allowed: false, reason: "outside-production" }
  }
  if (!isExactProductionOrigin(configuredOrigin)) {
    return { allowed: false, reason: "not-configured" }
  }
  return { allowed: true, reason: null }
}

export function requestOriginFromHeaders(headers) {
  const protocol = (headers.get("x-forwarded-proto") ?? "").split(",", 1)[0].trim().toLowerCase()
  const host = (headers.get("host") ?? "").trim().toLowerCase()
  return protocol && host ? `${protocol}://${host}` : ""
}
