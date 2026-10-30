import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

const scope = "operator:2:owner"
const fixture = new File(["synthetic photo pixels"], "fixture.jpg", { type: "image/jpeg" })
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" }
const elements = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(elements)]

function load(file, dependencies, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext(`(function(exports, require, module) { ${source}\n})`, { Blob, File, Error, Date, crypto, URL, URLSearchParams, Response, ...globals })(loaded.exports, name => {
    assert.ok(name in dependencies, `Unexpected import ${name}`)
    return dependencies[name]
  }, loaded)
  return loaded.exports
}

function photoFixture({ saved = new Map(), identity = scope, localFailure = false, restored = false } = {}) {
  const state = { identity, identityFailure: false, restored, localFailure, uploads: [], statuses: [], notified: 0, saved, busy: [], timers: [], listeners: new Map(), attached: false, responseLost: false }
  let cursor = 0
  const hooks = []
  const effects = []
  const react = {
    useId: () => "photo-fixture",
    useRef: initial => { const index = cursor++; return hooks[index] ??= { current: initial } },
    useState: initial => { const index = cursor++; hooks[index] ??= typeof initial === "function" ? initial() : initial; return [hooks[index], value => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value }] },
    useCallback: fn => fn,
    useEffect: (fn, deps) => { const index = cursor++; const old = hooks[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) { hooks[index] = { deps }; effects.push(() => { old?.cleanup?.(); hooks[index].cleanup = fn() }) } },
  }
  const outbox = {
    readPhotoIntents: async (currentScope, leadId, mode) => [...saved.values()].filter(row => row.scope === currentScope && row.leadId === leadId && row.mode === mode && row.state !== "archived"),
    savePhotoIntent: async row => { if (state.localFailure) throw new Error("Device storage full"); saved.set(row.id, structuredClone(row)) },
    queuePhotoCapture: async (file, currentScope, leadId, mode) => {
      if (state.localFailure) throw new Error("Device storage full")
      const existing = [...saved.values()].find(row => row.scope === currentScope && row.leadId === leadId && row.mode === mode)
      if (existing) return existing
      const row = { id: crypto.randomUUID(), scope: currentScope, leadId, mode, original: file, originalName: file.name, file, filename: file.name, contentType: file.type, prepared: false, state: "queued", attempts: 0, nextAttemptAt: 0, createdAt: Date.now() }
      saved.set(row.id, structuredClone(row))
      return row
    },
  }
  const api = load("app/ops/leads/[id]/closeout-photo-input.tsx", {
    react, "react/jsx-runtime": jsx,
    "../../voice-outbox-client": { readCurrentVoiceScope: async () => { if (state.identityFailure) throw new Error("offline"); return state.identity }, offlineRecordingScope: (_error, last) => last || null },
    "../../photo-outbox-client": outbox,
    "../../photo-media-client": { prepareCloseoutImage: async (file, name) => ({ file, filename: name, contentType: file.type }) },
    "@vercel/blob/client": { upload: async (pathname, file, options) => {
      assert.ok(saved.size, "bytes must be durably saved before provider upload")
      state.uploads.push({ pathname, file, options })
      if (!state.restored) throw new Error("Blob store suspended")
      if (state.responseLost) { state.responseLost = false; state.ready = true; throw new Error("Upload response lost") }
      state.ready = true
    } },
  }, {
    navigator: {}, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    window: { addEventListener: (event, callback) => state.listeners.set(event, callback), removeEventListener: event => state.listeners.delete(event), setTimeout: callback => { state.timers.push(callback); return state.timers.length }, clearTimeout() {} },
    fetch: async (url, options) => { state.statuses.push({ url, options }); return Response.json({ uploadRequired: !state.ready, ready: Boolean(state.ready), attached: state.attached }) },
  })
  const receipt = { value: "" }
  const render = (leadId = 7, mode = "addendum") => {
    cursor = 0
    const tree = elements(api.CloseoutPhotoInput({ leadId, mode, onUploaded: () => { state.notified++ }, onBusyChange: value => state.busy.push(value) }))
    tree.find(node => node.props?.type === "hidden").props.ref.current = receipt
    for (const effect of effects.splice(0)) effect()
    return tree
  }
  const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(setImmediate) }
  const select = async (leadId = 7, mode = "addendum") => { render(leadId, mode); await flush(); const tree = render(leadId, mode); tree.find(node => node.props?.type === "file").props.onChange({ currentTarget: { files: [fixture], value: fixture.name } }); await flush(); return render(leadId, mode) }
  const retry = async () => { const tree = render(); tree.find(node => node.type === "button" && node.props.children === "Retry photo")?.props.onClick(); await flush(); return render() }
  return { state, render, receipt, select, retry, flush, unmount: () => hooks.forEach(hook => hook?.cleanup?.()) }
}

