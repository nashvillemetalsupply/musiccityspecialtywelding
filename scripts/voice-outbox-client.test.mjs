import assert from "node:assert/strict"
import test from "node:test"
import { offlineRecordingScope, VoiceIdentityUnavailableError, scopedVoiceStorageKey, voiceIntentMatchesScope, readCurrentVoiceScope } from "../app/ops/voice-outbox-client.ts"

test("recording keys isolate operators and role changes for the same workflow", () => {
  const keys = ["operator:1:owner", "operator:2:crew", "operator:1:crew"].map((scope) => scopedVoiceStorageKey(scope, "closeout:42"))
  assert.equal(new Set(keys).size, 3)
  for (const key of keys) assert.notEqual(key, "mcsw-voice:closeout:42")
  assert.equal(scopedVoiceStorageKey("operator:1:owner", "closeout:42"), keys[0])
})

test("legacy and another operator's blobs cannot authorize upload or deletion", () => {
  for (const intent of [null, undefined, {}, { scope: "" }, { scope: "operator:1:owner" }]) {
    assert.equal(voiceIntentMatchesScope(intent, "operator:2:crew"), false)
  }
  assert.equal(voiceIntentMatchesScope({ scope: "operator:2:crew" }, "operator:2:crew"), true)
  assert.equal(voiceIntentMatchesScope({ scope: "" }, ""), false)
})

test("identity lookup always bypasses caches and accepts only the server scope contract", async () => {
  const calls = []
  const result = await readCurrentVoiceScope(async (...args) => { calls.push(args); return Response.json({ voiceScope: "operator:7:crew" }) })
  assert.equal(result, "operator:7:crew")
  assert.deepEqual(calls, [["/api/ops/cache-session", { cache: "no-store" }]])
  for (const voiceScope of [undefined, "", "operator:0:owner", "operator:7:admin", "owner:7", "operator:7:owner:other"]) {
    await assert.rejects(readCurrentVoiceScope(async () => Response.json({ voiceScope })), /could not be checked/)
  }
})

test("signed-out, offline and malformed identity responses fail closed", async () => {
  await assert.rejects(readCurrentVoiceScope(async () => new Response(null, { status: 401 })), /Sign in before/)
  await assert.rejects(readCurrentVoiceScope(async () => { throw new TypeError("offline") }), /offline/)
  await assert.rejects(readCurrentVoiceScope(async () => new Response("invalid JSON")), SyntaxError)
})

test("offline capture keeps only a previously verified identity in this mounted page", () => {
  assert.equal(offlineRecordingScope(new TypeError("offline"), "operator:7:owner"), "operator:7:owner")
  assert.equal(offlineRecordingScope(new TypeError("offline"), ""), null)
  assert.equal(offlineRecordingScope(new VoiceIdentityUnavailableError("signed out"), "operator:7:owner"), null)
  assert.equal(voiceIntentMatchesScope({ scope: "operator:7:owner" }, "operator:8:crew"), false)
})
