import { readFileSync } from "node:fs"
import { isIP } from "node:net"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const VIDEO_PATHS = ["/wr-customer-walkaround.mp4", "/wr-shopcut-92.mp4"]
const EXISTING_HOSTS = new Set([
  "musiccityspecialtywelding.com", "www.musiccityspecialtywelding.com",
  "musiccitygreasepatrol.com", "www.musiccitygreasepatrol.com",
  "musiccitymetalsupply.com", "www.musiccitymetalsupply.com",
  "littledebbie2rescue.com", "www.littledebbie2rescue.com",
  "wetherbyridge.com", "www.wetherbyridge.com",
])
const CACHE_HEADERS = ["Cache-Control", "CDN-Cache-Control", "Vercel-CDN-Cache-Control"]

function externalOrigin(value) {
  const invalid = () => new Error("CDN origin must be an external public HTTPS DNS origin, without credentials, path, query or fragment.")
  if (typeof value !== "string" || /\s|\\|@/.test(value) || !/^https:\/\/[^/?#]+\/?$/i.test(value)) throw invalid()
  let url
  try { url = new URL(value) } catch { throw invalid() }
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".")
    || !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    || /(?:^|\.)(?:localhost|local|internal|vercel\.app|vercel\.com|now\.sh)$/.test(host)
    || EXISTING_HOSTS.has(host)) throw invalid()
  return url.origin
}

// Pure preparation only: no uploads, DNS lookups, file writes, or deployments.
export function prepareMediaOffload(base, cdnOrigin) {
  const origin = externalOrigin(cdnOrigin)
  if (!base || typeof base !== "object" || Array.isArray(base)) throw new Error("Base configuration must be a JSON object.")
  if (Object.hasOwn(base, "routes")) throw new Error("Legacy routes configuration needs a separate routing review.")
  for (const key of ["headers", "redirects"]) {
    if (base[key] !== undefined && !Array.isArray(base[key])) throw new Error(`Base ${key} must be an array.`)
  }
  if (base.redirects?.some((rule) => VIDEO_PATHS.includes(rule?.source))) throw new Error("A video path already has a redirect; review the collision before preparing offload.")
  const result = structuredClone(base)
  result.redirects = [
    ...VIDEO_PATHS.map((source) => ({ source, destination: `${origin}${source}`, statusCode: 307 })),
    ...(result.redirects ?? []),
  ]
  result.headers = (result.headers ?? []).map((rule) => {
    // The existing media deployment gives every MP4 an immutable year-long
    // header. A reversible redirect must not inherit that browser lifetime.
    if (rule.source !== "/(.*).mp4" && !VIDEO_PATHS.includes(rule.source)) return rule
    return { ...rule, headers: rule.headers.map((header) => CACHE_HEADERS.some((key) => key.toLowerCase() === header.key.toLowerCase())
      ? { ...header, value: "no-store" } : header) }
  })
  result.headers.push(...VIDEO_PATHS.map((source) => ({
    source, headers: CACHE_HEADERS.map((key) => ({ key, value: "no-store" })),
  })))
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 2) throw new Error("Usage: node scripts/prepare-media-offload.mjs <base-vercel.json> <https-cdn-origin>")
    // Validate the origin before opening the supplied configuration.
    externalOrigin(args[1])
    let base
    try { base = JSON.parse(readFileSync(args[0], "utf8")) }
    catch { throw new Error("Cannot read valid base configuration JSON.") }
    process.stdout.write(`${JSON.stringify(prepareMediaOffload(base, args[1]), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
