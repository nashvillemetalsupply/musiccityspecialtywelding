// Audit the local production server only. Never point this runner at production.
import { mkdirSync, writeFileSync } from "node:fs"

const phase = process.argv[2] ?? "final"
if (!/^[a-z0-9-]+$/.test(phase)) throw new Error("Invalid local audit phase")
if (phase === "final" && process.argv[3] && process.argv[3] !== "all") throw new Error("Final audits require both pages")
const toolingDirectory = process.argv[4] === "13.6.0" ? "lighthouse136" : "lighthouse"
const { default: lighthouse } = await import(`../../.tmp/${toolingDirectory}/node_modules/lighthouse/core/index.js`)
const { launch } = await import(`../../.tmp/${toolingDirectory}/node_modules/chrome-launcher/dist/index.js`)
const outputDirectory = phase === "final" ? "docs/perf/2026-11-10" : `docs/perf/2026-11-10/${phase}`
const summaryPath = phase === "final" ? "docs/lighthouse-2026-11-10.json" : `${outputDirectory}/summary.json`
mkdirSync(outputDirectory, { recursive: true })
const runs = []
for (const [slug, path] of [["home", "/"], ["mobile-welding", "/services/mobile-welding"]]) {
  if (process.argv[3] && process.argv[3] !== "all" && process.argv[3] !== slug) continue
  if (phase === "final") {
    const response = await fetch(`http://localhost:3100${path}`)
    if (!response.ok || !(await response.text()).includes('id="shop-assistant"')) throw new Error("Final audits require a healthy local page with public chat enabled")
  }
  for (let run = 1; run <= (phase === "final" ? 3 : 1); run++) {
    const chrome = await launch({ chromePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", chromeFlags: ["--headless=new", "--no-sandbox"] })
    try {
      const result = await lighthouse(`http://localhost:3100${path}`, { port: chrome.port, output: "json", logLevel: "error" })
      const lhr = result.lhr
      const filename = `${outputDirectory}/${slug}-mobile-${run}.json`
      writeFileSync(filename, result.report)
      const record = {
        path, run, report: filename, lighthouseVersion: lhr.lighthouseVersion,
        scores: Object.fromEntries(Object.entries(lhr.categories).map(([key, value]) => [key, Math.round(value.score * 100)])),
        lcpMs: lhr.audits["largest-contentful-paint"].numericValue,
        fcpMs: lhr.audits["first-contentful-paint"].numericValue,
        cls: lhr.audits["cumulative-layout-shift"].numericValue,
        tbtMs: lhr.audits["total-blocking-time"].numericValue,
        runtimeError: lhr.runtimeError ?? null,
      }
      runs.push(record)
      console.log(JSON.stringify(record))
      writeFileSync(summaryPath, JSON.stringify({
        date: "2026-11-10", origin: "http://localhost:3100", server: "next start (production build)",
        ...(phase === "final" ? { publicChat: "enabled; verified in server HTML", serverState: "warm after local browser QA; browser storage reset for every run" } : {}),
        method: `Lighthouse ${lhr.lighthouseVersion} default simulated mobile throttling; fresh Chrome per run; storage reset; sequential runs; no request blocking`,
        target: { performance: 98, lcpMsBelow: 2500 }, runs,
      }, null, 2) + "\n")
    } finally { await chrome.kill() }
  }
}
if (runs.some(run => run.runtimeError || run.scores.performance < 98 || run.lcpMs >= 2500)) process.exitCode = 1
