import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("Customer Page finalize rechecks the bearer after Blob HEAD", () => {
  const uploads = source("lib/glass-uploads.ts")
  const finalize = uploads.slice(uploads.indexOf("export async function finalizeGlassUpload"))
  const head = finalize.indexOf("await head(upload.pathname)")
  const activeRecheck = finalize.indexOf("WITH candidate AS MATERIALIZED", head)

  assert.ok(head >= 0 && activeRecheck > head, "active state must be rechecked after the external Blob lookup")
  assert.match(finalize.slice(activeRecheck), /pg_advisory_xact_lock\(hashtext\(token_hash\)\)/)
  assert.match(finalize.slice(activeRecheck), /g\.revoked_at IS NULL AND \(g\.expires_at IS NULL OR g\.expires_at > now\(\)\)/)
  assert.match(finalize.slice(activeRecheck), /FOR UPDATE OF g, u/)
})

test("projection and revoke serialize before any durable customer-file side effect", () => {
  const uploads = source("lib/glass-uploads.ts")
  const glass = source("lib/glass.ts")
  const project = uploads.slice(uploads.indexOf("async function projectGlassUpload"), uploads.indexOf("export async function finalizeGlassUpload"))
  const claim = project.indexOf("active AS MATERIALIZED")
  const message = project.indexOf("message_write AS")
  const event = project.indexOf("event_insert AS")
  const stored = project.indexOf("stored AS")
  const notifyGate = project.indexOf("const notifyGate")
  const notify = project.indexOf("await notifyAll")

  assert.ok(claim >= 0 && claim < message && message < event && event < stored, "one gated CTE must own message, receipt, and stored writes")
  assert.match(project, /FOR UPDATE OF g, u/)
  assert.match(project, /g\.revoked_at IS NULL AND \(g\.expires_at IS NULL OR g\.expires_at > now\(\)\)/)
  assert.ok(notifyGate >= 0 && notifyGate < notify, "notification needs a final active-link check")

  const revoke = glass.slice(glass.indexOf("export async function revokeGlassLinks"), glass.indexOf("export async function getGlassJob"))
  assert.match(revoke, /held AS MATERIALIZED/)
  assert.match(revoke, /pg_advisory_xact_lock\(hashtext\(token_hash\)\)/)
  assert.ok(revoke.indexOf("pg_advisory_xact_lock") < revoke.indexOf("UPDATE glass_links SET revoked_at"))
})
