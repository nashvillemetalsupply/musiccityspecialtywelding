import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
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

test("the live stop snapshot cannot trigger a call summary before the recording transcript", async () => {
  const [route, store, recording, transcript] = await Promise.all([
    read("app/api/twilio/live-transcript/route.ts"),
    read("lib/call-sketch-store.ts"),
    read("app/api/twilio/recording/route.ts"),
    read("app/api/twilio/transcript/route.ts"),
  ])
  const stopped = store.slice(store.indexOf('if (input.event === "transcription-stopped")'))
  assert.doesNotMatch(route, /summarizeCallDraft/)
  assert.match(stopped, /UPDATE calls SET transcript = \$\{finalTranscript\}::text, updated_at = now\(\)\s+WHERE[^`]+AND transcript_status (?:<> 'ready'|NOT IN \('ready', 'empty'\))/)
  assert.match(recording, /after\(\(\) => submitCallRecording\(recordingSid\)/)
  assert.match(transcript, /if \(transcript\) after\(\(\) => summarizeCallDraft\(call\.twilio_sid\)/)
})

test("a late live stop leaves the recording transcript intact and emits no extraction event", async (t) => {
  const events = []
  const utterance = { sequence_id: 1, track: "inbound_track", transcript: "Partial live words" }
  let transcriptStatus = "ready"
  let transcript = "Complete recording transcript"
  let finalizeOnInsert = false
  globalThis.__lateLiveStop = {
    sql: async (strings, ...values) => {
      const query = strings.join("?").trim()
      if (query.startsWith("SELECT direction")) return [{ direction: "in", lead_id: null, person_id: null, is_test: true }]
      if (query.startsWith("WITH final_items") || query.startsWith("SELECT sequence_id")) return [utterance]
      if (query.startsWith("INSERT INTO call_sketches") || query.startsWith("DELETE FROM call_live_transcript_items")) return []
      if (query.startsWith("UPDATE calls SET transcript")) {
        assert.match(query, /AND transcript_status (?:<> 'ready'|NOT IN \('ready', 'empty'\))/)
        if (transcriptStatus === "ready" || (transcriptStatus === "empty" && query.includes("'empty'"))) return []
        transcript = values[0]
        return [{ id: 1 }]
      }
      if (query.startsWith("INSERT INTO events")) {
        assert.match(query, /\) SELECT[\s\S]+WHERE \(\?::text IS NULL OR EXISTS \(\s+SELECT 1 FROM calls WHERE twilio_sid = \?::text\s+AND transcript_status (?:<> 'ready'|NOT IN \('ready', 'empty'\))\s+FOR SHARE/)
        assert.deepEqual(values.slice(-2), ["CA1", "CA1"])
        if (finalizeOnInsert) {
          assert.equal(transcript, "Customer: Partial live words")
          transcriptStatus = "ready"
          transcript = "Complete recording transcript"
        }
        if (transcriptStatus === "ready" || (transcriptStatus === "empty" && query.includes("'empty'"))) return []
        events.push(values[1])
        return [{ id: events.length }]
      }
      assert.fail(`Unexpected SQL: ${query}`)
    },
  }
  t.after(() => { delete globalThis.__lateLiveStop })
  const modules = {
    "@/lib/db": "export const getSql = () => globalThis.__lateLiveStop.sql;",
    "@/lib/build-sheets": "export const ingestCallSketchBuildFacts = async () => {};",
    "@/lib/voice-of-character.ts": "export const captureCallVoiceSamples = async () => {}; export const rebuildOwnerVoiceProfile = async () => {};",
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(modules, specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true }
      if (specifier === "@/lib/events") return { url: new URL("../lib/events.ts?late-live-stop", import.meta.url).href, shortCircuit: true }
      if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}${specifier.endsWith(".ts") ? "" : ".ts"}`, import.meta.url).href, shortCircuit: true }
      return nextResolve(specifier, context)
    },
  })
  t.after(() => hooks.deregister())
  const { recordLiveTranscriptionEvent } = await import("../lib/call-sketch-store.ts?late-live-stop")
  const input = { event: "transcription-stopped", callSid: "CA1", transcriptionSid: "GT1" }

  assert.equal((await recordLiveTranscriptionEvent(input)).transcriptEventId, null)
  assert.equal(transcript, "Complete recording transcript")
  assert.deepEqual(events, [])

  transcriptStatus = "queued"
  finalizeOnInsert = true
  assert.equal((await recordLiveTranscriptionEvent(input)).transcriptEventId, null)
  assert.equal(transcript, "Complete recording transcript")
  assert.deepEqual(events, [])

  transcriptStatus = "queued"
  finalizeOnInsert = false
  assert.equal((await recordLiveTranscriptionEvent(input)).transcriptEventId, 1)
  assert.equal(transcript, "Customer: Partial live words")
  assert.deepEqual(events, ["call.transcript"])
  const extract = await read("lib/extract.ts")
  assert.match(extract, /const isLiveTranscript = event\.detail\.source === "twilio-live-transcription"/)
  assert.match(extract, /UPDATE calls SET crew_transcript[^`]*AND \(NOT \$\{isLiveTranscript\}::boolean OR transcript_status (?:<> 'ready'|NOT IN \('ready', 'empty'\))\)/)

  await t.test("a live stop with speech fills an empty recording and emits an extraction event", async () => {
    transcriptStatus = "empty"
    transcript = ""
    assert.equal((await recordLiveTranscriptionEvent({ ...input, transcriptionSid: "GT2" })).transcriptEventId, 2)
    assert.equal(transcript, "Customer: Partial live words")
    assert.doesNotMatch(extract, /UPDATE calls SET crew_transcript[^`]*'empty'/)
  })
})

