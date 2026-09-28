export function enforceShopPhoneFallbackPolicy({ isFallback, nodeEnv, vercelEnv, warn = console.warn }: {
  isFallback: boolean
  nodeEnv?: string
  vercelEnv?: string
  warn?: (message: string) => void
}) : "configured" | "fallback" {
  if (!isFallback) return "configured"

  if (nodeEnv === "production" && vercelEnv === "production") {
    throw new Error("Twilio's public shop phone settings must be configured in production.")
  }

  if (vercelEnv === "preview") {
    warn("Twilio's public shop phone settings are incomplete; the preview is using the fallback number.")
  }

  return "fallback"
}
