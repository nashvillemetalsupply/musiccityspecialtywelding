import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import * as outbox from "../app/ops/voice-outbox-client.ts"

const scope = "operator:2:owner"
const recoveryKey = "done:7"
const fixtureId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
const blob = new Blob(["[INTERNAL TEST] synthetic sound"], { type: "audio/webm" })
function fixture({ records = [], pointer = null, localFails = false, pointerFails = false, suspended = true, uploadRequired = false, archiveFails = false } = {}) {
  const rows = new Map(records.map((row) => [row.id, { ...row }]))
  const storage = new Map(pointer ? [[outbox.scopedVoiceStorageKey(scope, recoveryKey), pointer]] : [])
  const effects = { posts: 0, postedHeaders: [], polls: 0, saves: 0, deleted: 0, transcripts: [], errors: [], busyChanges: [], constraints: null, recorderOptions: null }
  const values = [], pendingEffects = [], timers = new Map(), listeners = new Map()
  let cursor = 0, dirty = true, tree, now = 0, timerId = 0, failed = localFails, failedArchive = archiveFails, blocked = suspended, currentScope = scope, currentKey = recoveryKey, requiresUpload = uploadRequired
  const same = (before, after) => before && after && before.length === after.length && before.every((v, index) => Object.is(v, after[index]))
  const react = {
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values[index], (next) => { const value = typeof next === "function" ? next(values[index]) : next; if (!Object.is(value, values[index])) { values[index] = value; dirty = true } }] },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index] },
    useCallback(fn, deps) { const index = cursor++; if (!same(values[index]?.deps, deps)) values[index] = { fn, deps }; return values[index].fn },
    useEffect(fn, deps) { const index = cursor++; if (!same(values[index]?.deps, deps)) { const previous = values[index]; values[index] = { deps, cleanup: previous?.cleanup }; pendingEffects.push(() => { previous?.cleanup?.(); values[index].cleanup = fn() }) } },
  }
  const indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = { close() {}, transaction() {
    const transaction = { objectStore() { return {
      get(id) { const read = {}; queueMicrotask(() => { read.result = rows.get(id); read.onsuccess?.() }); return read },
      getAll() { const read = {}; queueMicrotask(() => { read.result = [...rows.values()]; read.onsuccess?.() }); return read },
      put(row) { effects.saves++; queueMicrotask(() => { if (failed || (row.archivedAt && failedArchive)) { transaction.error = new Error("Local storage is full"); transaction.onerror?.() } else { rows.set(row.id, structuredClone(row)); transaction.oncomplete?.() } }) },
      delete() { effects.deleted++; queueMicrotask(() => transaction.oncomplete?.()) },
    } } }; return transaction }, objectStoreNames: { contains: () => true } }; request.onsuccess?.() }); return request } }
  const window = {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem(key, value) { if (pointerFails) throw new Error("localStorage denied"); storage.set(key, value) }, removeItem: (key) => storage.delete(key) },
    setTimeout(fn, delay = 0) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id }, clearTimeout: (id) => timers.delete(id),
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
  }
  class FakeRecorder {
    state = "inactive"; mimeType = "audio/webm"
    constructor(_stream, options) { effects.recorderOptions = options }
    start() { this.state = "recording"; effects.recording = true }
    stop() { this.state = "inactive"; effects.recording = false; this.ondataavailable?.({ data: blob }); this.onstop?.() }
  }
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} }
  const context = vm.createContext({ Blob, Error, Date, crypto: { randomUUID: () => fixtureId }, indexedDB, window, document,
    navigator: { mediaDevices: { getUserMedia: async (constraints) => { effects.constraints = constraints; return { getTracks: () => [{ stop() {} }] } } } }, MediaRecorder: FakeRecorder,
    fetch: async (url, options = {}) => {
      if (url.includes("cache-session")) return Response.json({ voiceScope: scope })
      if (options.method === "POST") { effects.posts++; effects.postedHeaders.push(options.headers); if (!blocked) requiresUpload = false; return blocked ? Response.json({ error: "Blob suspended", retryable: true }, { status: 503 }) : Response.json({ transcript: "Recovered words", intentId: fixtureId }) }
      effects.polls++; return blocked || requiresUpload ? Response.json({ uploadRequired: true, status: "failed", last_error: "Blob suspended" }) : Response.json({ status: "completed", transcript: "Recovered words" })
    },
  })
  const output = ts.transpileModule(readFileSync(new URL("../app/ops/voice-capture-button.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const loaded = { exports: {} }
  vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, (name) => {
    if (name === "react") return react
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" }
    if (name === "./voice-outbox-client") return { ...outbox, readCurrentVoiceScope: async () => currentScope }
    throw new Error(`Unexpected import ${name}`)
  }, loaded)
  const busyChanged = (value) => effects.busyChanges.push(value)
  const render = () => { cursor = 0; dirty = false; tree = loaded.exports.VoiceCaptureButton({ available: true, recoveryKey: currentKey, onBusyChange: busyChanged, onTranscript: (value) => effects.transcripts.push(value), onError: (value) => { if (value) effects.errors.push(value) } }); while (pendingEffects.length) pendingEffects.shift()() }
  async function flush() { for (let step = 0; step < 20; step++) { if (dirty) render(); await new Promise(setImmediate) } }
  async function advance(milliseconds) { const end = now + milliseconds; for (let count = 0; count < 100; count++) { const next = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush() } now = end; await flush() }
  return { rows, storage, effects, timers, flush, advance, get tree() { return tree }, restore() { blocked = false }, allowLocalSave() { failed = false }, allowArchiveSave() { failedArchive = false }, switchScope(value) { currentScope = value }, switchKey(value) { currentKey = value; dirty = true }, unmount() { for (const value of values) value?.cleanup?.() }, async record() { await flush(); tree.props.onClick({ detail: 0 }); await flush(); assert.equal(effects.recording, true); tree.props.onClick({ detail: 0 }); await flush() }, async online() { for (const fn of listeners.get("online") ?? []) fn(); await flush() } }
}
const saved = (extras = {}) => ({ id: fixtureId, scope, recoveryKey, contentType: blob.type, blob, ...extras })

test("voice reload discovers queued IDB bytes without a localStorage pointer and retries automatically", async () => {
  const current = fixture({ records: [saved()], suspended: false })
  await current.flush(); await current.advance(5000)
  assert.deepEqual(current.effects.transcripts, ["Recovered words"])
  assert.equal(current.effects.posts, 0, "polling a completed intent must never upload again")
  assert.ok(current.rows.get(fixtureId).archivedAt)
  assert.equal(current.effects.deleted, 0)
})

test("quota refusal preserves voice bytes and schedules later retries while the page stays open", async () => {
  const current = fixture({ records: [saved()], pointer: fixtureId })
  await current.flush(); await current.advance(200000)
  assert.ok(current.effects.posts > 1, "failed recovery must retry beyond one short polling cycle")
  assert.equal(current.effects.deleted, 0)
  assert.equal(current.rows.get(fixtureId).blob.size, blob.size)
  assert.match(current.effects.errors.join(" "), /saved.*will upload/i)
  current.restore(); await current.online(); await current.advance(5000)
  assert.deepEqual(current.effects.transcripts, ["Recovered words"])
  assert.ok(current.rows.get(fixtureId).archivedAt)
})

test("archived voice captures and other operators' captures never replay", async () => {
  for (const row of [saved({ archivedAt: "2026-10-30T00:00:00Z" }), saved({ scope: "operator:9:crew" })]) {
    const current = fixture({ records: [row], pointer: fixtureId, suspended: false })
    await current.flush(); await current.advance(5000)
    assert.equal(current.effects.posts, 0)
    assert.deepEqual(current.effects.transcripts, [])
    assert.equal(current.rows.size, 1)
  }
})

test("voice capture caps audio bitrate and retains bytes for local-save retry before any upload", async () => {
  const current = fixture({ localFails: true })
  await current.record()
  assert.equal(current.effects.recorderOptions?.audioBitsPerSecond, 32000)
  assert.equal(current.effects.constraints.audio.channelCount, 1)
  assert.equal(current.effects.posts, 0)
  assert.match(current.effects.errors.join(" "), /not saved.*keep this page open/i)
  current.allowLocalSave(); current.restore(); await current.online(); await current.advance(5000)
  assert.ok(current.rows.has(fixtureId), "in-memory capture must be retried into IndexedDB")
  assert.deepEqual(current.effects.transcripts, ["Recovered words"])
})

test("localStorage failure cannot discard an already durable voice capture", async () => {
  const current = fixture({ pointerFails: true, suspended: false })
  await current.record(); await current.advance(5000)
  assert.ok(current.rows.has(fixtureId))
  assert.deepEqual(current.effects.transcripts, ["Recovered words"])
  assert.equal(current.effects.deleted, 0)
})

test("multiple retained voice captures recover one by one without orphaning an overwritten pointer", async () => {
  const secondId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
  const current = fixture({ records: [saved(), saved({ id: secondId })], pointer: secondId, suspended: false })
  await current.flush(); await current.advance(40000)
  assert.equal(current.effects.transcripts.length, 2)
  assert.ok(current.rows.get(fixtureId).archivedAt)
  assert.ok(current.rows.get(secondId).archivedAt)
  assert.equal(current.effects.posts, 0)
})

test("unmount cancels queued recovery before any upload or transcript callback", async () => {
  const current = fixture({ records: [saved()], pointer: fixtureId })
  await current.flush()
  current.unmount()
  await current.advance(200000)
  assert.equal(current.effects.posts, 0)
  assert.deepEqual(current.effects.transcripts, [])
  assert.equal(current.rows.get(fixtureId).archivedAt, undefined)
})

test("an identity or job change cannot upload or apply an older capture", async () => {
  for (const change of [(current) => current.switchScope("operator:9:crew"), (current) => current.switchKey("done:8")]) {
    const current = fixture({ records: [saved()], pointer: fixtureId, suspended: false })
    await current.flush()
    change(current)
    await current.flush(); await current.advance(200000)
    assert.equal(current.effects.posts, 0)
    assert.deepEqual(current.effects.transcripts, [])
    assert.equal(current.rows.get(fixtureId).archivedAt, undefined)
  }
})

test("unsaved voice blocks parent completion until IDB commits even when provider storage remains suspended", async () => {
  const current = fixture({ localFails: true })
  await current.record()
  assert.equal(current.effects.busyChanges.at(-1), true, "a parent save must not unmount the only in-memory recording")
  assert.equal(current.rows.size, 0)
  current.allowLocalSave()
  await current.online(); await current.advance(10000)
  assert.equal(current.rows.get(fixtureId).blob.size, blob.size)
  assert.equal(current.effects.transcripts.length, 0, "provider storage is still suspended")
  assert.equal(current.effects.busyChanges.at(-1), false, "durable queueing releases parent save while upload waits")
})

test("done voice recovers this job's queued closeout capture using its original intent and recovery key", async () => {
  for (const uploadRequired of [true, false]) {
    const current = fixture({ records: [saved({ recoveryKey: "closeout:7" })], suspended: false, uploadRequired })
    await current.flush(); await current.advance(10000)
    assert.deepEqual(current.effects.transcripts, ["Recovered words"])
    assert.ok(current.rows.get(fixtureId).archivedAt)
    assert.equal(current.rows.get(fixtureId).recoveryKey, "closeout:7")
    assert.equal(current.effects.posts, uploadRequired ? 1 : 0, "already stored/completed recordings must not re-upload")
    if (uploadRequired) {
      assert.equal(current.effects.postedHeaders[0]["X-Voice-Intent-Id"], fixtureId)
      assert.equal(current.effects.postedHeaders[0]["X-Voice-Recovery-Key"], "closeout:7")
    }
  }
})

test("done voice cannot recover another job's closeout or an unrelated workflow capture", async () => {
  for (const key of ["closeout:8", "spike:7:primary", "closeout:7:other"]) {
    const current = fixture({ records: [saved({ recoveryKey: key })], suspended: false, uploadRequired: true })
    await current.flush(); await current.advance(10000)
    assert.equal(current.effects.posts, 0)
    assert.deepEqual(current.effects.transcripts, [])
    assert.equal(current.rows.get(fixtureId).archivedAt, undefined)
  }
})

test("archive write refusal retries retention cleanup without handing off the transcript twice", async () => {
  const current = fixture({ records: [saved()], pointer: fixtureId, suspended: false, archiveFails: true })
  await current.flush(); await current.advance(10000)
  assert.deepEqual(current.effects.transcripts, ["Recovered words"])
  assert.equal(current.rows.get(fixtureId).archivedAt, undefined)
  assert.equal(current.rows.get(fixtureId).blob.size, blob.size)
  await current.advance(60000)
  assert.deepEqual(current.effects.transcripts, ["Recovered words"], "same mounted callback must not append words or repeat an action")
  current.allowArchiveSave()
  await current.online(); await current.advance(10000)
  assert.ok(current.rows.get(fixtureId).archivedAt)
  assert.deepEqual(current.effects.transcripts, ["Recovered words"])
  assert.equal(current.effects.posts, 0)
  assert.equal(current.effects.deleted, 0)
})
