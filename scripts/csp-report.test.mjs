import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createCspReportPost, MAX_CSP_REPORT_BYTES, parseCspReports } from "../lib/csp-report.mjs"

const root = new URL("../", import.meta.url)
const source = (path) => readFileSync(fileURLToPath(new URL(path, root)), "utf8")

function request(contentType, body, headers = {}) {
  return new Request("https://musiccityspecialtywelding.com/api/ops/csp-report", {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body,
  })
}

function endpoint({ rateLimit = async () => false, writeTroubleReport = async () => {}, isTestContext = () => true } = {}) {
  return createCspReportPost({ rateLimit, writeTroubleReport, isTestContext })
}

test("parses legacy application/csp-report payloads", async () => {
  const parsed = await parseCspReports(request("application/csp-report", JSON.stringify({
    "csp-report": {
      "document-uri": "https://musiccityspecialtywelding.com/j/a-private-token?view=secret",
      "blocked-uri": "https://tracker.example/script.js?session=private#section",
      "effective-directive": "script-src-elem",
      "violated-directive": "script-src-elem",
      "source-file": "https://musiccityspecialtywelding.com/app.js?token=private",
      "status-code": 200,
      cookie: "must-not-be-read",
    },
  })))

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].effectiveDirective, "script-src-elem")
  assert.equal(parsed[0].blocked, "https://tracker.example/script.js")
  assert.equal(parsed[0].source, "https://musiccityspecialtywelding.com/app.js")
  assert.equal(parsed[0].route, "/j/:token")
  assert.equal(parsed[0].statusCode, 200)
  assert.equal(Object.hasOwn(parsed[0], "cookie"), false)
})

test("parses Reporting API application/reports+json payloads", async () => {
  const parsed = await parseCspReports(request("application/reports+json", JSON.stringify([
    {
      type: "csp-violation",
      url: "https://musiccityspecialtywelding.com/ops/leads/44?customer=private",
      body: {
        effectiveDirective: "connect-src",
        violatedDirective: "connect-src",
        blockedURL: "https://blob.example/upload?signature=private",
        sourceFile: "https://musiccityspecialtywelding.com/ops.js?token=private",
        statusCode: 0,
      },
    },
  ])))

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].blocked, "https://blob.example/upload")
  assert.equal(parsed[0].source, "https://musiccityspecialtywelding.com/ops.js")
  assert.equal(parsed[0].route, "/ops/leads/:id")
  assert.equal(parsed[0].statusCode, undefined)
})

test("caps report bodies at 16 KB and still returns 204 without writing oversized data", async () => {
  let writes = 0
  const post = endpoint({ writeTroubleReport: async () => { writes += 1 } })
  const validReport = JSON.stringify({ "csp-report": { "blocked-uri": "inline", "effective-directive": "script-src" } })
  const overLimit = `{"csp-report":{"blocked-uri":"${"x".repeat(MAX_CSP_REPORT_BYTES)}"}}`
  assert.ok(Buffer.byteLength(overLimit) > MAX_CSP_REPORT_BYTES)

  const response = await post(request("application/csp-report", overLimit))
  assert.equal(response.status, 204)
  assert.equal(writes, 0)

  const declaredTooLarge = await post(request("application/csp-report", validReport, { "content-length": String(MAX_CSP_REPORT_BYTES + 1) }))
  assert.equal(declaredTooLarge.status, 204)
  assert.equal(writes, 0)
})

test("rate-limits each client callback before trouble-row persistence", async () => {
  let attempts = 0
  let writes = 0
  const post = endpoint({
    rateLimit: async () => ++attempts > 1,
    writeTroubleReport: async () => { writes += 1 },
  })
  const body = JSON.stringify({ "csp-report": { "blocked-uri": "inline", "effective-directive": "script-src" } })

  assert.equal((await post(request("application/csp-report", body))).status, 204)
  assert.equal((await post(request("application/csp-report", body))).status, 204)
  assert.equal(attempts, 2)
  assert.equal(writes, 1)
})

test("stores only redacted diagnostic fields and marks test context", async () => {
  let saved
  const post = endpoint({ writeTroubleReport: async (report) => { saved = report } })
  const response = await post(request("application/csp-report", JSON.stringify({
    "csp-report": {
      "document-uri": "https://musiccityspecialtywelding.com/j/bearer-secret?customer=query-secret",
      "blocked-uri": "https://evil.example/asset.js?cookie-query=blocked-secret#fragment",
      "effective-directive": "script-src",
      "source-file": "https://musiccityspecialtywelding.com/page.js?session=source-secret",
      cookies: "cookie-value-secret",
      ip: "203.0.113.99",
    },
  }), { "x-forwarded-for": "203.0.113.99, 10.0.0.1" }))

  assert.equal(response.status, 204)
  assert.equal(saved.source, "csp-report")
  assert.equal(saved.reportedBy, null)
  assert.equal(saved.isTest, true)
  assert.equal(saved.route, "/j/:token")
  assert.match(saved.message, /https:\/\/evil\.example\/asset\.js/)
  for (const secret of ["query-secret", "blocked-secret", "source-secret", "cookie-value-secret", "203.0.113.99", "bearer-secret"]) {
    assert.equal(saved.message.includes(secret), false, `does not store ${secret}`)
  }
})

test("garbage, unsupported media types, and storage failures all receive 204", async () => {
  const post = endpoint({
    writeTroubleReport: async () => { throw new Error("persistence unavailable") },
  })
  assert.equal((await post(request("application/csp-report", "not-json"))).status, 204)
  assert.equal((await post(request("text/plain", "garbage"))).status, 204)

  const valid = JSON.stringify({ "csp-report": { "blocked-uri": "inline", "effective-directive": "script-src" } })
  assert.equal((await post(request("application/csp-report", valid))).status, 204)
})

test("the production route is unauthenticated, rate-limited, and outside auth matchers", () => {
  const route = source("app/api/ops/csp-report/route.ts")
  assert.match(route, /consumeStrictRateLimit/)
  assert.match(route, /rateLimitFingerprint\(ip\)/)
  assert.match(route, /writeTroubleReport/)
  assert.match(route, /isTestContext/)
  assert.doesNotMatch(route, /cookies\(|validateSessionToken|getAuthenticatedOperator/)

  for (const matcher of ["middleware.ts", "middleware.js", "middleware.mjs", "proxy.ts", "proxy.js", "proxy.mjs", "src/middleware.ts", "src/middleware.js", "src/proxy.ts", "src/proxy.js"]) {
    assert.equal(existsSync(fileURLToPath(new URL(matcher, root))), false, `${matcher} must not block the public browser report`)
  }
  assert.doesNotMatch(source("vercel.json"), /csp-report/)
  assert.match(route, /clientIp\.slice\(0, 128\)/)
  assert.match(route, /csp-report:ip:\$\{fingerprint\}/)
  assert.match(source("lib/trouble-reports.ts"), /reported_by, is_test/)
})