test("a live stop that sees the recording ready can project Build facts from its event", async (t) => {
  const call = { direction: "in", is_test: true, lead_id: 7, person_id: 5, twilio_sid: "CA1" }
  const utterance = { sequence_id: 1, track: "inbound_track", transcript: "Make the gate 42 inches tall." }
  const projected = []
  let stopLive
  let transcriptEventId = null
  globalThis.__recordingPublication = {
    sql: async (strings) => {
      const query = strings.join("?").trim()
      if (query.startsWith("SELECT direction")) return [call]
      if (query.startsWith("WITH final_items") || query.startsWith("SELECT sequence_id")) return [utterance]
      if (query.startsWith("INSERT INTO call_sketches") || query.startsWith("DELETE FROM call_live_transcript_items")) return []
      if (query.startsWith("UPDATE calls SET transcript =")) return []
      assert.match(query, /UPDATE calls SET/)
      if (query.includes("INSERT INTO events")) {
        assert.match(query, /INSERT INTO events[\s\S]*FROM updated_call/)
        assert.match(query, /FROM updated_call WHERE \?::text <> ''/)
        transcriptEventId = 41
      }
      // Interleave live stop as soon as the now-ready recording is visible.
      await stopLive({ event: "transcription-stopped", callSid: "CA1", transcriptionSid: "GT1" })
      return [{ ...call, event_id: transcriptEventId }]
    },
    recordEvent: async () => (transcriptEventId = 41),
    ingestBuildFacts: async (leadId) => {
      if (transcriptEventId) projected.push({ leadId, sourceEventId: transcriptEventId })
    },
  }
  const modules = {
    "@/lib/db": "export const getSql = () => globalThis.__recordingPublication.sql;",
    "@/lib/events": "export const recordEvent = (input) => globalThis.__recordingPublication.recordEvent(input);",
    "@/lib/extract": "export const processEvent = async () => {};",
    "@/lib/build-sheets": "export const ingestCallSketchBuildFacts = (leadId) => globalThis.__recordingPublication.ingestBuildFacts(leadId);",
    "@/lib/voice-of-character.ts": "export const captureCallVoiceSamples = async () => {}; export const rebuildOwnerVoiceProfile = async () => {};",
    "@/lib/call-summary": "export const summarizeCallDraft = async () => {};",
    "@/lib/ops-auth": "export const safeSecretMatch = () => true;",
    "@/lib/call-transcription": "export const deepgramCallbackSecretConfigured = () => true;",
    "next/server": "export const after = () => {};",
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(modules, specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true }
      if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}${specifier.endsWith(".ts") ? "" : ".ts"}`, import.meta.url).href, shortCircuit: true }
      return nextResolve(specifier, context)
    },
  })
  t.after(() => {
    hooks.deregister()
    delete globalThis.__recordingPublication
  })
  const { POST } = await import("../app/api/twilio/transcript/route.ts?recording-publication")
  stopLive = (await import("../lib/call-sketch-store.ts?recording-publication")).recordLiveTranscriptionEvent
  const response = await POST(new Request("https://example.test/api/twilio/transcript?recording=RE1", {
    method: "POST",
    body: JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: utterance.transcript }] }] } }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(projected, [{ leadId: 7, sourceEventId: 41 }])
})

test("the live transcript success acknowledgement is a bodyless 204 response", async () => {
  const route = await read("app/api/twilio/live-transcript/route.ts")
  assert.match(route, /new Response\(null, \{ status: 204/)
  assert.doesNotMatch(route, /new Response\("", \{ status: 204/)
})

test("the final transcript callback re-projects Build facts after the transcript receipt", async () => {
  const store = await read("lib/call-sketch-store.ts")
  const stopped = store.slice(store.indexOf('if (input.event === "transcription-stopped")'))
  const receipt = stopped.indexOf("await recordEvent({")
  const ingestion = stopped.indexOf("await ingestCallSketchBuildFacts(Number(call.lead_id))")
  const cleanup = stopped.indexOf("DELETE FROM call_live_transcript_items")

  assert.match(store, /import \{ ingestCallSketchBuildFacts \} from "@\/lib\/build-sheets"/)
  assert.match(stopped, /if \(call\.is_test && call\.lead_id !== null\) \{[\s\S]*?await ingestCallSketchBuildFacts\(Number\(call\.lead_id\)\)/)
  assert.ok(receipt >= 0, "the final transcript receipt must be written")
  assert.ok(ingestion > receipt, "Build facts must ingest after the transcript receipt exists")
  assert.ok(cleanup > ingestion, "transcript cleanup must happen after Build-fact ingestion")
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

test("the public homepage does not render the call sketch showcase", async () => {
  const [home, contact] = await Promise.all([read("app/page.tsx"), read("lib/shop-contact.ts")])
  assert.doesNotMatch(home, /CALL_SKETCH_PUBLIC_ENABLED/)
  assert.doesNotMatch(home, /HomeCallSketch/)
  assert.match(contact, /twilioPublicNumberEnabled\(\) && twilioVoiceConfigured\(\)/)
})

test("the owner can always open a truthful Call Sketch practice workspace inside the app", async () => {
  const [intake, page, prototype] = await Promise.all([
    read("app/ops/intake/inline-job-intake.tsx"),
    read("app/ops/call-sketch/page.tsx"),
    read("components/call-sketch/call-sketch-prototype.tsx"),
  ])
  // Pinned by the owner gate and the destination, not by the stylesheet hook:
  // `jobs-call-sketch-link` belonged to the sheets Task 7 deletes.
  assert.match(intake, /owner && <Link className="[^"]*intake-sketch-link" href="\/ops\/call-sketch"/)
  assert.match(page, /getAuthenticatedOperator\(\)/)
  assert.match(page, /operator\.role !== "owner"/)
  assert.match(page, /<CallSketchPrototype embedded \/>/)
  assert.match(prototype, /No production calls or jobs are changed\./)
  assert.match(prototype, /!embedded && <header/)
})
