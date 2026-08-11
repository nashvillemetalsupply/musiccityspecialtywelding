import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("Twilio starts managed real-time transcription on inbound and outbound calls", async () => {
  const [twilio, inbound, outbound] = await Promise.all([
    read("lib/twilio.ts"),
    read("app/api/twilio/voice/route.ts"),
    read("app/api/twilio/outbound-connect/route.ts"),
  ])
  assert.match(twilio, /<Start><Transcription/)
  assert.match(twilio, /statusCallbackUrl=.*live-transcript/)
  assert.match(twilio, /transcriptionEngine=\"deepgram\"/)
  assert.match(twilio, /speechModel=\"nova-3\"/)
  assert.match(twilio, /partialResults=\"true\"/)
  assert.match(inbound, /twilioLiveTranscriptionStart\(\{ callSid: sid, direction: \"in\" \}\)/)
  assert.match(outbound, /twilioLiveTranscriptionStart\(\{ callSid, direction: \"out\" \}\)/)
})

test("live transcript callbacks are signed, idempotent, and stored durably", async () => {
  const [route, store, migration] = await Promise.all([
    read("app/api/twilio/live-transcript/route.ts"),
    read("lib/call-sketch-store.ts"),
    read("scripts/migrate.mjs"),
  ])
  assert.match(route, /readTwilioForm\(req\)/)
  assert.match(route, /if \(!valid\).*403/)
  assert.match(store, /ON CONFLICT \(transcription_sid, sequence_id, track\) DO UPDATE/)
  assert.match(store, /deriveCallSketch/)
  assert.doesNotMatch(store, /crew_transcript = \$\{finalTranscript\}/)
  assert.match(store, /observed_through_sequence/)
  assert.match(store, /kind: "call\.transcript"/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS call_live_transcript_items/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS call_sketches/)
  assert.match(migration, /observed_through_sequence INT NOT NULL DEFAULT 0/)
  assert.match(migration, /UNIQUE \(transcription_sid, sequence_id, track\)/)
})

test("only an authenticated owner can confirm or export a call sketch", async () => {
  const [route, dxfRoute, component] = await Promise.all([
    read("app/api/ops/call-sketch/[draftId]/route.ts"),
    read("app/api/ops/call-sketch/[draftId]/dxf/route.ts"),
    read("components/call-sketch/live-call-sketch.tsx"),
  ])
  assert.match(route, /operator\.role !== \"owner\"/)
  assert.match(route, /sameOrigin\(req\)/)
  assert.match(dxfRoute, /operator\.role !== \"owner\"/)
  assert.match(dxfRoute, /getConfirmedCallSketchForDraft/)
  assert.match(component, /Confirm facts & unlock DXF/)
  assert.match(component, /Rough call sketch · not a fabrication drawing/)
})

test("the public showcase is gated until the production phone path is enabled", async () => {
  const [home, contact] = await Promise.all([read("app/page.tsx"), read("lib/shop-contact.ts")])
  assert.match(home, /CALL_SKETCH_PUBLIC_ENABLED/)
  assert.match(home, /callSketchPublicEnabled &&/)
  assert.match(contact, /twilioPublicNumberEnabled\(\) && twilioVoiceConfigured\(\)/)
})

test("the owner can always open a truthful Call Sketch practice workspace inside the app", async () => {
  const [intake, page, prototype] = await Promise.all([
    read("app/ops/intake/inline-job-intake.tsx"),
    read("app/ops/call-sketch/page.tsx"),
    read("components/call-sketch/call-sketch-prototype.tsx"),
  ])
  assert.match(intake, /owner && <Link className="jobs-call-sketch-link" href="\/ops\/call-sketch"/)
  assert.match(page, /getAuthenticatedOperator\(\)/)
  assert.match(page, /operator\.role !== "owner"/)
  assert.match(page, /<CallSketchPrototype embedded \/>/)
  assert.match(prototype, /No production calls or jobs are changed\./)
  assert.match(prototype, /!embedded && <header/)
})