test("quota-suspended photo survives a remount and retries the same durable receipt", async () => {
  const first = photoFixture()
  let tree = await first.select()
  assert.equal(first.state.saved.size, 1, "capture must survive leaving this page")
  assert.equal(first.receipt.value, "")
  assert.equal(first.state.notified, 0)
  assert.match(tree.find(node => node.type === "small").props.children, /saved on this device.*will upload/i)
  const original = [...first.state.saved.values()][0]
  first.unmount()
  const second = photoFixture({ saved: first.state.saved, restored: true })
  second.render()
  await second.flush()
  tree = await second.retry()
  assert.equal(second.receipt.value, original.id)
  assert.equal(second.state.uploads.length, 1)
  assert.equal(second.state.uploads[0].pathname, first.state.uploads[0].pathname)
  assert.equal(second.state.notified, 1)
  assert.equal(second.state.saved.get(original.id).original.size, fixture.size)
})

test("lost provider response reconciles stored photo instead of uploading again", async () => {
  const current = photoFixture({ restored: true })
  current.state.responseLost = true
  await current.select()
  await current.retry()
  assert.equal(current.state.uploads.length, 1)
  assert.equal(current.state.notified, 1)
  assert.ok(current.receipt.value)
})

test("local persistence failure never uploads or claims that a capture was saved", async () => {
  const current = photoFixture({ localFailure: true, restored: true })
  const tree = await current.select()
  assert.equal(current.state.uploads.length, 0)
  assert.equal(current.state.saved.size, 0)
  assert.match(tree.find(node => node.type === "small").props.children, /not saved|could not save/i)
  assert.equal(tree.find(node => node.props?.type === "file").props.disabled, true)
  assert.equal(current.state.busy.at(-1), true, "the closeout cannot unmount an unsaved raw capture")
})

test("a capture retained after local save failure retries saving automatically before any upload", async () => {
  const current = photoFixture({ localFailure: true, restored: true })
  await current.select()
  current.state.localFailure = false
  current.state.listeners.get("online")()
  await current.flush()
  assert.equal(current.state.saved.size, 1)
  assert.equal(current.state.uploads.length, 1)
  assert.equal(current.state.uploads[0].options.multipart, false)
  assert.equal(JSON.parse(current.state.uploads[0].options.clientPayload).operatorScope, scope)
  assert.equal(current.state.notified, 1)
  assert.equal([...current.state.saved.values()][0].original.size, fixture.size)
  assert.equal(current.state.busy.at(-1), false, "filing resumes only after the capture is durable")
})

test("photo capture waits for a verified mounted-page identity without blocking other form fields", async () => {
  const current = photoFixture()
  current.state.identityFailure = true
  current.render()
  await current.flush()
  assert.equal(current.render().find(node => node.props?.type === "file").props.disabled, true)
  assert.equal(current.state.busy.some(Boolean), false)
  assert.equal(current.state.saved.size, 0)
  current.state.identityFailure = false
  current.state.listeners.get("online")()
  await current.flush()
  assert.equal(current.render().find(node => node.props?.type === "file").props.disabled, false)
})

test("another identity cannot display or retry a saved photo", async () => {
  const current = photoFixture()
  await current.select()
  current.unmount()
  const other = photoFixture({ saved: current.state.saved, identity: "operator:3:crew", restored: true })
  const tree = other.render()
  await other.flush()
  assert.equal(other.state.uploads.length, 0)
  assert.equal(other.receipt.value, "")
  assert.equal(tree.some(node => node.type === "button" && node.props.children === "Retry photo"), false)
})

test("a filed photo is archived with original bytes intact", async () => {
  const current = photoFixture({ restored: true })
  await current.select()
  current.state.attached = true
  await current.retry()
  const row = [...current.state.saved.values()][0]
  assert.equal(row.state, "archived")
  assert.equal(row.original.size, fixture.size)
  assert.equal(current.state.uploads.length, 1)
})

test("a completion capture follows its completed job into addendum without changing its receipt", async () => {
  const before = photoFixture()
  await before.select(7, "completion")
  const original = [...before.state.saved.values()][0]
  assert.equal(original.mode, "completion")
  before.unmount()
  const after = photoFixture({ saved: before.state.saved, restored: true })
  after.render(7, "addendum")
  await after.flush()
  await after.retry()
  assert.equal(after.receipt.value, original.id)
  const payload = JSON.parse(after.state.uploads[0].options.clientPayload)
  assert.equal(payload.mode, "completion")
  assert.equal(payload.uploadId, original.id)
  assert.equal(after.state.uploads[0].pathname, before.state.uploads[0].pathname)
})

