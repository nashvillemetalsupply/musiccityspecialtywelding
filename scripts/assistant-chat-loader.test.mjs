import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const nativeRequire = createRequire(import.meta.url)
const props = { phoneHref: "tel:+16157033296", phoneDisplay: "(615) 703-3296" }
const FakeChat = () => React.createElement("div", null, "Loaded automated shop assistant")
const settle = () => new Promise((resolve) => setImmediate(resolve))

function harness() {
  const states = [], refs = [], effects = [], callbacks = []
  let stateIndex = 0, refIndex = 0, effectIndex = 0, callbackIndex = 0, updates = 0
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const react = {
    useState(initial) {
      const index = stateIndex++
      if (!(index in states)) states[index] = initial
      return [states[index], (next) => { updates++; states[index] = typeof next === "function" ? next(states[index]) : next }]
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial } },
    useEffect(effect, deps) {
      const index = effectIndex++, previous = effects[index]
      if (!previous || !same(previous.deps, deps)) effects[index] = { effect, deps, cleanup: previous?.cleanup, pending: true }
    },
    useCallback(callback, deps) {
      const index = callbackIndex++
      if (!callbacks[index] || !same(callbacks[index].deps, deps)) callbacks[index] = { callback, deps }
      return callbacks[index].callback
    },
  }
  class FakeElement {
    isConnected = true
    focusCount = 0
    focus() { this.focusCount++ }
  }
  const opener = new FakeElement()
  const browser = new EventTarget()
  const dialog = { open: false, showModal() { this.open = true }, close() { this.open = false } }
  const globals = { window: browser, document: { activeElement: opener, body: new FakeElement() }, HTMLElement: FakeElement }
  function assignRefs(element) {
    if (!element || typeof element !== "object") return
    if (element.props?.ref && typeof element.props.ref === "object") element.props.ref.current = element.type === "dialog" ? dialog : new FakeElement()
    React.Children.forEach(element.props?.children, assignRefs)
  }
  return {
    react, globals, browser, opener,
    render(Component) {
      stateIndex = refIndex = effectIndex = callbackIndex = 0
      let element = Component(props)
      while (typeof element?.type === "function" && element.type !== FakeChat) element = element.type(element.props)
      assignRefs(element)
      for (const effect of effects) if (effect.pending) {
        effect.cleanup?.()
        effect.cleanup = effect.effect()
        effect.pending = false
      }
      return element
    },
    unmount() { effects.forEach((effect) => effect.cleanup?.()) },
    get updates() { return updates },
  }
}

function moduleExports(options = {}) {
  const { pathname = "/", hooks, load = async () => ({ AssistantChat: FakeChat }) } = options
  const flag = Object.hasOwn(options, "flag") ? options.flag : "1"
  const source = readFileSync(new URL("../components/assistant-chat-loader.tsx", import.meta.url), "utf8")
    .replace('() => import("./assistant-chat")', "() => loadChatModule()")
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const fakes = {
    react: hooks?.react ?? React,
    "next/navigation": { usePathname: () => pathname },
    "@/lib/assistant/contact.ts": nativeRequire("../lib/assistant/contact.ts"),
    "./assistant-chat.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  }
  const context = vm.createContext({ ...hooks?.globals, process: { env: { NEXT_PUBLIC_ASSISTANT_CHAT: flag } }, loadChatModule: load, require: (name) => Object.hasOwn(fakes, name) ? fakes[name] : nativeRequire(name) })
  vm.runInContext(`(function(exports, require, module) { ${code}\n})`, context)(loaded.exports, context.require, loaded)
  return loaded.exports
}

function find(element, predicate) {
  if (!element || typeof element !== "object") return undefined
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props?.children)) {
    const match = find(child, predicate)
    if (match) return match
  }
}

test("initial SSR keeps the launcher without importing or rendering the unused full chat", () => {
  let loads = 0
  const { AssistantChatLoader } = moduleExports({ load: async () => { loads++; return { AssistantChat: FakeChat } } })
  const html = renderToStaticMarkup(React.createElement(AssistantChatLoader, props))
  assert.match(html, /aria-controls="shop-assistant"[^>]*aria-expanded="false">Ask the shop/)
  assert.match(html, /id="shop-assistant" hidden=""/)
  assert.doesNotMatch(html, /<dialog|<textarea|role="log"/)
  assert.equal(loads, 0)
  for (const flag of [undefined, "", "0", "true"]) {
    const module = moduleExports({ flag })
    assert.equal(renderToStaticMarkup(React.createElement(module.AssistantChatLoader, props)), "")
  }
  for (const pathname of ["/ops", "/ops/leads/1", "/board", "/j/private", "/design-preview", null]) {
    const module = moduleExports({ pathname })
    assert.equal(renderToStaticMarkup(React.createElement(module.AssistantChatLoader, props)), "")
  }
})

