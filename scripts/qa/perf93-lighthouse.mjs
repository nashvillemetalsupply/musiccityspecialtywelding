// Local production-build audits. Keep diagnostic throttling separate from acceptance.
import assert from "node:assert/strict"
import { runInNewContext } from "node:vm"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { parseArgs } from "node:util"

const { values } = parseArgs({ options: {
  help: { type: "boolean", default: false },
  label: { type: "string", default: "before" },
  origin: { type: "string", default: "http://localhost:3193" },
  runs: { type: "string", default: "3" },
  "throttling-method": { type: "string", default: "simulate" },
  "source-commit": { type: "string" },
  server: { type: "string", default: "next start (production build; caller-attested)" },
} })
if (values.help) {
  console.log("node scripts/qa/perf93-lighthouse.mjs --label=before|after --origin=http://localhost:3193 --runs=3 --throttling-method=simulate [--source-commit=<sha>] [--server=<provenance>]")
  console.log("Runs both pages sequentially. simulate is acceptance; devtools is diagnostic. Public chat required. Exit 1 if either page median is below 90; mobile-welding follow-up target 93.")
  process.exit(0)
}
const originUrl = new URL(values.origin)
if (!["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname) || originUrl.protocol !== "http:" || originUrl.pathname !== "/" || originUrl.search || originUrl.hash || originUrl.username || originUrl.password) throw new Error("Use an HTTP loopback origin without a path, credentials, query, or fragment")
const origin = originUrl.origin
// Inspect only the self-contained host predicate, never evaluate module env reads.
const measurement = readFileSync("lib/measurement.ts", "utf8")
const predicate = measurement.match(/export function isProductionHost\(hostname: string\) \{([\s\S]*?)\n\}/)?.[1]
assert.ok(predicate, "Production analytics host predicate must be present")
const isProductionHost = runInNewContext(`(hostname) => {${predicate}}`)
assert.equal(isProductionHost(originUrl.hostname), false, "Local origin must disable analytics")
if (!/^[a-z0-9-]+$/.test(values.label)) throw new Error("Invalid audit label")
const count = Number(values.runs)
if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("runs must be between 1 and 10")
if (!["simulate", "devtools"].includes(values["throttling-method"])) throw new Error("throttling-method must be simulate or devtools")
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim()
const directory = `docs/perf/2026-11-11/${values.label}`
mkdirSync(directory, { recursive: true })
const sourcePaths = ["app/globals.css", "components/navbar.tsx", "components/footer.tsx", "components/lazy-quote-form.tsx", "components/mainstreet-menu.tsx"]
const summary = {
  date: "2026-11-11", label: values.label, origin, server: values.server,
  sourceCommit: values["source-commit"] ?? git("rev-parse", "HEAD"),
  mainCommit: git("rev-parse", "main"),
  currentWorktreeChangedFiles: git("diff", "--name-only").split(/\r?\n/).filter(Boolean),
  sourceProvenance: {
    filesSha256: Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    buildId: readFileSync(".next/BUILD_ID", "utf8").trim(),
    buildIdSha256: createHash("sha256").update(readFileSync(".next/BUILD_ID")).digest("hex"),
  },
  publicChat: "enabled; verified in initial server HTML on both pages",
  serverState: "page HTML and all server image-optimizer src/srcset/imagesrcset URLs warmed before each page's batch using Chrome image Accept header; fresh browser/storage each measured run",
  method: `Lighthouse 13.6.0 mobile defaults, explicit ${values["throttling-method"]} throttling; fresh Chrome/profile each run; storage reset; sequential; no request blocking`,
  acceptance: values["throttling-method"] === "simulate",
  target: { medianPerformance: 90, mobileWeldingFollowupMedian: 93 },
  analyticsGate: { source: "lib/measurement.ts:isProductionHost", localOriginAllowed: false, externalRequestsExpected: 0 },
  runs: [],
}
const save = () => writeFileSync(`${directory}/summary.json`, JSON.stringify(summary, null, 2) + "\n")
const { default: lighthouse } = await import("../../.tmp/lighthouse136/node_modules/lighthouse/core/index.js")
const { launch } = await import("../../.tmp/lighthouse136/node_modules/chrome-launcher/dist/index.js")
const pages = [["home", "/"], ["mobile-welding", "/services/mobile-welding"]]
const auditDetails = (lhr, id) => {
  const audit = lhr.audits[id]
  if (!audit) return null
  return { numericValue: audit.numericValue ?? null, displayValue: audit.displayValue ?? null, metricSavings: audit.metricSavings ?? null, details: audit.details ?? null }
}
for (const [slug, path] of pages) {
  const response = await fetch(origin + path, { redirect: "error" })
  const html = await response.text()
  if (!response.ok || !html.includes('id="shop-assistant"')) throw new Error(`${path}: healthy local HTML with public chat is required`)
  // Match baseline warming. Next caches optimizer outputs by format, so use
  // Chrome's image Accept header rather than Node fetch's default */*.
  for (const match of html.matchAll(/(?:src|srcset|imagesrcset)="([^"]*)"/g)) {
    for (const source of match[1].split(",")) {
      const imageUrl = source.trim().split(" ")[0].replaceAll("&amp;", "&")
      if (!imageUrl.startsWith("/_next/image")) continue
      const image = await fetch(origin + imageUrl, { headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" } })
      if (!image.ok) throw new Error(`Image warming failed: ${image.status} ${imageUrl}`)
      await image.arrayBuffer()
    }
  }
  for (let run = 1; run <= count; run++) {
    const chrome = await launch({ chromePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", chromeFlags: ["--headless=new", "--no-sandbox"] })
    try {
      const result = await lighthouse(origin + path, {
        port: chrome.port, output: "json", logLevel: "error",
        throttlingMethod: values["throttling-method"], disableStorageReset: false,
      })
      const lhr = result.lhr
      const networkRequests = lhr.audits["network-requests"]?.details?.items ?? []
      const externalRequests = networkRequests.filter(request => /^https?:/.test(request.url) && new URL(request.url).origin !== origin).map(request => request.url)
      assert.deepEqual(externalRequests, [], "Unblocked local audit must have zero remote resource requests")
      const report = `${directory}/${slug}-mobile-${run}.json`
      writeFileSync(report, result.report)
      const record = {
        path, run, report, lighthouseVersion: lhr.lighthouseVersion,
        scores: Object.fromEntries(Object.entries(lhr.categories).map(([key, value]) => [key, Math.round(value.score * 100)])),
        lcpMs: lhr.audits["largest-contentful-paint"]?.numericValue ?? null,
        fcpMs: lhr.audits["first-contentful-paint"]?.numericValue ?? null,
        cls: lhr.audits["cumulative-layout-shift"]?.numericValue ?? null,
        tbtMs: lhr.audits["total-blocking-time"]?.numericValue ?? null,
        speedIndexMs: lhr.audits["speed-index"]?.numericValue ?? null,
        runtimeError: lhr.runtimeError ?? null,
        warnings: lhr.runWarnings, environment: lhr.environment,
        externalRequests,
        network: networkRequests.map(({ url, resourceType, transferSize, resourceSize, startTime, endTime, priority }) => ({ url, resourceType, transferSize, resourceSize, startTime, endTime, priority })),
        // Insight subparts are observed trace timings; simulated LCP above is a
        // separate metric. Never present the observed subparts as its sum.
        observedLcpBreakdown: auditDetails(lhr, "lcp-breakdown-insight"),
        lcpDiscovery: auditDetails(lhr, "lcp-discovery-insight"),
        renderBlocking: auditDetails(lhr, "render-blocking-insight"),
        fonts: auditDetails(lhr, "font-display-insight"),
        resources: auditDetails(lhr, "resource-summary"),
        longTasks: auditDetails(lhr, "long-tasks"),
        scriptBootup: auditDetails(lhr, "bootup-time"),
        layoutShifts: auditDetails(lhr, "layout-shifts"),
        mainThread: auditDetails(lhr, "mainthread-work-breakdown"),
        unusedJs: auditDetails(lhr, "unused-javascript"),
        unusedCss: auditDetails(lhr, "unused-css-rules"),
      }
      summary.configSettings = lhr.configSettings
      summary.runs.push(record)
      console.log(JSON.stringify({ path, run, performance: record.scores.performance, lcpMs: record.lcpMs, tbtMs: record.tbtMs, cls: record.cls, report, runtimeError: record.runtimeError }))
    } catch (error) {
      const record = { path, run, runtimeError: { code: "RUNNER_ERROR", message: error.message } }
      summary.runs.push(record)
      console.error(JSON.stringify(record))
    } finally {
      save()
      await chrome.kill()
    }
  }
}
const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
summary.statistics = pages.map(([, path]) => {
  const runs = summary.runs.filter(run => run.path === path)
  const scores = runs.map(run => run.scores?.performance ?? 0)
  return {
    path, count: runs.length,
    performance: { min: Math.min(...scores), median: median(scores), max: Math.max(...scores) },
    lcpMs: { median: median(runs.map(run => run.lcpMs ?? 0)) },
    tbtMs: { median: median(runs.map(run => run.tbtMs ?? 0)) },
    cls: { median: median(runs.map(run => run.cls ?? 0)) },
  }
})
summary.passed = summary.runs.every(run => !run.runtimeError) && summary.statistics.every(page => page.count === count && page.performance.median >= 90)
summary.followupPassed = summary.statistics.find(page => page.path === "/services/mobile-welding").performance.median >= 93
console.log(JSON.stringify({ statistics: summary.statistics, passed: summary.passed, followupPassed: summary.followupPassed }))
save()
if (!summary.passed) process.exitCode = 1