test("compression bounds dimensions and chooses the smallest encoded payload at capped quality", async () => {
  const dimensions = []
  const encodings = []
  let closed = false
  const canvas = { getContext: () => ({ drawImage: (_image, _x, _y, width, height) => dimensions.push({ width, height }) }), toBlob: (callback, type, quality) => { encodings.push({ type, quality }); callback(new Blob(["x".repeat(type === "image/webp" ? 30 : 50)], { type })) } }
  const api = load("app/ops/photo-media-client.ts", {}, { createImageBitmap: async () => ({ width: 4000, height: 3000, close: () => { closed = true } }), document: { createElement: () => canvas } })
  const original = new Blob(["x".repeat(200)], { type: "image/jpeg" })
  const prepared = await api.prepareCloseoutImage(original, "original.jpg")
  assert.deepEqual(dimensions, [{ width: 1600, height: 1200 }])
  assert.equal(prepared.file.size, 30)
  assert.equal(prepared.contentType, "image/webp")
  assert.equal(prepared.filename, "original.webp")
  assert.ok(encodings.every(encoding => encoding.quality === 0.78))
  assert.equal(original.size, 200)
  assert.equal(closed, true)
})

test("compression retains unsupported, undecodable and already-small original images", async () => {
  const api = load("app/ops/photo-media-client.ts", {}, { createImageBitmap: async () => { throw new Error("cannot decode") } })
  for (const type of ["image/heic", "image/jpeg"]) {
    const original = new Blob(["original"], { type })
    assert.equal((await api.prepareCloseoutImage(original, "original.heic")).file, original)
  }
  const canvas = { getContext: () => ({ drawImage() {} }), toBlob: (callback, type) => callback(new Blob(["larger encoded payload"], { type })) }
  const smaller = load("app/ops/photo-media-client.ts", {}, { createImageBitmap: async () => ({ width: 10, height: 10, close() {} }), document: { createElement: () => canvas } })
  const original = new Blob(["small"], { type: "image/jpeg" })
  assert.equal((await smaller.prepareCloseoutImage(original, "small.jpg")).file, original)
})

function memoryIndexedDb({ failWrites = false } = {}) {
  const rows = new Map()
  return { rows, indexedDB: { open: () => {
    const open = {}
    queueMicrotask(() => {
      open.result = { close() {}, transaction: (_name, mode) => {
        const transaction = {}
        let staged
        let finished = false
        const finish = () => {
          if (finished) return
          finished = true
          if (failWrites && mode === "readwrite") { transaction.error = new Error("Device storage full"); transaction.onabort?.(); return }
          if (staged) rows.set(staged.id, staged)
          transaction.oncomplete?.()
        }
        transaction.objectStore = () => ({
          getAll: () => {
            const request = {}
            queueMicrotask(() => { request.result = [...rows.values()].map(row => structuredClone(row)); request.onsuccess?.(); queueMicrotask(finish) })
            return request
          },
          put: row => { staged = structuredClone(row); queueMicrotask(finish) },
        })
        return transaction
      } }
      open.onsuccess()
    })
    return open
  } } }
}

test("the actual photo outbox deduplicates identical bytes only within one identity, job and workflow", async () => {
  const storage = memoryIndexedDb()
  const api = load("app/ops/photo-outbox-client.ts", {}, { indexedDB: storage.indexedDB })
  const first = await api.queuePhotoCapture(fixture, scope, 7, "completion")
  assert.equal(first.contentHash.length, 64)
  assert.equal((await api.queuePhotoCapture(fixture, scope, 7, "completion")).id, first.id)
  assert.equal(storage.rows.size, 1)
  for (const [identity, job, mode] of [["operator:3:crew", 7, "completion"], [scope, 8, "completion"], [scope, 7, "addendum"]]) {
    assert.notEqual((await api.queuePhotoCapture(fixture, identity, job, mode)).id, first.id)
  }
  await api.savePhotoIntent({ ...first, state: "archived" })
  assert.equal((await api.readPhotoIntents(scope, 7, "completion")).length, 0)
  assert.equal((await api.queuePhotoCapture(fixture, scope, 7, "completion")).id, first.id)
  assert.equal(await storage.rows.get(first.id).original.text(), await fixture.text())
})

test("the actual photo outbox rejects aborted durable saves", async () => {
  const storage = memoryIndexedDb({ failWrites: true })
  const api = load("app/ops/photo-outbox-client.ts", {}, { indexedDB: storage.indexedDB })
  await assert.rejects(api.queuePhotoCapture(fixture, scope, 7, "completion"), /Device storage full/)
  assert.equal(storage.rows.size, 0)
})