test("the first Ask event loads once and opens immediately after the module is ready", async () => {
  const hooks = harness()
  let loads = 0, resolveModule
  const { AssistantChatLoader } = moduleExports({ hooks, load: () => { loads++; return new Promise((resolve) => { resolveModule = resolve }) } })
  const initial = hooks.render(AssistantChatLoader)
  hooks.browser.dispatchEvent(new Event("ms:open-assistant"))
  find(initial, (element) => element.type === "button").props.onClick()
  await settle()
  assert.equal(loads, 1, "repeated opens share the same pending module")
  const loadingHtml = renderToStaticMarkup(hooks.render(AssistantChatLoader))
  assert.match(loadingHtml, /role="status"/)
  assert.equal((loadingHtml.match(/href="tel:\+16157033296"/g) ?? []).length, 1, "the loading dialog keeps one immediate Call path")
  resolveModule({ AssistantChat: FakeChat })
  await settle()
  const ready = hooks.render(AssistantChatLoader)
  assert.equal(ready.type, FakeChat)
  assert.equal(ready.props.initialOpen, true)
  assert.equal(ready.props.initialFocus, hooks.opener)
  assert.equal(hooks.render(AssistantChatLoader).type, FakeChat, "loaded UI stays mounted across parent renders")
  hooks.unmount()
})

test("a failed module shows phone, form and email and the same first-open path retries", async () => {
  const hooks = harness()
  let loads = 0
  const { AssistantChatLoader } = moduleExports({ hooks, load: async () => { if (++loads === 1) throw new Error("fixture module failure"); return { AssistantChat: FakeChat } } })
  find(hooks.render(AssistantChatLoader), (element) => element.type === "button").props.onClick()
  await settle()
  const failed = hooks.render(AssistantChatLoader)
  const html = renderToStaticMarkup(failed)
  assert.match(html, /role="alert"/)
  assert.match(html, /href="tel:\+16157033296"/)
  assert.equal((html.match(/href="tel:\+16157033296"/g) ?? []).length, 1, "the failed module keeps one Call path")
  assert.match(html, /href="\/#contact"/)
  assert.match(html, /mailto:Sales@musiccityspecialtywelding.com/i)
  find(failed, (element) => element.type === "button" && element.props.children === "Retry the chat").props.onClick()
  await settle()
  const ready = hooks.render(AssistantChatLoader)
  assert.equal(loads, 2)
  assert.equal(ready.type, FakeChat)
  assert.equal(ready.props.initialOpen, true)
  hooks.unmount()
})

test("closing during import cancels the pending open and restores the opening control", async () => {
  const hooks = harness()
  let resolveModule
  const { AssistantChatLoader } = moduleExports({ hooks, load: () => new Promise((resolve) => { resolveModule = resolve }) })
  find(hooks.render(AssistantChatLoader), (element) => element.type === "button").props.onClick()
  await settle()
  const loading = hooks.render(AssistantChatLoader)
  find(loading, (element) => element.props?.["aria-label"] === "Close shop assistant").props.onClick()
  resolveModule({ AssistantChat: FakeChat })
  await settle()
  assert.equal(hooks.render(AssistantChatLoader).props.initialOpen, false)
  assert.equal(hooks.opener.focusCount, 1)
  hooks.unmount()
})

test("unmount removes the Ask listener and ignores an in-flight module completion", async () => {
  const hooks = harness()
  let resolveModule
  const { AssistantChatLoader } = moduleExports({ hooks, load: () => new Promise((resolve) => { resolveModule = resolve }) })
  hooks.render(AssistantChatLoader)
  hooks.browser.dispatchEvent(new Event("ms:open-assistant"))
  await settle()
  hooks.unmount()
  const updates = hooks.updates
  resolveModule({ AssistantChat: FakeChat })
  await settle()
  hooks.browser.dispatchEvent(new Event("ms:open-assistant"))
  assert.equal(hooks.updates, updates)
})
