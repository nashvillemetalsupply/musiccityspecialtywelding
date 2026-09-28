import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { checkBundleBudgets } from "./bundle-budget.mjs"

const fixtureDir = path.join(import.meta.dirname, "fixtures", "bundle-budget")

test("bundle budget fails when a client chunk exceeds the route threshold", async () => {
  const lines = []
  const result = await checkBundleBudgets({
    distDir: fixtureDir,
    budgets: { routes: { "/": { thresholdBytes: 10 } } },
    log: (line) => lines.push(line),
  })

  assert.equal(result.results[0].bytes, 17)
  assert.equal(result.failures.length, 1)
  assert.match(lines[0], /exceeds 10 byte budget/)
})

test("bundle budget reads App Router client-reference manifests", async () => {
  const result = await checkBundleBudgets({
    distDir: fixtureDir,
    budgets: { routes: { "/modern": { thresholdBytes: 8 } } },
  })

  assert.equal(result.results[0].bytes, 9)
  assert.equal(result.failures.length, 1)
})

test("route with no manifest entry is reported and not failed", async () => {
  const lines = []
  const result = await checkBundleBudgets({
    distDir: fixtureDir,
    budgets: { routes: { "/unmeasured": { thresholdBytes: 1 } } },
    log: (line) => lines.push(line),
  })

  assert.equal(result.results[0].measured, false)
  assert.equal(result.results[0].bytes, null)
  assert.deepEqual(result.failures, [])
  assert.match(lines[0], /size unavailable.*not budgeted/)
})
