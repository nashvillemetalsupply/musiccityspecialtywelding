import assert from "node:assert/strict"
import test from "node:test"
import nextConfig from "../next.config.mjs"
import {
  CSP_REPORT_ONLY_POLICY,
  CSP_REPORTING_ENDPOINTS,
} from "../lib/csp-policy.mjs"

const EXPECTED_DIRECTIVES = [
  "base-uri",
  "connect-src",
  "default-src",
  "font-src",
  "form-action",
  "frame-ancestors",
  "frame-src",
  "img-src",
  "manifest-src",
  "media-src",
  "object-src",
  "report-to",
  "report-uri",
  "script-src",
  "style-src",
  "worker-src",
]

test("all routes retain existing headers and add the exact report-only security headers", async () => {
  const rules = await nextConfig.headers()
  const allRoutes = rules.find((rule) => rule.source === "/(.*)")
  assert.ok(allRoutes, "global headers rule exists")

  const headers = new Map(allRoutes.headers.map(({ key, value }) => [key.toLowerCase(), value]))
  assert.equal(headers.get("content-security-policy-report-only"), CSP_REPORT_ONLY_POLICY)
  assert.equal(headers.get("reporting-endpoints"), CSP_REPORTING_ENDPOINTS)
  assert.equal(headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains; preload")
  assert.equal(headers.has("content-security-policy"), false, "policy remains report-only")

  assert.equal(headers.get("x-content-type-options"), "nosniff")
  assert.equal(headers.get("x-frame-options"), "SAMEORIGIN")
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin")
  assert.equal(headers.get("permissions-policy"), "camera=(self), microphone=(self), geolocation=()")

  const actualNames = CSP_REPORT_ONLY_POLICY.split(";").map((part) => part.trim().split(/\s+/, 1)[0]).sort()
  assert.deepEqual(actualNames, [...EXPECTED_DIRECTIVES].sort())
  assert.equal(new Set(actualNames).size, actualNames.length)
  assert.match(CSP_REPORT_ONLY_POLICY, /(?:^|;\s*)object-src 'none'(?:;|$)/)
  assert.match(CSP_REPORT_ONLY_POLICY, /(?:^|;\s*)base-uri 'self'(?:;|$)/)
  assert.match(CSP_REPORT_ONLY_POLICY, /(?:^|;\s*)frame-ancestors 'self'(?:;|$)/)
  assert.match(CSP_REPORT_ONLY_POLICY, /(?:^|;\s*)report-uri \/api\/ops\/csp-report(?:;|$)/)
  assert.match(CSP_REPORT_ONLY_POLICY, /(?:^|;\s*)report-to csp-endpoint(?:;|$)/)
  for (const rule of rules) {
    assert.equal(rule.headers.some(({ key }) => key.toLowerCase() === "content-security-policy"), false)
  }
})
