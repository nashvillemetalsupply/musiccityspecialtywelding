export const GMAIL_WAKE_PRODUCTION_ORIGIN = "https://musiccityspecialtywelding.com"

function isExactProductionOrigin(value: string | undefined) {
  try {
    const parsed = new URL(value as string)
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
export function evaluateGmailWakePolicy({ vercel, vercelEnv, callerOrigin, configuredOrigin }: { vercel: string | undefined; vercelEnv: string | undefined; callerOrigin: string | undefined; configuredOrigin: string | undefined }) {
  if (vercel !== "1" || vercelEnv !== "production" || !isExactProductionOrigin(callerOrigin)) {
    return { allowed: false, reason: "outside-production" }
  }
  if (!isExactProductionOrigin(configuredOrigin)) {
    return { allowed: false, reason: "not-configured" }
  }
  return { allowed: true, reason: null }
}

export function requestOriginFromHeaders(headers: Pick<Headers, "get">) {
  const protocol = (headers.get("x-forwarded-proto") ?? "").split(",", 1)[0].trim().toLowerCase()
  const host = (headers.get("host") ?? "").trim().toLowerCase()
  return protocol && host ? `${protocol}://${host}` : ""
}
