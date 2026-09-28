// Inventory-backed report-only policy. Remote sources are limited to the
// existing Google tag, Meta pixel, and Vercel Blob browser upload client.
export const CSP_DIRECTIVES = Object.freeze({
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://connect.facebook.net",
  ],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": [
    "'self'",
    "data:",
    "https://www.facebook.com",
    "https://www.google.com",
    "https://www.google-analytics.com",
    "https://www.googleadservices.com",
    "https://googleads.g.doubleclick.net",
  ],
  "font-src": ["'self'"],
  "connect-src": [
    "'self'",
    "https://www.facebook.com",
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
    "https://www.google.com",
    "https://www.googleadservices.com",
    "https://googleads.g.doubleclick.net",
    "https://*.blob.vercel-storage.com",
  ],
  "media-src": ["'self'"],
  "frame-src": ["'self'"],
  "worker-src": ["'self'"],
  "manifest-src": ["'self'"],
  "form-action": ["'self'"],
  "report-uri": ["/api/ops/csp-report"],
  "report-to": ["csp-endpoint"],
})

export const CSP_DIRECTIVE_NAMES = Object.freeze(Object.keys(CSP_DIRECTIVES))
export const CSP_REPORT_ONLY_POLICY = Object.entries(CSP_DIRECTIVES)
  .map(([name, values]) => `${name} ${values.join(" ")}`)
  .join("; ")

export const CSP_REPORTING_ENDPOINTS = 'csp-endpoint="/api/ops/csp-report"'
