import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { voiceOperatorScope } from "../lib/voice-outbox-scope.ts"

function harness(operator = { id: 2, role: "owner" }) {
  const effects = { queries: [], uploads: 0, transcriptions: 0 }
  const fakes = new Map([
    ["node:crypto", { randomUUID: () => "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }],
    ["@/lib/ops-auth", { getAuthenticatedOperator: async () => operator, getOpsCacheSessionId: async () => "a".repeat(64) }],
    ["@/lib/voice-outbox-scope.ts", { voiceOperatorScope }],
    ["@/lib/db", { getSql: () => async (strings, ...values) => {
      const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
      effects.queries.push({ query, values })
      if (query.startsWith("INSERT INTO voice_transcription_intents")) return [{ id: values[0] }]
      if (query.startsWith("SELECT status, transcript, blob_path")) {
        const inserted = effects.queries.find(({ query }) => query.startsWith("INSERT INTO voice_transcription_intents"))
        return [{ status: "persisted", transcript: "", blob_path: "", content_type: "audio/webm", recovery_key: inserted?.values[3] }]
      }
      return []
    } }],
    ["@vercel/blob", { put: async (pathname) => { effects.uploads++; return { pathname } } }],
    ["@/lib/voice-transcription", { transcribeVoiceIntent: async () => { effects.transcriptions++; return "Fixture transcript" } }],
  ])
  function load(relativePath) {
    const output = ts.transpileModule(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const context = vm.createContext({ Request, Response, URL, Buffer, Error, process: { env: { DEEPGRAM_API_KEY: "synthetic", BLOB_READ_WRITE_TOKEN: "synthetic" } } })
    const loaded = { exports: {} }
    const require = (name) => {
      if (fakes.has(name)) return fakes.get(name)
      throw new Error(`Unexpected voice import: ${name}`)
    }
    vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, require, loaded)
    return loaded.exports
  }
  return { effects, transcribe: load("app/api/ops/transcribe/route.ts"), context: load("app/api/ops/cache-session/route.ts") }
}

function recording(scope, recoveryKey = "done:7") {
  return new Request("https://fixture.invalid/api/ops/transcribe", {
    method: "POST", body: new Uint8Array([1, 2, 3]),
    headers: { "content-type": "audio/webm", "x-voice-intent-id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "x-voice-recovery-key": recoveryKey,
      ...(scope ? { "x-voice-operator-scope": scope } : {}) },
  })
}

test("voice context is authenticated, uncached, and stable across sessions for the same operator role", async () => {
  const signedOut = harness(null)
  assert.equal((await signedOut.context.GET()).status, 401)
  const owner = harness()
  const response = await owner.context.GET()
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(await response.json(), { sessionId: "a".repeat(64), voiceScope: "operator:2:owner", role: "owner" })
  assert.notEqual(voiceOperatorScope({ id: 2, role: "crew" }), voiceOperatorScope({ id: 2, role: "owner" }))
  assert.notEqual(voiceOperatorScope({ id: 3, role: "owner" }), voiceOperatorScope({ id: 2, role: "owner" }))
})

test("missing legacy or stale operator scope cannot create a voice intent or call providers", async () => {
  for (const scope of [null, "operator:1:owner", "operator:2:crew"]) {
    const current = harness()
    assert.equal((await current.transcribe.POST(recording(scope))).status, 409)
    assert.equal(current.effects.queries.length, 0)
    assert.equal(current.effects.uploads, 0)
    assert.equal(current.effects.transcriptions, 0)
  }
})

test("a session switch also rejects scoped polling before any transcript lookup", async () => {
  const current = harness({ id: 3, role: "crew" })
  const response = await current.transcribe.GET(new Request("https://fixture.invalid/api/ops/transcribe?id=fixture", { headers: { "x-voice-operator-scope": "operator:2:owner" } }))
  assert.equal(response.status, 409)
  assert.equal(current.effects.queries.length, 0)
})

test("authorized closeout voice stores the job binding required to finish that same job", async () => {
  for (const key of ["closeout:7", "done:7", "spike:7:primary"]) {
    const current = harness()
    assert.equal((await current.transcribe.POST(recording("operator:2:owner", key))).status, 200)
    const insert = current.effects.queries.find(({ query }) => query.startsWith("INSERT INTO voice_transcription_intents"))
    assert.equal(insert.values[1], 2)
    assert.equal(insert.values[3], key)
    assert.equal(insert.values[4], 7)
    assert.equal(current.effects.uploads, 1)
    assert.equal(current.effects.transcriptions, 1)
  }
})
