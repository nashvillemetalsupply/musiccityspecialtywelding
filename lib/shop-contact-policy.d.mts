export function enforceShopPhoneFallbackPolicy(options: {
  isFallback: boolean
  nodeEnv?: string
  vercelEnv?: string
  warn?: (message: string) => void
}): "configured" | "fallback"
