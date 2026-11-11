import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import ts from "typescript"

const nativeRequire = createRequire(import.meta.url)
const source = readFileSync(new URL("../components/mainstreet-menu.tsx", import.meta.url), "utf8")
const code = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function menuHarness({ initiallyOpen = false } = {}) {
  const states = [], refs = [], mountEffects = []
  let stateIndex = 0, refIndex = 0, focusCount = 0
  let mounted = false
  const fakes = {
    react: {
      useEffect(effect) { if (!mounted) mountEffects.push(effect) },
      useState(initial) {
        const index = stateIndex++
        if (!(index in states)) states[index] = initial
        return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value }]
      },
      useRef(initial) { return refs[refIndex++] ??= { current: initial } },
    },
    "@/lib/shop-phone-shared": { FALLBACK_SHOP_PHONE_HREF: "tel:+16155550199", FALLBACK_SHOP_PHONE_DISPLAY: "(615) 555-0199" },
    "@/components/shop-actions": { AskShopButton: () => null },
  }
  const loaded = { exports: {} }
  const context = vm.createContext({ require: (name) => Object.hasOwn(fakes, name) ? fakes[name] : nativeRequire(name) })
  vm.runInContext(`(function(exports, require, module) { ${code}\n})`, context)(loaded.exports, context.require, loaded)
  const details = { open: initiallyOpen }
  const summary = { focus() { focusCount++ } }
  let tree
  function render() {
    stateIndex = 0
    refIndex = 0
    tree = loaded.exports.MainstreetMenu({})
    tree.props.ref.current = details
    children()[0].props.ref.current = summary
  }
  function children() { return React.Children.toArray(tree.props.children) }
  function toggle(open) {
    details.open = open
    tree.props.onToggle({ currentTarget: details })
    render()
  }
  function assertState(open) {
    const trigger = children()[0]
    assert.equal(details.open, open)
    assert.equal(trigger.props["aria-expanded"], open)
    assert.equal(trigger.props["aria-label"], open ? "Close navigation" : "Open navigation")
  }
  render()
  mounted = true
  for (const effect of mountEffects) effect()
  render()
  return { render, toggle, assertState, children, get tree() { return tree }, get focusCount() { return focusCount } }
}

test("navigation state syncs when details opened before hydration", () => {
  const menu = menuHarness({ initiallyOpen: true })
  menu.assertState(true)
  menu.toggle(false)
  menu.assertState(false)
})

test("navigation toggle names and exposes both native details states", () => {
  const menu = menuHarness()
  menu.assertState(false)
  menu.toggle(true)
  menu.assertState(true)
  menu.toggle(false)
  menu.assertState(false)
})

test("Escape and backdrop closure reset navigation state and restore trigger focus", () => {
  const menu = menuHarness()
  let prevented = false
  menu.toggle(true)
  menu.tree.props.onKeyDown({ key: "Escape", preventDefault() { prevented = true } })
  menu.render()
  menu.assertState(false)
  assert.ok(prevented)
  assert.equal(menu.focusCount, 1)
  menu.toggle(true)
  menu.children()[1].props.onClick()
  menu.render()
  menu.assertState(false)
  assert.equal(menu.focusCount, 2)
})

test("every navigation action closes the menu and resets its accessible toggle", () => {
  const menu = menuHarness()
  const actions = React.Children.toArray(menu.children()[2].props.children)
  assert.equal(actions.length, 5)
  for (let index = 0; index < actions.length; index++) {
    menu.toggle(true)
    React.Children.toArray(menu.children()[2].props.children)[index].props.onClick()
    menu.render()
    menu.assertState(false)
  }
  assert.equal(menu.focusCount, 0, "navigation actions keep normal destination focus")
})
