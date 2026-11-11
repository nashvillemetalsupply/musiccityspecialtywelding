// Local production-build audits. Keep diagnostic throttling separate from acceptance.
import { mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { parseArgs } from "node:util"

const { values } = parseArgs({ options: {
  help: { type: "boolean", default: false },
  label: { type: "string", default: "round2" },
  origin: { type: "string", default: "http://localhost:3100" },
  runs: { type: "string", default: "3" },
  "throttling-method": { type: "string", default: "simulate" },
  "source-commit": { type: "string" },
  server: { type: "string", default: "next start (production build; caller-attested)" },
} })
if (values.help) {
  console.log("node scripts/qa/fable-r2-lighthouse.mjs --label=round2 --origin=http://localhost:3100 --runs=3 --throttling-method=simulate [--source-commit=<sha>] [--server=<provenance>]")
  console.log("Runs both pages sequentially. simulate is acceptance; devtools is an alternate-throttling diagnostic. All runs require public chat in local server HTML. Exit 1 if any run misses performance >=98 or LCP <2500ms.")
  process.exit(0)
}
const originUrl = new URL(values.origin)
if (!["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname) || originUrl.protocol !== "http:" || originUrl.pathname !== "/" || originUrl.search || originUrl.hash || originUrl.username || originUrl.password) throw new Error("Use an HTTP loopback origin without a path, credentials, query, or fragment")
const origin = originUrl.origin
if (!/^[a-z0-9-]+$/.test(values.label)) throw new Error("Invalid audit label")
const count = Number(values.runs)
if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("runs must be between 1 and 10")
if (!["simulate", "devtools"].includes(values["throttling-method"])) throw new Error("throttling-method must be simulate or devtools")
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim()
const directory = `docs/perf/2026-11-10/${values.label}`
mkdirSync(directory, { recursive: true })
const summary = {
  date: "2026-11-10", label: values.label, origin, server: values.server,
  sourceCommit: values["source-commit"] ?? git("rev-parse", "HEAD"),
  mainCommit: git("rev-parse", "main"),
  currentWorktreeChangedFiles: git("diff", "--name-only").split(/\r?\n/).filter(Boolean),
  publicChat: "enabled; verified in initial server HTML on both pages",
  serverState: "page HTML and all server image-optimizer src/srcset/imagesrcset URLs warmed before each page's batch using Chrome image Accept header; fresh browser/storage each measured run",
  method: `Lighthouse 13.6.0 mobile defaults, explicit ${values["throttling-method"]} throttling; fresh Chrome/profile each run; storage reset; sequential; no request blocking`,
  acceptance: values["throttling-method"] === "simulate",
  target: { performance: 98, lcpMsBelow: 2500 },
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
  const response = await fetch(origin + path)
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
        // Insight subparts are observed trace timings; simulated LCP above is a
        // separate metric. Never present the observed subparts as its sum.
        observedLcpBreakdown: auditDetails(lhr, "lcp-breakdown-insight"),
        lcpDiscovery: auditDetails(lhr, "lcp-discovery-insight"),
        renderBlocking: auditDetails(lhr, "render-blocking-insight"),
        fonts: auditDetails(lhr, "font-display-insight"),
        resources: auditDetails(lhr, "resource-summary"),
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
summary.passed = summary.runs.every(run => !run.runtimeError && run.scores?.performance >= 98 && run.lcpMs != null && run.lcpMs < 2500)
save()
if (!summary.passed) process.exitCode = 1
