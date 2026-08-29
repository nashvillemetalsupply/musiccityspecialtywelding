import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  QUOTE_SERVICE_OPTIONS,
  detectRasterImageType,
  imageTypeMatches,
  validatePublicQuote,
} from "../lib/public-quote.mjs"
import { escapeEmailText, safeEmailHref } from "../lib/email-safety.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("public quote fields accept real local jobs and reject junk identities", () => {
  assert.equal(validatePublicQuote({
    firstName: "Sam",
    lastName: "Jones",
    phone: "(615) 555-0123",
    email: "sam@example.com",
    service: QUOTE_SERVICE_OPTIONS[0],
    message: "Trailer tongue cracked near Lebanon.",
  }), "")
  assert.match(validatePublicQuote({ firstName: "Sam", phone: "123", service: QUOTE_SERVICE_OPTIONS[0] }), /valid US phone/i)
  assert.match(validatePublicQuote({ firstName: "Sam", phone: "6155550123", service: "Free money" }), /listed job type/i)
  assert.match(validatePublicQuote({ firstName: "S".repeat(81), phone: "6155550123", service: QUOTE_SERVICE_OPTIONS[0] }), /name is too long/i)
  assert.match(validatePublicQuote({ firstName: "Sam", phone: "6155550123", service: QUOTE_SERVICE_OPTIONS[0], message: "x".repeat(4001) }), /details are too long/i)
})

test("quote uploads require bytes that match the declared safe raster type", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const webp = new TextEncoder().encode("RIFF1234WEBP")
  const gif = new TextEncoder().encode("GIF89a")
  const heic = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])
  assert.equal(detectRasterImageType(jpeg), "image/jpeg")
  assert.equal(detectRasterImageType(png), "image/png")
  assert.equal(detectRasterImageType(webp), "image/webp")
  assert.equal(detectRasterImageType(gif), "image/gif")
  assert.equal(detectRasterImageType(heic), "image/heic")
  assert.equal(detectRasterImageType(new TextEncoder().encode("<script>alert(1)</script>")), null)
  assert.equal(imageTypeMatches(jpeg, "image/jpeg"), true)
  assert.equal(imageTypeMatches(jpeg, "image/png"), false)
})

test("email shell escapes plain fields and rejects executable CTA protocols", () => {
  assert.equal(escapeEmailText(`<img src=x onerror="boom">`), "&lt;img src=x onerror=&quot;boom&quot;&gt;")
  assert.equal(safeEmailHref("javascript:alert(1)"), "")
  assert.equal(safeEmailHref("data:text/html,bad"), "")
  assert.equal(safeEmailHref("https://musiccityspecialtywelding.com/ops?a=1&b=2"), "https://musiccityspecialtywelding.com/ops?a=1&amp;b=2")
  assert.equal(safeEmailHref("tel:+16157033296"), "tel:+16157033296")
})

test("only accepted leads emit conversions and public text cannot mark itself internal", () => {
  const quote = source("app/api/quote/route.ts")
  const client = source("components/mainstreet-contact.tsx")
  assert.match(quote, /honeypot[\s\S]{0,240}accepted: false/)
  assert.match(quote, /isAuthorizedCron\(req\)\s*&&\s*projectDetails\.includes\("\[INTERNAL TEST\]"\)/)
  assert.match(quote, /accepted: true/)
  assert.match(client, /data\?\.accepted !== true/)
  assert.ok(client.indexOf("data?.accepted !== true") < client.indexOf('window.gtag("event", "generate_lead"'))
})

test("notification failure cannot turn a durably accepted lead into a client error", () => {
  const quote = source("app/api/quote/route.ts")
  assert.match(quote, /New-lead notification failed/)
  assert.match(quote, /Customer-delivery notification failed/)
  assert.match(quote, /if \(leadId === null\)[\s\S]{0,280}status: 503/)
})

test("detailed health is cron-authenticated and the monitor fails on Shop Brain degradation", () => {
  const health = source("app/api/health/route.ts")
  const workflow = source(".github/workflows/health-monitor.yml")
  assert.match(health, /export async function GET\(req: Request\)/)
  assert.ok(health.indexOf("if (!isAuthorizedCron(req))") < health.indexOf("await Promise.all"))
  assert.match(workflow, /Authorization: Bearer \$\{\{ secrets\.CRON_SECRET \}\}/)
  assert.match(workflow, /\.shopBrain\.ready == true/)
})

test("quote photo storage is intent-first and leaves a resumable receipt", () => {
  const quote = source("app/api/quote/route.ts")
  const leads = source("lib/leads.ts")
  const migration = source("scripts/migrate.mjs")
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lead_photo_intents/)
  assert.match(migration, /UNIQUE \(lead_id, intake_key, photo_index\)/)
  assert.match(leads, /export async function reserveLeadPhotoIntents/)
  assert.match(leads, /export async function markLeadPhotoIntent/)
  const reserve = quote.indexOf("await reserveLeadPhotoIntents")
  const upload = quote.indexOf("await put(")
  assert.ok(reserve >= 0 && reserve < upload, "photo intent must persist before Blob receives bytes")
  assert.match(quote, /markLeadPhotoIntent\([\s\S]{0,220}"stored"/)
  assert.match(quote, /markLeadPhotoIntent\([\s\S]{0,220}"attached"/)
  assert.match(quote, /let photosDurable = photoFiles\.length === 0/)
  assert.doesNotMatch(quote, /photoFiles\.length > 0 && process\.env\.BLOB_READ_WRITE_TOKEN/)
  assert.match(quote, /if \(!process\.env\.BLOB_READ_WRITE_TOKEN\)[\s\S]{0,900}photosDurable = false/)
  assert.match(quote, /catch \(blobError\)[\s\S]{0,420}photosDurable = false/)
  const partialFailure = quote.indexOf("if (!photosDurable)")
  const accepted = quote.indexOf("accepted: true", partialFailure)
  assert.ok(partialFailure >= 0 && partialFailure < accepted, "photo failure must block accepted=true")
  assert.match(quote, /accepted: false[\s\S]{0,240}photos were not safely stored/i)
  const health = source("app/api/health/route.ts")
  assert.match(health, /quotePhotoBacklog/)
  assert.match(health, /FROM lead_photo_intents/)
})
