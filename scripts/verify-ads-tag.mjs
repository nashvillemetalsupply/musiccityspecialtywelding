#!/usr/bin/env node
// Proves the Google Ads conversion wiring is still on the live site.
//
// The tag is injected by next/script at runtime, so it is never in the server
// HTML: the only durable evidence a machine can read is the client bundle. This
// fetches the homepage, follows every /_next/ chunk it loads, and asserts both
// halves of the conversion are present -- the AW container the page configures
// and the exact send_to label the quote form fires.
//
// It cannot create a lead: it only reads. What it cannot see is whether anyone
// is submitting the form; /api/health carries that (googleAds.webQuoteSilent).
//
//   node scripts/verify-ads-tag.mjs [origin]

const ORIGIN = (process.argv[2] || "https://musiccityspecialtywelding.com").replace(/\/$/, "")
const AW_CONTAINER = "AW-17817632790"
const SEND_TO = "AW-17817632790/CZF4CMyQhPEbEJaAjrBC"

async function text(url) {
  const res = await fetch(url, { headers: { "user-agent": "mcsw-ads-tag-probe" } })
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`)
  return res.text()
}

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
// A top-level const in a classic script throws "Identifier has already been
// declared" the second time it parses, and a thrown parse takes the whole body
// with it -- including the AW config, silently.
if (/const measurementParams/.test(bundle)) {
  failures.push("The inline google-tag script declares a top-level const; it must stay inside an IIFE.")
}

if (failures.length) {
  console.error(`Ads conversion tag FAILED on ${ORIGIN}`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`Ads conversion tag OK on ${ORIGIN}: ${AW_CONTAINER} configured, send_to ${SEND_TO} shipped.`)
