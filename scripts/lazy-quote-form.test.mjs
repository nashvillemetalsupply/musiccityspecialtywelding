import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const nativeRequire = createRequire(import.meta.url)
const path = "../components/lazy-quote-form.tsx"
const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const props = { phoneHref: "tel:+16157033296", phoneDisplay: "(615) 703-3296" }

function load(globals = {}, fakes = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, globals)(
    (name) => Object.hasOwn(fakes, name) ? fakes[name] : nativeRequire(name), loaded, loaded.exports,
  )
  return loaded.exports
}

function scheduling({ idle = true, observer = true } = {}) {
  let id = 0, receive, observed, options
  const frames = new Map(), idleCallbacks = new Map()
  class Observer {
    constructor(callback, config) { receive = callback; options = config }
    observe(slot) { observed = slot }
    disconnect() {}
  }
  const globals = {
    window: idle ? {
      requestIdleCallback(callback) { const next = ++id; idleCallbacks.set(next, callback); return next },
      cancelIdleCallback(key) { idleCallbacks.delete(key) },
    } : {},
    requestAnimationFrame(callback) { const next = ++id; frames.set(next, callback); return next },
    cancelAnimationFrame(key) { frames.delete(key) },
    ...(observer ? { IntersectionObserver: Observer } : {}),
  }
  const advance = (queue) => { const next = queue.entries().next().value; assert.ok(next); queue.delete(next[0]); next[1]() }
  return { globals, frames, idleCallbacks, frame: () => advance(frames), idle: () => advance(idleCallbacks),
    intersect: (value) => receive([{ isIntersecting: value }]), observed: () => observed, options: () => options }
}

test("SSR has no editable fields to replace, and always gives the phone and email fallback", () => {
  const { LazyQuoteForm } = load()
  const html = renderToStaticMarkup(React.createElement(LazyQuoteForm, props))
  assert.doesNotMatch(html, /<(?:form|input|select|textarea)\b/)
  assert.match(html, /role="status">The job form is loading/)
  assert.match(html, /min-height:40rem/)
  assert.match(html, /href="tel:\+16157033296"/)
  assert.match(html, /href="mailto:Sales@musiccityspecialtywelding.com"/)
})

test("concurrent quote requests share one module load, and a failed load can retry", async () => {
  const { createQuoteFormLoader } = load()
  const Form = () => null
  let calls = 0, resolve
  const request = createQuoteFormLoader(() => { calls++; return new Promise((done) => { resolve = done }) })
  const first = request(), second = request()
  assert.equal(first, second)
  assert.equal(calls, 1)
  resolve({ QuoteForm: Form })
  assert.equal(await first, Form)
  assert.equal(await request(), Form)
  assert.equal(calls, 1)
  let attempts = 0
  const retry = createQuoteFormLoader(async () => { if (++attempts === 1) throw new Error("offline chunk"); return { QuoteForm: Form } })
  await assert.rejects(retry(), /offline chunk/)
  assert.equal(await retry(), Form)
  assert.equal(attempts, 2)
})

test("the form starts after paint and idle, and viewport demand cancels the competing trigger", () => {
  const scheduler = scheduling()
  const { scheduleQuoteForm } = load(scheduler.globals)
  let starts = 0
  const slot = {}
  const cleanup = scheduleQuoteForm(slot, () => starts++)
  assert.equal(scheduler.observed(), slot)
  assert.equal(scheduler.options().rootMargin, "800px")
  assert.equal(starts, 0)
  scheduler.frame()
  assert.equal(starts, 0)
  assert.equal(scheduler.idleCallbacks.size, 1)
  scheduler.intersect(true)
  assert.equal(starts, 1)
  assert.equal(scheduler.idleCallbacks.size, 0)
  scheduler.intersect(true)
  assert.equal(starts, 1)
  cleanup()
})

test("without idle callbacks the form waits through a paint, and unmount cancels pending work", () => {
  const scheduler = scheduling({ idle: false, observer: false })
  const { scheduleQuoteForm } = load(scheduler.globals)
  let starts = 0
  scheduleQuoteForm({}, () => starts++)
  scheduler.frame()
  assert.equal(starts, 0)
  scheduler.frame()
  assert.equal(starts, 1)
  const cancel = scheduleQuoteForm({}, () => starts++)
  cancel()
  assert.equal(scheduler.frames.size, 0)
  assert.equal(starts, 1)
})

test("once loaded the form keeps the same component identity across scroll events and prop updates", async () => {
  const scheduler = scheduling()
  const hooks = [], effects = []
  let cursor = 0, imports = 0
  const fakeReact = { ...React,
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial } },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value }] },
    useEffect(effect) { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(effect) } },
  }
  const Form = () => React.createElement("input", { defaultValue: "customer-owned value" })
  const { LazyQuoteForm } = load(scheduler.globals, {
    react: fakeReact,
    "./mainstreet-contact": { get QuoteForm() { imports++; return Form } },
  })
  const render = (nextProps = props) => { cursor = 0; return LazyQuoteForm(nextProps) }
  const placeholder = render()
  placeholder.props.ref.current = {}
  const cleanup = effects[0]()
  scheduler.intersect(true)
  await new Promise(setImmediate)
  const mounted = render()
  assert.equal(mounted.type, Form)
  assert.equal(mounted.key, null)
  scheduler.intersect(true)
  const updated = render({ ...props, phoneDisplay: "Shop phone" })
  assert.equal(updated.type, mounted.type, "React retains the existing form and its input state")
  assert.equal(updated.key, mounted.key)
  assert.equal(imports, 1)
  cleanup()
})

test("a failed import shows a noneditable contact fallback and retry mounts the real form", async () => {
  const scheduler = scheduling()
  const hooks = [], effects = []
  let cursor = 0, attempts = 0
  const fakeReact = { ...React,
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial } },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value }] },
    useEffect(effect) { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(effect) } },
  }
  const Form = () => null
  const { LazyQuoteForm } = load(scheduler.globals, { react: fakeReact,
    "./mainstreet-contact": { get QuoteForm() { if (++attempts === 1) throw new Error("offline chunk"); return Form } },
  })
  const render = () => { cursor = 0; return LazyQuoteForm(props) }
  render().props.ref.current = {}
  const cleanup = effects[0]()
  scheduler.intersect(true)
  await new Promise(setImmediate)
  const failed = render()
  const html = renderToStaticMarkup(failed)
  assert.match(html, /role="alert">The job form didn&#x27;t load/)
  assert.match(html, /min-height:auto/)
  assert.match(html, /href="tel:\+16157033296"/)
  assert.match(html, /href="mailto:Sales@musiccityspecialtywelding.com"/)
  assert.doesNotMatch(html, /<(?:form|input|select|textarea)\b/)
  const retry = failed.props.children.find((child) => child?.type === "button")
  retry.props.onClick()
  await new Promise(setImmediate)
  assert.equal(render().type, Form)
  assert.equal(attempts, 2)
  cleanup()
})
