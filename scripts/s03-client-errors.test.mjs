import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = new URL("../", import.meta.url)
function source(path) {
  return readFileSync(fileURLToPath(new URL(path, root)), "utf8")
}

test("board errors are reported once to the authenticated trouble endpoint", () => {
  const boundary = source("app/board/error.tsx")
  const route = source("app/api/ops/client-error/route.ts")

  assert.match(boundary, /reported\.current\.has\(key\)/)
  assert.match(boundary, /fetch\("\/api\/ops\/client-error"/)
  assert.match(boundary, /keepalive: true/)
  assert.match(route, /validateSessionToken\(cookieStore\.get\(OPS_SESSION_COOKIE\)\?\.value\)/)
  assert.match(route, /reported_by, is_test/)
  assert.match(route, /VERCEL_ENV\?\.trim\(\)\.toLowerCase\(\) !== "production"\}::boolean/)
  assert.match(route, /safeText\(report\.message, 500\)/)
  assert.match(route, /safeText\(report\.digest, 160\)/)
})

test("client error request size is bounded with and without Content-Length", () => {
  const route = source("app/api/ops/client-error/route.ts")
  assert.match(route, /MAX_REPORT_BYTES = 4096/)
  assert.match(route, /contentLength > MAX_REPORT_BYTES/)
  assert.match(route, /request\.body\?\.getReader\(\)/)
  assert.match(route, /totalBytes > MAX_REPORT_BYTES/)
  assert.match(route, /reader\.cancel\(\)/)
})

test("trouble reports have an additive migration and health counters", () => {
  const migration = source("scripts/migrate.mjs")
  const health = source("app/api/health/route.ts")
  const table = migration.match(/CREATE TABLE IF NOT EXISTS trouble_reports \([\s\S]*?\n  \)`/)

  assert.ok(table, "the trouble-report migration should be additive and repeatable")
  assert.match(table[0], /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/)
  assert.match(table[0], /reported_by BIGINT REFERENCES operators\(id\)/)
  assert.match(table[0], /is_test BOOLEAN NOT NULL DEFAULT true/)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS trouble_reports_client_errors_idx/)
  assert.match(health, /source = 'board-client-error'[\s\S]{0,140}is_test = false/)
  assert.match(health, /source = 'board-client-error'[\s\S]{0,140}is_test = true/)
  assert.match(health, /clientErrorsLast24Hours: database\.recentClientErrors/)
  assert.match(health, /internalTestClientErrorsLast24Hours: database\.recentTestClientErrors/)
})
