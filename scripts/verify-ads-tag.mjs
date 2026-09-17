#!/usr/bin/env node
import { pathToFileURL } from "node:url"

// Proves the Google Ads conversion wiring is still on the live site.
//
// The tag is injected by next/script at runtime. This fetches the homepage and
// every /_next/ chunk it loads, then asserts both halves of the conversion are
// present -- the AW container the page configures and the exact send_to labels
// the quote form and phone links fire. It also proves the GA4 measurementId
// serialized by the page is the value consumed by the gtag config expression.
//
// It cannot create a lead: it only reads. What it cannot see is whether anyone
// is submitting the form; /api/health carries that (googleAds.webQuoteSilent).
//
//   node scripts/verify-ads-tag.mjs [origin]

const ORIGIN = (process.argv[2] || "https://musiccityspecialtywelding.com").replace(/\/$/, "")
const AW_CONTAINER = "AW-17817632790"
const SEND_TO = "AW-17817632790/CZF4CMyQhPEbEJaAjrBC"
const PHONE_SEND_TO = "AW-17817632790/0aSACPS5ue4cEJaAjrBC"

async function text(url) {
  const res = await fetch(url, { headers: { "user-agent": "mcsw-ads-tag-probe" } })
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`)
  return res.text()
}

export function findBoundGa4MeasurementIds(html, bundle) {
  const serializedIds = [...new Set(
    [...html.matchAll(/\\?["']measurementId\\?["']\s*:\s*\\?["'](G-[A-Z0-9]{6,})\\?["']/g)]
      .map((match) => match[1]),
  )]
  if (serializedIds.length === 0) return []

  // Production minification can rename measurementId (for example, to `e`).
  // Accept GA4 only when that same captured parameter is stringified into the
  // gtag config command. An unrelated G-* string and another config call fail.
  const configExpressions = bundle.matchAll(
    /window\.gtag\(\s*["']config["']\s*,\s*\$\{\s*JSON\.stringify\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\}\s*\);/g,
  )
  for (const expression of configExpressions) {
    const parameter = expression[1]
    const escapedParameter = parameter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const prefix = bundle.slice(Math.max(0, (expression.index ?? 0) - 5000), expression.index)
    const aliasesMeasurementId = new RegExp(`measurementId\\s*:\\s*${escapedParameter}\\b`).test(prefix)
    const usesShorthandMeasurementId = parameter === "measurementId"
      && /\{\s*measurementId\s*[,}]/.test(prefix)
    if (aliasesMeasurementId || usesShorthandMeasurementId) return serializedIds
  }
  return []
}

async function main() {
const failures = []

const html = await text(`${ORIGIN}/`)
const chunks = [...html.matchAll(/src="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1])
if (chunks.length === 0) failures.push("The homepage loaded no /_next/ script chunks.")

let bundle = ""
for (const chunk of chunks) bundle += await text(`${ORIGIN}${chunk}`)

if (!bundle.includes(`'config', '${AW_CONTAINER}'`) && !bundle.includes(`"config","${AW_CONTAINER}"`)) {
  failures.push(`No gtag config for ${AW_CONTAINER} in the shipped bundle.`)
}
if (!bundle.includes(SEND_TO)) {
  const other = bundle.match(/AW-\d+\/[A-Za-z0-9_-]+/g)
  failures.push(
    `The quote form does not ship send_to ${SEND_TO}` +
      (other ? ` (found ${[...new Set(other)].join(", ")} instead).` : "."),
  )
}
if (!bundle.includes(PHONE_SEND_TO)) {
  const other = bundle.match(/AW-\d+\/[A-Za-z0-9_-]+/g)
  failures.push(
    `Phone links do not ship send_to ${PHONE_SEND_TO}` +
      (other ? ` (found ${[...new Set(other)].join(", ")} instead).` : "."),
  )
}
const ga4Ids = findBoundGa4MeasurementIds(html, bundle)
if (ga4Ids.length === 0) {
  failures.push(
    "No serialized GA4 measurementId bound to that exact runtime gtag config expression was found.",
  )
}
// A top-level const in a classic script throws "Identifier has already been
// declared" the second time it parses, and a thrown parse takes the whole body
// with it -- including the AW config, silently.
if (/const measurementParams/.test(bundle)) {
  failures.push("The inline google-tag script declares a top-level const; it must stay inside an IIFE.")
}

if (failures.length) {
  console.error(`Ads conversion tag FAILED on ${ORIGIN}`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
  return
}
console.log(
  `Ads and GA4 tags OK on ${ORIGIN}: ${AW_CONTAINER} configured; form ${SEND_TO}; phone ${PHONE_SEND_TO}; GA4 ${ga4Ids.join(", ")}.`,
)
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : ""
if (entryPoint === import.meta.url) await main()
