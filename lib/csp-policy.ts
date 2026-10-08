// Inventory-backed report-only policy. Remote sources are limited to the
// existing Google tag (GA4 + Google Ads, per Google's published CSP guide), the
// Meta pixel and its configured gateway
// (m6-211026f8a25b42c08fc190458268b30e.ecs.us-east-2.on.aws), and the Vercel
// Blob browser upload client.
// 2026-10-08 (O18 triage): the Meta pixel also needs form-action and frame-src
// on https://www.facebook.com and img-src on https://connect.facebook.net.
// wasm-eval, eval, apis.google.com and toolytics reports are extension noise and
// are deliberately NOT allowlisted; never add 'unsafe-eval'.
// See docs/testing/2026-10-08-csp-o18-triage.md.
export const CSP_DIRECTIVES = Object.freeze({
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://*.googletagmanager.com",
    "https://www.googleadservices.com",
    "https://googleads.g.doubleclick.net",
    "https://www.google.com",
    "https://connect.facebook.net",
  ],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": [
    "'self'",
    "data:",
    "https://www.facebook.com",
    "https://connect.facebook.net",
    "https://www.google.com",
    "https://google.com",
    "https://*.google.com",
    "https://www.google-analytics.com",
    "https://*.google-analytics.com",
    "https://*.googletagmanager.com",
    "https://www.googleadservices.com",
    "https://googleads.g.doubleclick.net",
    "https://*.g.doubleclick.net",
  ],
  "font-src": ["'self'"],
  "connect-src": [
    "'self'",
    "https://www.facebook.com",
    "https://connect.facebook.net",
    "https://m6-211026f8a25b42c08fc190458268b30e.ecs.us-east-2.on.aws",
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
    "https://*.google-analytics.com",
    "https://analytics.google.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
    "https://www.google.com",
    "https://*.google.com",
    "https://www.googleadservices.com",
    "https://googleads.g.doubleclick.net",
    "https://*.g.doubleclick.net",
    "https://ad.doubleclick.net",
    "https://pagead2.googlesyndication.com",
    "https://*.blob.vercel-storage.com",
  ],
  "media-src": ["'self'"],
  "frame-src": ["'self'", "https://td.doubleclick.net", "https://www.googletagmanager.com", "https://www.facebook.com"],
  "worker-src": ["'self'"],
  "manifest-src": ["'self'"],
  "form-action": ["'self'", "https://www.facebook.com"],
  "report-uri": ["/api/ops/csp-report"],
  "report-to": ["csp-endpoint"],
})

export const CSP_DIRECTIVE_NAMES = Object.freeze(Object.keys(CSP_DIRECTIVES))
export const CSP_REPORT_ONLY_POLICY = Object.entries(CSP_DIRECTIVES)
  .map(([name, values]) => `${name} ${values.join(" ")}`)
  .join("; ")

export const CSP_REPORTING_ENDPOINTS = 'csp-endpoint="/api/ops/csp-report"'
