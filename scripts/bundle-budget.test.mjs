import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { checkBundleBudgets } from "./bundle-budget.mjs"

const fixtureDir = path.join(import.meta.dirname, "fixtures", "bundle-budget")
const budgetPath = new URL("./bundle-budget.json", import.meta.url)
const fixtureBytes = async (...names) => (await Promise.all(names.map((name) =>
  stat(path.join(fixtureDir, "static", "chunks", name))
))).reduce((total, entry) => total + entry.size, 0)

test("bundle budget fails on manifest-unit limits and names the largest chunks", async () => {
  const lines = []
  const result = await checkBundleBudgets({
    distDir: fixtureDir,
    budgets: {
      manifestUnit: { routes: { "/": { baselineBytes: 16, thresholdBytes: 10 } } },
      htmlMeasurement: { routes: { "/": { totalBytes: 1000, thresholdBytes: 1000 } } },
    },
    log: (line) => lines.push(line),
  })

  const expectedBytes = await fixtureBytes("oversize-client.js", "runtime.js")
  const oversizeBytes = (await stat(path.join(fixtureDir, "static", "chunks", "oversize-client.js"))).size
  const runtimeBytes = (await stat(path.join(fixtureDir, "static", "chunks", "runtime.js"))).size
  assert.equal(result.results[0].bytes, expectedBytes)
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].thresholdBytes, 10)
  assert.equal(lines[0], `/: total ${expectedBytes} bytes exceeds threshold 10 bytes; largest chunks: static/chunks/oversize-client.js (${oversizeBytes} bytes), static/chunks/runtime.js (${runtimeBytes} bytes)`)
})

test("bundle budget reads App Router client-reference manifests", async () => {
  const result = await checkBundleBudgets({
    distDir: fixtureDir,
    budgets: { manifestUnit: { routes: { "/modern": { baselineBytes: 8, thresholdBytes: 8 } } } },
  })

  assert.equal(result.results[0].bytes, await fixtureBytes("runtime.js", "layout.js", "page.js"))
  assert.equal(result.failures.length, 1)
})

test("route with no manifest entry is reported and not failed", async () => {
  const lines = []
  const result = await checkBundleBudgets({
    distDir: fixtureDir,
    budgets: { manifestUnit: { routes: { "/unmeasured": { baselineBytes: 1, thresholdBytes: 1 } } } },
    log: (line) => lines.push(line),
  })

  assert.equal(result.results[0].measured, false)
  assert.equal(result.results[0].bytes, null)
  assert.deepEqual(result.failures, [])
  assert.match(lines[0], /size unavailable.*not enforced/)
})

test("committed thresholds use and exceed their manifest-unit baselines", async () => {
  const budgets = JSON.parse(await readFile(budgetPath, "utf8"))
  const routes = budgets.manifestUnit.routes
  assert.ok(Object.keys(routes).length > 0)

  for (const [route, config] of Object.entries(routes)) {
    assert.ok(Number.isInteger(config.baselineBytes), `${route} needs a manifest-unit baseline`)
    assert.ok(Number.isInteger(config.thresholdBytes), `${route} needs an enforced threshold`)
    assert.ok(config.thresholdBytes >= config.baselineBytes, `${route} threshold must cover its baseline`)
    assert.equal(config.thresholdBytes, Math.ceil(config.baselineBytes * 1.1))
  }
})
