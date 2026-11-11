import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import postcss from "postcss"
import {
  acceptChatReply, CHAT_STORAGE_KEY, CHAT_TURN_LIMIT,
  newChatSession, prepareChatRequest, readChatSession, writeChatSession,
} from "../lib/assistant/chat-client.ts"

const nativeRequire = createRequire(import.meta.url)
const sessionId = "f25a71b1-34a5-4f89-a7b2-e1930b812ef8"
const props = { phoneHref: "tel:+16157033296", phoneDisplay: "(615) 703-3296" }
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

function loadComponent(path, env, fakes, globals = {}) {
  const output = ts.transpileModule(source(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const context = vm.createContext({
    URL,
    AbortSignal,
    ...globals,
    process: { env },
    require: (name) => Object.hasOwn(fakes, name) ? fakes[name] : nativeRequire(name),
  })
  vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, context.require, loaded)
  return loaded.exports
}

function widgetExports(flag, pathname = "/", fakes = {}, globals = {}) {
  return loadComponent("components/assistant-chat.tsx", { NEXT_PUBLIC_ASSISTANT_CHAT: flag }, {
    "next/navigation": { usePathname: () => pathname },
    "@/lib/assistant/chat-client.ts": nativeRequire("../lib/assistant/chat-client.ts"),
    "@/lib/assistant/contact.ts": nativeRequire("../lib/assistant/contact.ts"),
    "./assistant-chat.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
    ...fakes,
  }, globals)
}

function widget(flag, pathname = "/") { return widgetExports(flag, pathname).AssistantChat }

test("widget renders nothing with its flag unset or a value other than 1", () => {
  for (const flag of [undefined, "", "0", "true"]) {
    assert.equal(renderToStaticMarkup(React.createElement(widget(flag), props)), "")
  }
})

test("root layout only mounts the widget with the exact enabled flag", () => {
  for (const flag of [undefined, "0", "1"]) {
    let mounts = 0
    const layout = loadComponent("app/layout.tsx", { NEXT_PUBLIC_ASSISTANT_CHAT: flag }, {
      "./public-site.css": {},
      "next/font/google": { Barlow_Condensed: () => ({ variable: "display" }), Permanent_Marker: () => ({ variable: "marker" }), IBM_Plex_Sans: () => ({ variable: "sans" }), IBM_Plex_Mono: () => ({ variable: "mono" }) },
      "@/components/public-analytics": { PublicAnalytics: () => null },
      "@/components/assistant-chat-loader": { AssistantChatLoader: () => { mounts++; return React.createElement("aside", null, "Chat door") } },
      "@/lib/public-metadata": { publicDefaultTitle: "Welding", publicDefaultDescription: "Shop" },
      "@/lib/shop-contact": { getShopPhone: () => ({ e164: "+16157033296", href: props.phoneHref, display: props.phoneDisplay }) },
      "@/lib/service-areas": nativeRequire("../lib/service-areas.ts"),
    }).default
    renderToStaticMarkup(React.createElement(layout, null, "Page"))
    assert.equal(mounts, flag === "1" ? 1 : 0)
  }
})

test("enabled widget stays off internal operations and customer bearer pages", () => {
  for (const path of ["/ops", "/ops/leads/10", "/board", "/j/secret", "/design-preview", null]) {
    assert.equal(renderToStaticMarkup(React.createElement(widget("1", path), props)), "")
  }
})

test("enabled public widget has one chat launcher and preserves the dialog's human call route", () => {
  const html = renderToStaticMarkup(React.createElement(widget("1", "/services/mobile-welding"), props))
  assert.match(html, /automated shop assistant/)
  const launcher = html.match(/<aside\b[\s\S]*?<\/aside>/)?.[0]
  assert.ok(launcher)
  assert.equal((launcher.match(/<button\b/g) ?? []).length, 1)
  assert.match(launcher, /aria-haspopup="dialog"[^>]*>Ask the shop<\/button>/)
  assert.doesNotMatch(launcher, /<a\b|Call the shop/)
  const dialog = html.match(/<dialog\b[\s\S]*?<\/dialog>/)?.[0]
  assert.ok(dialog)
  assert.match(dialog, /href="tel:\+16157033296"[^>]*>Call the shop/)
  assert.match(html, /<dialog[^>]*id="shop-assistant"[^>]*aria-labelledby="shop-assistant-title"/)
  assert.match(html, /role="log" aria-live="polite"/)
  assert.match(html, /<label for="shop-assistant-message"/)
  assert.match(html, /maxLength="2000"/)
  const code = source("components/assistant-chat.tsx")
  assert.match(code, /\.showModal\(\)/)
  assert.match(code, /onCancel=/)
  assert.match(code, /launcherRef\.current\?\.focus\(\{ preventScroll: true \}\)/)
})

function quickActions(flag, fakes = {}, globals = {}) {
  const actions = loadComponent("components/shop-actions.tsx", { NEXT_PUBLIC_ASSISTANT_CHAT: flag }, fakes, globals)
  return loadComponent("components/mobile-quick-actions.tsx", { NEXT_PUBLIC_ASSISTANT_CHAT: flag }, {
    "@/lib/shop-phone-shared": { FALLBACK_SHOP_PHONE_HREF: props.phoneHref },
    "@/components/shop-actions": actions,
    ...fakes,
  }, globals).MobileQuickActions
}

test("mobile quick actions keep Call the shop first and Ask the shop uses the exact chat flag", () => {
  for (const flag of [undefined, "", "0", "true", "1"]) {
    const html = renderToStaticMarkup(React.createElement(quickActions(flag), { phoneHref: props.phoneHref }))
    assert.match(html, /href="tel:\+16157033296"/)
    if (flag === "1") {
      assert.match(html, /<button[^>]*type="button" aria-haspopup="dialog" aria-controls="shop-assistant">Ask the shop<\/button>/)
      assert.doesNotMatch(html, /href="\/#contact"/)
    } else {
      assert.match(html, /<a[^>]*href="\/#contact">Ask the shop<\/a>/)
      assert.doesNotMatch(html, /aria-controls="shop-assistant"/)
    }
    assert.ok(html.indexOf("Call the shop") < html.indexOf("Ask the shop"))
  }
})

test("mobile Ask dispatch opens a chat session and the window listener is removed on unmount", () => {
  const browser = new EventTarget()
  browser.sessionStorage = { getItem: () => null }
  const effects = []
  const updates = []
  const fakeReact = {
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect),
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, (next) => updates.push(next)],
  }
  const globals = { window: browser, Event, crypto: { randomUUID: () => sessionId } }
  const { AssistantChat } = widgetExports("1", "/", { react: fakeReact }, globals)
  const publicChat = AssistantChat(props)
  const chatDoor = publicChat.type(publicChat.props)
  chatDoor.type(chatDoor.props)
  const cleanups = effects.map((effect) => effect()).filter((cleanup) => typeof cleanup === "function")
  const MobileQuickActions = quickActions("1", { react: { ...fakeReact, useEffect: () => {} } }, globals)
  const actions = MobileQuickActions({ phoneHref: props.phoneHref })
  const askComponent = actions.props.children[1]
  const ask = askComponent.type(askComponent.props)
  ask.props.onClick()
  assert.equal(updates.at(-1), true, "the mobile action opens the mounted chat")
  assert.equal(updates.at(-3).id, sessionId, "opening starts the normal chat session")
  const updateCount = updates.length
  cleanups.forEach((cleanup) => cleanup())
  browser.dispatchEvent(new Event("ms:open-assistant"))
  assert.equal(updates.length, updateCount, "unmounted chat no longer handles window events")
})

