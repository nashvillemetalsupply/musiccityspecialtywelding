// Compare local screenshot evidence; no server or network access is needed.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { isDeepStrictEqual, parseArgs } from "node:util"
import sharp from "sharp"

const { values } = parseArgs({ options: {
  help: { type: "boolean", default: false },
  before: { type: "string", default: "before" },
  after: { type: "string", default: "after" },
} })
if (values.help) {
  console.log("node scripts/qa/perf93-compare.mjs [--before=before] [--after=after]")
  process.exit(0)
}
for (const label of [values.before, values.after]) assert.match(label, /^[a-z0-9-]+$/)
const directory = "docs/perf/2026-11-11/visuals"
const load = label => JSON.parse(readFileSync(`${directory}/${label}/metrics.json`, "utf8"))
const before = load(values.before), after = load(values.after)
assert.equal(before.origin, after.origin, "Evidence must use the same local origin")
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(before.origin).hostname))
const report = {
  before: values.before, after: values.after, origin: before.origin,
  method: "Exact element geometry and unchanged rendered styles; PNG SHA-independent decoded RGBA pixel comparison. Pixel differences are reported, not silently treated as layout failures.",
  expectedChange: "Homepage h1 computed font-family matches its existing Barlow Condensed spans; menu accessible label and aria-expanded track native open state.",
  cases: [], failures: [],
}
const check = (condition, message) => { if (!condition) report.failures.push(message) }
const screenshotPath = path => {
  assert.ok(path.startsWith(`${directory}/`) && !path.includes("..") && path.endsWith(".png"), "Screenshot must be local QA evidence")
  return path
}
async function pixels(first, second) {
  const firstBytes = readFileSync(screenshotPath(first)), secondBytes = readFileSync(screenshotPath(second))
  const [a, b] = await Promise.all([
    sharp(firstBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(secondBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  const dimensionsMatch = a.info.width === b.info.width && a.info.height === b.info.height
  const result = {
    before: first, after: second, identicalPngBytes: firstBytes.equals(secondBytes),
    beforeDimensions: { width: a.info.width, height: a.info.height },
    afterDimensions: { width: b.info.width, height: b.info.height }, dimensionsMatch,
  }
  if (!dimensionsMatch) return result
  let differentPixels = 0, absoluteChannelDifference = 0, maxChannelDifference = 0
  for (let offset = 0; offset < a.data.length; offset += 4) {
    let differs = false
    for (let channel = 0; channel < 4; channel++) {
      const difference = Math.abs(a.data[offset + channel] - b.data[offset + channel])
      differs ||= difference !== 0
      absoluteChannelDifference += difference
      maxChannelDifference = Math.max(maxChannelDifference, difference)
    }
    if (differs) differentPixels++
  }
  return { ...result, differentPixels, totalPixels: a.info.width * a.info.height,
    meanAbsoluteChannelDifference: absoluteChannelDifference / a.data.length, maxChannelDifference }
}
const caseKey = item => `${item.route}@${item.viewport.width}x${item.viewport.height}`
check(before.results.length === 4 && after.results.length === 4, "Exactly four route/viewport cases are required")
check(new Set(before.results.map(caseKey)).size === 4 && new Set(after.results.map(caseKey)).size === 4, "Route/viewport cases must be unique")
for (const baseline of before.results) {
  const key = caseKey(baseline), final = after.results.find(item => caseKey(item) === key)
  if (!final) { check(false, `${key}: final evidence is missing`); continue }
  const result = { case: key, geometryChanges: [], invariantChanges: [], screenshots: [] }
  const length = Math.max(baseline.allGeometry.length, final.allGeometry.length)
  for (let index = 0; index < length; index++) {
    if (!isDeepStrictEqual(baseline.allGeometry[index], final.allGeometry[index])) {
      result.geometryChanges.push({ index, before: baseline.allGeometry[index] ?? null, after: final.allGeometry[index] ?? null })
    }
  }
  check(result.geometryChanges.length === 0, `${key}: all element bounds and identities must match`)
  const unchanged = ["viewport", "overflow", "scrollHeight", "bodyFont", "labelFont", "labelSize", "carbon", "missingImages", "undersizedMono", "edges", "form", "checkboxWidth", "selectAppearance"]
  for (const field of unchanged) {
    if (!isDeepStrictEqual(baseline[field], final[field])) result.invariantChanges.push({ field, before: baseline[field], after: final[field] })
  }
  const imageBounds = item => item.images.map(({ alt, x, y, width, height }) => ({ alt, x, y, width, height }))
  if (!isDeepStrictEqual(imageBounds(baseline), imageBounds(final))) result.invariantChanges.push({ field: "imageBounds", before: imageBounds(baseline), after: imageBounds(final) })
  // The h1's own computed family is the explicit correction; its rendered spans
  // and every other captured rendered style must stay the same.
  const renderedStyles = item => item.geometry.map(element => ({ ...element, ...(item.route === "/" && element.tag === "H1" ? { font: "expected display-family correction" } : {}) }))
  if (!isDeepStrictEqual(renderedStyles(baseline), renderedStyles(final))) result.invariantChanges.push({ field: "renderedStyles", before: renderedStyles(baseline), after: renderedStyles(final) })
  if (!isDeepStrictEqual(baseline.h1.spans, final.h1.spans)) result.invariantChanges.push({ field: "h1Spans", before: baseline.h1.spans, after: final.h1.spans })
  check(result.invariantChanges.length === 0, `${key}: rendered styles, images, forms, edges and document dimensions must match`)
  result.h1Font = { before: baseline.h1.ownFont, after: final.h1.ownFont, renderedSpans: final.h1.spans }
  if (final.route === "/") check(final.h1.ownFont === final.h1.spans[0]?.font, `${key}: homepage h1 family must match the rendered spans`)
  if (final.viewport.width === 390) {
    const menu = final.menu.map(({ open, label, expanded }) => ({ open, label, expanded }))
    check(isDeepStrictEqual(menu, [
      { open: false, label: "Open navigation", expanded: "false" },
      { open: true, label: "Close navigation", expanded: "true" },
      { open: false, label: "Open navigation", expanded: "false" },
    ]), `${key}: menu accessibility must follow open state`)
    result.menu = { before: baseline.menu, after: final.menu }
  }
  for (const field of ["pageErrors", "consoleErrors", "blockedSubmissions"]) check(baseline[field].length === 0 && final[field].length === 0, `${key}: ${field} must be empty`)
  for (const field of ["fullScreenshot", "foldScreenshot"]) {
    const comparison = await pixels(baseline[field], final[field])
    check(comparison.dimensionsMatch, `${key}: ${field} dimensions must match`)
    result.screenshots.push(comparison)
  }
  report.cases.push(result)
}
report.passed = report.failures.length === 0
report.pixelSummary = {
  count: report.cases.reduce((sum, item) => sum + item.screenshots.length, 0),
  identicalPixels: report.cases.reduce((sum, item) => sum + item.screenshots.filter(screenshot => screenshot.differentPixels === 0).length, 0),
  interpretation: "Inspect nonzero pixel differences; exact matching geometry is required independently of raster variation.",
}
const output = `${directory}/comparison.json`
writeFileSync(output, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ output, passed: report.passed, failures: report.failures, pixelSummary: report.pixelSummary }))
if (!report.passed) process.exitCode = 1
