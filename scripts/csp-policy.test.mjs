import assert from "node:assert/strict"
import test from "node:test"
import nextConfig from "../next.config.ts"
import {
  CSP_REPORT_ONLY_POLICY,
  CSP_REPORTING_ENDPOINTS,
} from "../lib/csp-policy.ts"

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

function parsePolicy(policy) {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name, values]
    }),
  )
}

// Host-source matching per CSP3 for https host sources without paths or ports:
// "https://host" matches exactly; "https://*.host" matches any subdomain of host
// but not host itself.
function sourceAllows(source, url) {
  const target = new URL(url)
  const match = /^https:\/\/(\*\.)?([a-z0-9.-]+)$/i.exec(source)
  if (!match || target.protocol !== "https:") return false
  const [, wildcard, host] = match
  const targetHost = target.hostname.toLowerCase()
  const sourceHost = host.toLowerCase()
  return wildcard ? targetHost.endsWith(`.${sourceHost}`) : targetHost === sourceHost
}

function directiveAllows(directives, name, url) {
  const values = directives.get(name) ?? directives.get("default-src") ?? []
  return values.some((source) => sourceAllows(source, url))
}

// Violations observed on musiccityspecialtywelding.com on 2026-10-05.
const OBSERVED_VIOLATIONS = [
  ["script-src", "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/123456789/"],
  ["connect-src", "https://analytics.google.com/g/collect"],
  ["connect-src", "https://ad.doubleclick.net/ccm/s/collect"],
  ["connect-src", "https://m6-211026f8a25b42c08fc190458268b30e.ecs.us-east-2.on.aws/events"],
]

test("every production-observed CSP violation is allowed by its directive", () => {
  const directives = parsePolicy(CSP_REPORT_ONLY_POLICY)
  for (const [name, url] of OBSERVED_VIOLATIONS) {
    assert.ok(directives.has(name), `${name} is declared`)
    assert.equal(directiveAllows(directives, name, url), true, `${name} allows ${url}`)
  }
})

test("host matcher is not vacuous", () => {
  const directives = parsePolicy(CSP_REPORT_ONLY_POLICY)
  assert.equal(directiveAllows(directives, "connect-src", "https://evil.example.com/collect"), false)
  assert.equal(directiveAllows(directives, "script-src", "https://ad.doubleclick.net/x.js"), false)
  assert.equal(directiveAllows(directives, "connect-src", "http://analytics.google.com/g/collect"), false)
  assert.equal(sourceAllows("https://*.google.com", "https://google.com/"), false)
  assert.equal(sourceAllows("https://*.google.com", "https://www.google.com/"), true)
})

test("policy never allows unsafe-eval or a bare wildcard", () => {
  const directives = parsePolicy(CSP_REPORT_ONLY_POLICY)
  for (const [name, values] of directives) {
    assert.equal(values.includes("'unsafe-eval'"), false, `${name} has no 'unsafe-eval'`)
    for (const value of values) {
      assert.notEqual(value, "*", `${name} has no bare *`)
      assert.equal(/^(?:https?:\/\/)?\*(?:$|[:/])/.test(value), false, `${name} has no bare host wildcard: ${value}`)
    }
  }
})
