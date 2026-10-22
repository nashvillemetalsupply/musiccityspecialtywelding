import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const HEALTH = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const MONITOR = readFileSync(new URL("../.github/workflows/health-monitor.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n")

// 10-14..10-22: five abandoned quote-photo rows, one dead voice note, and a
// throttled Gmail schedule held shopBrain.ready false for eight days.
test("abandoned quote photos age out of readiness at 48h; stored photos keep blocking", () => {
  assert.match(HEALTH, /status <> 'attached'\n\s+AND \(status = 'stored' OR updated_at >= now\(\) - interval '48 hours'\)[\s\S]*?\) AS quote_photo_backlog,/)
  assert.match(HEALTH, /status IN \('pending','failed'\)\n\s+AND updated_at >= now\(\) - interval '1 year'\n\s+AND updated_at < now\(\) - interval '48 hours'[\s\S]*?\) AS quote_photo_abandoned,/)
  assert.match(HEALTH, /\(database\.quotePhotoBacklog \?\? 0\) === 0 &&/)
  // Stored-but-unattached rows never age out; the split says whether a red
  // backlog needs the re-attach sweep or just waits out 48h.
  assert.match(HEALTH, /WHERE status = 'stored'[\s\S]*?\) AS quote_photo_stored,/)
  assert.match(HEALTH, /quotePhotoStored: database\.quotePhotoStored,/)
})

test("only voice notes a retry can finish hold readiness", () => {
  assert.match(HEALTH, /AND blob_path <> '' AND attempts < 8[\s\S]*?\) AS voice_transcript_backlog,/)
  assert.match(HEALTH, /AND \(blob_path = '' OR attempts >= 8\)[\s\S]*?\) AS voice_transcript_exhausted,/)
})

test("a late Gmail run warns; only a 48h-dead sync blocks readiness", () => {
  assert.match(HEALTH, /const WARNING_BLOCKS_AFTER_MS = 48 \* 60 \* 60 \* 1000/)
  assert.match(HEALTH, /const gmailDead = automationRunIsStale\(database\.lastGmailAt, WARNING_BLOCKS_AFTER_MS\)/)
  assert.match(HEALTH, /!gmailDead &&/)
  assert.doesNotMatch(HEALTH, /!gmailStale &&/)
})

test("demoted diagnostics stay visible in the payload and the monitor log", () => {
  for (const kind of ["gmail-stale", "quote-photos-abandoned", "voice-transcripts-exhausted"]) {
    assert.match(HEALTH, new RegExp(`kind: "${kind}"`))
  }
  assert.match(HEALTH, /\n\s+warnings,\n/)
  for (const field of ["warnings", "quotePhotoAbandoned", "voiceTranscriptExhausted"]) {
    assert.match(MONITOR, new RegExp(`${field}: \\.shopBrain\\.${field}`))
  }
})
