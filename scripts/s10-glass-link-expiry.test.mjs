import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("new and rotated glass links expire after 180 days instead of staying open-ended", () => {
  const glass = source("lib/glass.ts")
  const create = glass.slice(glass.indexOf("export async function createGlassLink"), glass.indexOf("export async function getActiveGlassLinkState"))
  const rotate = glass.slice(glass.indexOf("export async function rotateGlassLink"), glass.indexOf("export async function revokeGlassLinks"))
  assert.match(create, /now\(\) \+ interval '180 days'/)
  assert.match(rotate, /now\(\) \+ interval '180 days'/)
  assert.doesNotMatch(create, /ELSE NULL/)
})

test("legacy open-ended links are backfilled idempotently and idle activity renews expiry", () => {
  const migration = source("scripts/migrate.mjs")
  const glass = source("lib/glass.ts")
  const uploads = source("lib/glass-uploads.ts")
  const view = glass.slice(glass.indexOf("export async function noteGlassView"), glass.indexOf("export async function claimGlassReviewClick"))
  assert.match(migration, /UPDATE glass_links SET expires_at = created_at \+ interval '180 days' WHERE expires_at IS NULL/)
  assert.match(glass, /UPDATE glass_links g SET expires_at = now\(\) \+ interval '180 days'/)
  assert.match(glass, /expires_at IS NULL OR g\.expires_at > now\(\)/)
  assert.match(view, /expires_at = now\(\) \+ interval '180 days'/)
  assert.match(uploads, /extendGlassLinkExpiry\(job\.token_hash\)/)
})

test("lost jobs close their glass links and customer mutations renew only active links", () => {
  const glass = source("lib/glass.ts")
  const correction = source("app/j/[token]/correct/route.ts")
  const build = source("app/j/[token]/build/route.ts")
  assert.match(glass, /if \(job\.status === "lost"\)[\s\S]{0,250}UPDATE glass_links SET expires_at = now\(\)/)
  assert.match(glass, /return \{ \.\.\.job, status: "closed" \}/)
  assert.match(correction, /extendGlassLinkExpiry\(job\.token_hash\)/)
  assert.match(build, /extendGlassLinkExpiry\(job\.token_hash\)/)
  assert.match(source("lib/glass-uploads.ts"), /lead_status === "lost"/)
  assert.match(source("lib/glass-uploads.ts"), /l\.status <> 'lost'/)
  assert.match(glass, /UPDATE glass_links g SET review_shown_at = now\(\), expires_at = now\(\) \+ interval '180 days'/)
})
