import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import ts from "typescript"
import {
  CHAT_DRAFT_STORAGE_KEY, CHAT_STORAGE_KEY, CHAT_MESSAGE_LIMIT,
  newChatSession, prepareChatRequest, readChatDraft, readChatSession, writeChatDraft, writeChatSession,
} from "../lib/assistant/chat-client.ts"

const nativeRequire = createRequire(import.meta.url)
const sessionId = "f25a71b1-34a5-4f89-a7b2-e1930b812ef8"
const props = { phoneHref: "tel:+16157033296", phoneDisplay: "(615) 703-3296" }
const storage = () => {
  const values = new Map()
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

function chat(storage, request = async () => { throw new Error("fixture must opt in to a request") }) {
  const states = [], refs = [], effects = []
  let stateIndex = 0, refIndex = 0, effectIndex = 0, tree
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]))
  const react = {
    useState(initial) {
      const index = stateIndex++
      if (!(index in states)) states[index] = initial
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value }]
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial } },
    useCallback: (callback) => callback,
    useEffect(effect, deps) {
      const index = effectIndex++, previous = effects[index]
      if (!previous || !same(previous.deps, deps)) effects[index] = { effect, deps, cleanup: previous?.cleanup, pending: true }
    },
  }
  class Element { isConnected = true; focus() {}; scrollIntoView() {} }
  const document = { activeElement: new Element(), body: new Element() }
  const browser = new EventTarget()
  browser.sessionStorage = storage
  const fakes = {
    react, "next/navigation": { usePathname: () => "/" },
    "@/lib/assistant/chat-client.ts": nativeRequire("../lib/assistant/chat-client.ts"),
    "@/lib/assistant/contact.ts": nativeRequire("../lib/assistant/contact.ts"),
    "./assistant-chat.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  }
  const code = ts.transpileModule(readFileSync(new URL("../components/assistant-chat.tsx", import.meta.url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const context = vm.createContext({
    window: browser, document, HTMLElement: Element, crypto: { randomUUID: () => sessionId }, AbortSignal, fetch: request,
    process: { env: { NEXT_PUBLIC_ASSISTANT_CHAT: "1" } }, require: (name) => Object.hasOwn(fakes, name) ? fakes[name] : nativeRequire(name),
  })
  vm.runInContext(`(function(exports, require, module) { ${code}\n})`, context)(loaded.exports, context.require, loaded)
  function find(element, predicate) {
    if (!element || typeof element !== "object") return
    if (predicate(element)) return element
    for (const child of React.Children.toArray(element.props?.children)) {
      const found = find(child, predicate)
      if (found) return found
    }
  }
  function attach(element) {
    if (!element || typeof element !== "object") return
    if (element.props?.ref && typeof element.props.ref === "object" && !element.props.ref.current) {
      element.props.ref.current = element.type === "dialog" ? { open: false, showModal() { this.open = true }, close() { this.open = false } } : new Element()
    }
    React.Children.forEach(element.props?.children, attach)
  }
  function render() {
    stateIndex = refIndex = effectIndex = 0
    tree = loaded.exports.AssistantChat(props)
    while (typeof tree?.type === "function") tree = tree.type(tree.props)
    attach(tree)
    for (const effect of effects) if (effect.pending) {
      effect.cleanup?.()
      effect.cleanup = effect.effect()
      effect.pending = false
    }
    return tree
  }
  render()
  return {
    open() { find(tree, (element) => element.type === "button" && element.props["aria-controls"] === "shop-assistant").props.onClick(); render() },
    type(value) { find(tree, (element) => element.type === "textarea").props.onChange({ target: { value } }); render() },
    close() { find(tree, (element) => element.props?.["aria-label"] === "Close shop assistant").props.onClick(); render() },
    async send() { await find(tree, (element) => element.type === "form").props.onSubmit({ preventDefault() {} }); render() },
    get draft() { return find(tree, (element) => element.type === "textarea").props.value },
    get readOnly() { return find(tree, (element) => element.type === "textarea").props.readOnly },
    unmount() { effects.forEach((effect) => effect.cleanup?.()) },
  }
}

test("draft storage is separate, capped and safe with denied or malformed storage", () => {
  const store = storage()
  writeChatSession(store, newChatSession(sessionId))
  const protocol = store.getItem(CHAT_STORAGE_KEY)
  writeChatDraft(store, "x".repeat(CHAT_MESSAGE_LIMIT + 50))
  assert.notEqual(CHAT_DRAFT_STORAGE_KEY, CHAT_STORAGE_KEY)
  assert.equal(readChatDraft(store).length, CHAT_MESSAGE_LIMIT)
  assert.equal(store.getItem(CHAT_STORAGE_KEY), protocol)
  for (const raw of ["not json", "null", JSON.stringify({ draft: 123 }), JSON.stringify({ draft: "x".repeat(2001) }), "x".repeat(14001)]) {
    store.setItem(CHAT_DRAFT_STORAGE_KEY, raw)
    assert.equal(readChatDraft(store), "")
    assert.equal(readChatSession(store, () => assert.fail("draft corruption must not reset the session")).id, sessionId)
  }
  const denied = { getItem() { throw new Error("denied") }, setItem() { throw new Error("quota") } }
  assert.equal(readChatDraft(denied), "")
  assert.equal(readChatDraft(null), "")
  assert.doesNotThrow(() => writeChatDraft(denied, "Gate details"))
  writeChatDraft(store, "48 inch gate, $500 budget. Call 615-555-0123.")
  assert.doesNotMatch(store.getItem(CHAT_DRAFT_STORAGE_KEY), /\$500/)
  assert.match(readChatDraft(store), /48 inch gate/)
  assert.match(readChatDraft(store), /615-555-0123/)
})

test("typed text survives a full chat remount and clears only after a confirmed reply", async () => {
  const store = storage()
  let requests = 0
  const first = chat(store)
  first.open()
  first.type("Repair the driveway gate in Lebanon")
  assert.equal(store.getItem(CHAT_STORAGE_KEY), null, "typing must not create a protocol turn")
  first.unmount()
  const restored = chat(store, async () => {
    requests++
    return { ok: true, json: async () => ({ ok: true, reply: "Send the location and a photo." }) }
  })
  restored.open()
  assert.equal(requests, 0, "restoring a draft must never send it")
  assert.equal(restored.draft, "Repair the driveway gate in Lebanon")
  await restored.send()
  assert.equal(requests, 1)
  assert.equal(readChatDraft(store), "")
  assert.equal(restored.draft, "")
  assert.equal(readChatSession(store, () => assert.fail()).nextTurn, 1)
  restored.unmount()
  const afterReply = chat(store)
  afterReply.open()
  assert.equal(afterReply.draft, "")
  afterReply.unmount()
})

test("pending retries take precedence over a separate draft and reuse the same request identity", async () => {
  const store = storage()
  const pending = prepareChatRequest(newChatSession(sessionId), "Original gate repair")
  writeChatSession(store, pending.session)
  writeChatDraft(store, "A later unsent draft")
  const sent = []
  const failed = chat(store, async (_, request) => { sent.push(JSON.parse(request.body)); throw new Error("fixture network failure") })
  failed.open()
  assert.equal(failed.draft, "Original gate repair")
  assert.equal(failed.readOnly, true)
  await failed.send()
  assert.equal(readChatDraft(store), "A later unsent draft", "an unconfirmed response must not clear typing")
  failed.unmount()
  const retry = chat(store, async (_, request) => {
    sent.push(JSON.parse(request.body))
    return { ok: true, json: async () => ({ ok: true, reply: "We have the gate details." }) }
  })
  retry.open()
  assert.equal(sent.length, 1, "opening the retry must not issue another request")
  await retry.send()
  assert.deepEqual(sent[0], pending.payload)
  assert.deepEqual(sent[1], pending.payload)
  assert.equal(readChatSession(store, () => assert.fail()).nextTurn, 1)
  assert.equal(readChatDraft(store), "")
  retry.unmount()
})

test("denied storage still preserves an unsent draft while the loaded chat stays mounted", () => {
  const denied = { getItem() { throw new Error("denied") }, setItem() { throw new Error("quota") } }
  const current = chat(denied)
  current.open()
  current.type("Keep these gate dimensions")
  current.close()
  current.open()
  assert.equal(current.draft, "Keep these gate dimensions")
  current.unmount()
})