test("launcher is hidden below 980px and its fixed positioning is desktop only", () => {
  const css = postcss.parse(source("components/assistant-chat.module.css"))
  const rules = []
  css.walkRules(".launcher", (rule) => rules.push(rule))
  assert.equal(rules.length, 2)
  assert.equal(rules[0].parent.type, "root")
  assert.deepEqual(rules[0].nodes.map(({ prop, value }) => [prop, value]), [["display", "none"]])
  assert.equal(rules[1].parent.name, "media")
  assert.equal(rules[1].parent.params, "(min-width: 980px)")
  const desktop = Object.fromEntries(rules[1].nodes.map(({ prop, value }) => [prop, value]))
  assert.equal(desktop.position, "fixed")
  assert.equal(desktop.display, "flex")
  assert.equal(desktop.right, "1.5rem")
  assert.equal(desktop.bottom, "1.5rem")
  assert.match(source("app/globals.css"), /grid-template-columns: 1\.35fr 0\.65fr/)
  assert.match(source("app/homepage-polish.css"), /\.ms-home \.ms-mobile-cta a, \.ms-home \.ms-mobile-cta button \{\s*padding-bottom: calc\(0\.95rem \+ env\(safe-area-inset-bottom\)\)/)
})

test("retry after a timeout and reload preserves one session, index, and message", () => {
  let stored = null
  const storage = { getItem: () => stored, setItem: (key, value) => { assert.equal(key, CHAT_STORAGE_KEY); stored = value } }
  const initial = readChatSession(storage, () => sessionId)
  const first = prepareChatRequest(initial, "My trailer frame cracked.")
  writeChatSession(storage, first.session)
  const restored = readChatSession(storage, () => assert.fail("must reuse the saved session"))
  const retry = prepareChatRequest(restored, "Replacement draft must not create another turn")
  assert.deepEqual(retry.payload, first.payload)
  assert.equal(restored.nextTurn, 0)
  assert.equal(restored.messages.length, 0)
  const accepted = acceptChatReply(restored, "What is your name?", false)
  assert.equal(accepted.nextTurn, 1)
  assert.equal(accepted.messages.filter((item) => item.role === "user").length, 1)
  assert.equal(accepted.pending, null)
  assert.equal(accepted.leadSaved, false)
  assert.equal(prepareChatRequest(accepted, "Pat").payload.turn_index, 1)
})

test("browser storage strips money while preserving dimensions and callback numbers", () => {
  const session = prepareChatRequest(newChatSession(sessionId), "48 inch gate, $500 budget. Call 615-555-0123.").session
  const accepted = acceptChatReply(session, "500 dollars is owner-only. What material?", true)
  let stored
  writeChatSession({ getItem: () => null, setItem: (_, value) => { stored = value } }, accepted)
  assert.doesNotMatch(stored, /\$500|500 dollars/)
  assert.match(stored, /48 inch gate/)
  assert.match(stored, /615-555-0123/)
  assert.equal(accepted.leadSaved, true)
})

test("length and turn limits prevent new submissions and empty replies preserve pending state", () => {
  const session = newChatSession(sessionId)
  assert.throws(() => prepareChatRequest(session, " "), /characters/)
  assert.throws(() => prepareChatRequest(session, "x".repeat(2001)), /characters/)
  assert.throws(() => prepareChatRequest(session, "$1 ".repeat(600)), /characters/)
  assert.equal(session.pending, null, "a scrub-expanded oversized draft must remain editable")
  assert.throws(() => prepareChatRequest({ ...session, nextTurn: CHAT_TURN_LIMIT }, "Another message"), /call the shop/)
  const pending = prepareChatRequest(session, "Repair a gate").session
  assert.throws(() => acceptChatReply(pending, "", false), /could not be read/)
  assert.equal(pending.pending, "Repair a gate")
  assert.equal(pending.nextTurn, 0)
})

test("blocked, corrupt, or unavailable browser storage leaves a usable in-memory session", () => {
  for (const storage of [null, { getItem: () => { throw new Error("blocked") } }, { getItem: () => "not json" }, { getItem: () => JSON.stringify({ id: sessionId, nextTurn: 40, messages: [] }) }]) {
    assert.deepEqual(readChatSession(storage, () => sessionId), newChatSession(sessionId))
  }
  assert.doesNotThrow(() => writeChatSession({ setItem: () => { throw new Error("quota") } }, newChatSession(sessionId)))
})

test("restored sessions cannot trap a customer in an invalid retry", () => {
  const corrupt = [
    { ...newChatSession(sessionId), id: sessionId.replace("-4f89-", "-7f89-") },
    { ...newChatSession(sessionId), pending: "$1 ".repeat(600).trim() },
  ]
  for (const value of corrupt) {
    const restored = readChatSession({ getItem: () => JSON.stringify(value) }, () => sessionId)
    assert.deepEqual(restored, newChatSession(sessionId))
    assert.equal(prepareChatRequest(restored, "Repair my gate").payload.message, "Repair my gate")
  }
})

test("static fallback renders call, existing callback fields and shop email with no server", () => {
  const { AssistantContactFallback } = widgetExports("1")
  const html = renderToStaticMarkup(React.createElement(AssistantContactFallback, props))
  assert.match(html, /role="alert"/)
  assert.match(html, /href="tel:\+16157033296"/)
  assert.match(html, /\(615\) 703-3296/)
  assert.match(html, /href="mailto:Sales@musiccityspecialtywelding.com"/)
  assert.match(html, /href="\/#contact"/)
  assert.match(html, /Leave your number for a callback request/)
  assert.doesNotMatch(html, /we&#x27;ll call you back/)
  assert.ok(html.indexOf("tel:") < html.indexOf("mailto:"), "calling remains primary")
  assert.match(source("components/mainstreet-contact.tsx"), /id="contact"/)
  assert.match(source("components/mainstreet-contact.tsx"), /id="quote-phone"/)
})

test("network, timeout, 409, rate limit and server failures use the same static fallback without exposing server errors", async () => {
  const { requestAssistantReply, AssistantContactFallback } = widgetExports("1")
  const requests = [
    async () => { throw new TypeError("Failed to fetch") },
    async () => { throw Object.assign(new Error("deadline"), { name: "TimeoutError" }) },
    ...[409, 429, 500, 502, 503].map((status) => async () => Response.json({ ok: false, error: "private provider payload" }, { status })),
    async () => new Response("<h1>Server down</h1>", { status: 503 }),
    async () => Response.json({ ok: true, reply: "" }),
  ]
  for (const request of requests) {
    await assert.rejects(requestAssistantReply({ session_id: sessionId, turn_index: 0, message: "Need a person" }, request), /The reply couldn't be confirmed/)
    const html = renderToStaticMarkup(React.createElement(AssistantContactFallback, props))
    assert.match(html, /href="tel:\+16157033296"/)
    assert.match(html, /href="mailto:Sales@musiccityspecialtywelding.com"/)
    assert.match(html, /Leave your number/)
    assert.doesNotMatch(html, /private provider|Failed to fetch|Server down|deadline/)
  }
})

test("assistant replies make only approved phone, email and quote form destinations clickable", () => {
  const { AssistantReply } = widgetExports("1")
  const text = "[Call](tel:+16157033296) [Email](mailto:Sales@musiccityspecialtywelding.com) [Quote form](/#contact) [Other form](/other#contact) [Other](mailto:other@example.com) [Wrong](tel:+16155550199) [Site](https://example.com)"
  const html = renderToStaticMarkup(React.createElement(AssistantReply, { text, phoneHref: props.phoneHref }))
  assert.match(html, /href="tel:\+16157033296"/)
  assert.match(html, /href="mailto:Sales@musiccityspecialtywelding.com"/)
  assert.match(html, /href="\/#contact"/)
  assert.doesNotMatch(html, /href="\/other#contact"/)
  assert.equal((html.match(/<a /g) ?? []).length, 3)
  assert.match(source("components/assistant-chat.tsx"), /<AssistantReply[^>]+onCallback=\{closeForQuote\}/)
})

test("quote form reply link closes the chat so the contact form is usable", () => {
  const { AssistantReply } = widgetExports("1")
  let closed = false
  const nodes = AssistantReply({ text: "[Quote form](/#contact) [Call](tel:+16157033296)", phoneHref: props.phoneHref, onCallback: () => { closed = true } })
  const quote = nodes.find((node) => node.props.href === "/#contact")
  assert.ok(quote)
  quote.props.onClick()
  assert.equal(closed, true)
  assert.equal(nodes.find((node) => node.props.href === props.phoneHref).props.onClick, undefined)
})

for (const requestFailed of [false, true]) test(`closing chat preserves quote navigation with ${requestFailed ? "error" : "turn-limit"} fallback`, () => {
  const focusCalls = []
  class FocusTarget {
    isConnected = true
    focus(options) { focusCalls.push({ target: this, preventScroll: options?.preventScroll }) }
  }
  const invokingButton = new FocusTarget()
  const launcherButton = new FocusTarget()
  const fakeReact = {
    useCallback: (callback) => callback,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useState: (value) => [value === null ? { messages: [{ role: "assistant", content: "[Quote form](/#contact)" }], nextTurn: CHAT_TURN_LIMIT } : value === "" && requestFailed ? "A failed request" : value, () => {}],
  }
  const { AssistantChat } = widgetExports("1", "/", { react: fakeReact }, {
    document: { activeElement: invokingButton }, HTMLElement: FocusTarget,
    window: { sessionStorage: { getItem: () => null } },
    crypto: { randomUUID: () => sessionId },
  })
  const publicChat = AssistantChat(props)
  const chatDoor = publicChat.type(publicChat.props)
  const tree = chatDoor.type(chatDoor.props)
  const [launcher, dialog] = tree.props.children
  const button = launcher.props.children
  button.props.ref.current = launcherButton
  button.props.onClick()
  dialog.props.onClose()
  assert.deepEqual(focusCalls, [{ target: invokingButton, preventScroll: true }])
  invokingButton.isConnected = false
  dialog.props.onClose()
  assert.deepEqual(focusCalls[1], { target: launcherButton, preventScroll: true })
  const findQuoteReply = (node) => {
    if (!node || typeof node !== "object") return null
    if (node.props?.text === "[Quote form](/#contact)") return node
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = findQuoteReply(child)
      if (found) return found
    }
    return null
  }
  const quoteReply = findQuoteReply(dialog)
  assert.ok(quoteReply)
  quoteReply.props.onCallback()
  dialog.props.onClose()
  assert.equal(focusCalls.length, 2, "quote navigation keeps focus at its destination")
  invokingButton.isConnected = true
  button.props.onClick()
  dialog.props.onClose()
  assert.deepEqual(focusCalls[2], { target: invokingButton, preventScroll: true }, "a later ordinary dismissal restores focus")
  const fallbacks = []
  const collectFallbacks = (node) => {
    if (!node || typeof node !== "object") return
    if (node.type?.name === "AssistantContactFallback") fallbacks.push(node)
    for (const child of [node.props?.children].flat(Infinity)) collectFallbacks(child)
  }
  collectFallbacks(dialog)
  assert.equal(fallbacks.length, 1)
  button.props.onClick()
  fallbacks[0].props.onCallback()
  dialog.props.onClose()
  assert.equal(focusCalls.length, 3, "fallback quote navigation keeps focus at its destination")
})

test("handoff phone links render for both configured and fallback shop phone routing", () => {
  const { AssistantReply } = widgetExports("1")
  const { assistantContactReply } = nativeRequire("../lib/assistant/contact.ts")
  for (const phone of [
    { href: "tel:+16157033296", display: "(615) 703-3296" },
    { href: "tel:+16158104910", display: "(615) 810-4910" },
  ]) {
    const text = assistantContactReply(phone)
    const nodes = AssistantReply({ text, phoneHref: phone.href })
    const call = nodes.find((node) => node.props.href === phone.href)
    assert.ok(call, `handoff must use the selected ${phone.href} route`)
    assert.equal(call.props.children, `Call the shop at ${phone.display}`)
    assert.equal(nodes.filter((node) => node.type === "a").length, 3)
    const other = phone.href === "tel:+16157033296" ? "tel:+16158104910" : "tel:+16157033296"
    assert.equal(AssistantReply({ text: `[Other](${other})`, phoneHref: phone.href }).filter((node) => node.type === "a").length, 0)
  }
})
