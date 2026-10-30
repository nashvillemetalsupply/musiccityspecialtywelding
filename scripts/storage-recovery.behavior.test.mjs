import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { voiceOperatorScope } from "../lib/voice-outbox-scope.ts"

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
const scope = "operator:2:owner"
const audio = new Blob(["synthetic recording"], { type: "audio/webm" })

function load(file, dependencies, globals = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const loaded = { exports: {} }
  const context = vm.createContext({ Request, Response, URL, Buffer, Blob, Error, Date, crypto, ...globals })
  vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, (name) => {
    assert.ok(name in dependencies, `Unexpected import ${name}`)
    return dependencies[name]
  }, loaded)
  return loaded.exports
}

function hooks() {
  const values = []
  let cursor = 0
  return {
    reset: () => { cursor = 0 },
    react: {
      useId: () => "fixture",
      useEffect: () => {},
      useCallback: (fn) => fn,
      useState: (initial) => {
        const index = cursor++
        if (!(index in values)) values[index] = initial
        return [values[index], (value) => { values[index] = typeof value === "function" ? value(values[index]) : value }]
      },
      useRef: (initial) => {
        const index = cursor++
        if (!(index in values)) values[index] = { current: initial }
        return values[index]
      },
    },
  }
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" }
function elements(node) {
  if (!node || typeof node !== "object") return []
  return [node, ...[node.props?.children].flat(Infinity).flatMap(elements)]
}

function voiceFixture({ uploaded = false, completed = false, retained = true, savedScope = scope, existing = true } = {}) {
  const row = { status: completed ? "completed" : uploaded ? "queued" : "persisted", blob_path: uploaded || completed ? "synthetic/audio.webm" : "", transcript: completed ? "Recovered words" : "", last_error: "", attempts: 0 }
  const effects = { uploads: 0, transcriptions: 0, deleted: 0, posts: 0, transcripts: [], errors: [] }
  let suspended = true
  let intentExists = existing
  const route = load("app/api/ops/transcribe/route.ts", {
    "node:crypto": { randomUUID: () => id },
    "@/lib/ops-auth": { getAuthenticatedOperator: async () => ({ id: 2, role: "owner" }) },
    "@/lib/voice-outbox-scope.ts": { voiceOperatorScope },
    "@/lib/db": { getSql: () => async (strings, ...values) => {
      const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
      if (query.startsWith("INSERT INTO voice_transcription_intents")) intentExists = true
      if (query.startsWith("SELECT")) return intentExists ? [{ ...row }] : []
      if (query.includes("SET blob_path")) { row.blob_path = values[0]; row.status = "queued" }
      if (query.includes("SET status = 'failed'")) { row.status = "failed"; row.last_error = values[0] }
      return []
    } },
    "@vercel/blob": { put: async (pathname) => {
      effects.uploads++
      if (suspended) throw new Error("Blob store suspended")
      return { pathname }
    } },
    "@/lib/voice-transcription": { transcribeVoiceIntent: async () => {
      effects.transcriptions++
      assert.ok(row.blob_path, "transcription requires stored bytes")
      row.status = "completed"; row.transcript = "Recovered words"
      return row.transcript
    } },
  }, { process: { env: { DEEPGRAM_API_KEY: "synthetic", BLOB_READ_WRITE_TOKEN: "synthetic" } } })
  const saved = retained ? { id, scope: savedScope, recoveryKey: "done:7", contentType: audio.type, blob: audio } : null
  const storage = new Map([[`mcsw-voice:${scope}:done:7`, id]])
  const indexedDB = { open: () => {
    const request = {}
    queueMicrotask(() => {
      request.result = { close() {}, transaction: () => {
        const transaction = { objectStore: () => ({
          get: () => { const read = {}; queueMicrotask(() => { read.result = saved; read.onsuccess() }); return read },
          delete: () => { effects.deleted++; queueMicrotask(() => transaction.oncomplete()) },
        }) }
        return transaction
      } }
      request.onsuccess()
    })
    return request
  } }
  const hook = hooks()
  const client = load("app/ops/voice-capture-button.tsx", {
    react: hook.react, "react/jsx-runtime": jsx,
    "./voice-outbox-client": {
      offlineRecordingScope: () => null,
      readCurrentVoiceScope: async () => scope,
      scopedVoiceStorageKey: (identity, key) => `mcsw-voice:${identity}:${key}`,
      voiceIntentMatchesScope: (intent, identity) => intent?.scope === identity,
    },
  }, {
    indexedDB, navigator: {},
    window: { setTimeout: (callback) => { queueMicrotask(callback); return 1 }, localStorage: { getItem: (key) => storage.get(key) ?? null, removeItem: (key) => storage.delete(key) } },
    fetch: async (url, options = {}) => {
      const request = new Request(`https://fixture.invalid${url}`, options)
      if (options.method === "POST") { effects.posts++; return route.POST(request) }
      return route.GET(request)
    },
  })
  const request = () => new Request("https://fixture.invalid/api/ops/transcribe", { method: "POST", body: audio,
    headers: { "content-type": audio.type, "x-voice-intent-id": id, "x-voice-recovery-key": "done:7", "x-voice-operator-scope": scope } })
  return { row, route, effects, storage, request, restore: () => { suspended = false }, retry: async () => {
    const button = client.VoiceCaptureButton({ available: true, recoveryKey: "done:7", onTranscript: (text) => effects.transcripts.push(text), onError: (error) => { if (error) effects.errors.push(error) } })
    button.props.onClick({ detail: 0 })
    for (let i = 0; i < 100 && !effects.transcripts.length && !effects.errors.length; i++) await new Promise(setImmediate)
  } }
}

test("a retained recording recovers an existing intent after Blob storage resumes", async () => {
  const current = voiceFixture()
  assert.equal((await current.route.POST(current.request())).status, 502)
  assert.equal(current.row.blob_path, "")
  const pending = await current.route.GET(new Request(`https://fixture.invalid/api/ops/transcribe?id=${id}`, { headers: { "x-voice-operator-scope": scope } }))
  const state = await pending.json()
  assert.equal(state.uploadRequired, true)
  assert.equal("blob_path" in state, false)
  assert.equal(pending.headers.get("cache-control"), "private, no-store")
  assert.equal(current.effects.transcriptions, 0)
  current.restore()
  await current.retry()
  assert.deepEqual(current.effects.transcripts, ["Recovered words"])
  assert.equal(current.effects.posts, 1)
  assert.equal(current.effects.uploads, 2, "one initial refusal and one recovery upload")
  assert.equal(current.effects.transcriptions, 1)
  assert.equal(current.effects.deleted, 1, "device bytes clear only after transcript handoff")
})

test("a continuing storage failure retries once and retains the recording without claiming success", async () => {
  const current = voiceFixture()
  await current.retry()
  assert.equal(current.effects.posts, 1)
  assert.equal(current.effects.transcriptions, 0)
  assert.equal(current.effects.deleted, 0)
  assert.equal(current.storage.size, 1)
  assert.equal(current.effects.transcripts.length, 0)
  assert.match(current.effects.errors.join(" "), /suspended/i)
  assert.doesNotMatch(current.effects.errors.join(" "), /safely filed/i)
})

test("a retained recording recreates a missing intent after a 404 without duplicating provider work", async () => {
  const current = voiceFixture({ existing: false })
  const missing = await current.route.GET(new Request(`https://fixture.invalid/api/ops/transcribe?id=${id}`, { headers: { "x-voice-operator-scope": scope } }))
  assert.equal(missing.status, 404)
  current.restore()
  await current.retry()
  assert.deepEqual(current.effects.transcripts, ["Recovered words"])
  assert.equal(current.effects.posts, 1)
  assert.equal(current.effects.uploads, 1)
  assert.equal(current.effects.transcriptions, 1)
  assert.equal(current.effects.deleted, 1)
  assert.equal(current.storage.size, 0)
})

test("an intent without stored audio or retained bytes never claims it can finish in the background", async () => {
  const current = voiceFixture({ retained: false })
  await current.retry()
  assert.equal(current.effects.posts, 0)
  assert.match(current.effects.errors.join(" "), /has not reached storage/i)
  assert.doesNotMatch(current.effects.errors.join(" "), /safely filed|still saved on this phone/i)
})

test("completed voice recovery does not upload or transcribe again", async () => {
  const current = voiceFixture({ completed: true })
  await current.retry()
  assert.deepEqual(current.effects.transcripts, ["Recovered words"])
  assert.equal(current.effects.posts, 0)
  assert.equal(current.effects.uploads, 0)
  assert.equal(current.effects.transcriptions, 0)
})

test("another operator's retained audio cannot be resubmitted", async () => {
  const current = voiceFixture({ savedScope: "operator:3:crew" })
  await current.retry()
  assert.equal(current.effects.posts, 0)
  assert.equal(current.effects.deleted, 0)
  assert.match(current.effects.errors.join(" "), /will not be sent automatically/)
})

test("a failed closeout photo can retry the identical file without retaking it or filing false success", async () => {
  const hook = hooks()
  const uploads = []
  let filed = 0
  const api = load("app/ops/leads/[id]/closeout-photo-input.tsx", {
    react: hook.react, "react/jsx-runtime": jsx,
    "@vercel/blob/client": { upload: async (_path, file) => {
      uploads.push(file)
      if (uploads.length === 1) throw new Error("Blob store suspended")
    } },
  })
  const render = (leadId = 7, mode = "addendum") => { hook.reset(); return elements(api.CloseoutPhotoInput({ leadId, mode, onUploaded: () => { filed++ } })) }
  let tree = render()
  const receipt = { value: "" }
  tree.find((node) => node.props?.type === "hidden").props.ref.current = receipt
  const file = new File(["synthetic pixels"], "fixture.jpg", { type: "image/jpeg" })
  tree.find((node) => node.props?.type === "file").props.onChange({ currentTarget: { files: [file], value: "fixture.jpg" } })
  await new Promise(setImmediate)
  tree = render()
  assert.equal(filed, 0)
  assert.equal(receipt.value, "")
  assert.match(tree.find((node) => node.type === "small").props.children, /storage is temporarily unavailable.*Keep this page open/)
  for (const [leadId, mode] of [[8, "addendum"], [7, "completion"]]) {
    assert.equal(render(leadId, mode).some((node) => node.type === "button" && node.props.children === "Retry photo"), false, "retained photo must not transfer to another job or workflow")
  }
  tree = render()
  tree.find((node) => node.type === "button" && node.props.children === "Retry photo").props.onClick()
  await new Promise(setImmediate)
  tree = render()
  assert.equal(uploads[0], file)
  assert.equal(uploads[1], file)
  assert.equal(filed, 1)
  assert.ok(receipt.value)
  assert.equal(tree.some((node) => node.type === "button" && node.props.children === "Retry photo"), false)
})
