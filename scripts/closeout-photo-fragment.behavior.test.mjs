import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { deriveCloseoutDraft } from "../lib/closeout-domain.ts"

function fixture(reviewedCloseout) {
  const states = []
  let cursor = 0
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" }
  const photo = () => null
  const dependencies = {
    "react/jsx-runtime": jsx,
    react: {
      useId: () => "qa",
      useEffect: () => {},
      useRef: (current) => ({ current }),
      useActionState: (_action, initial) => [initial, () => {}, false],
      useState: (initial) => {
        const index = cursor++
        if (!(index in states)) states[index] = initial
        return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value }]
      },
    },
    "@/lib/closeout-domain.ts": { deriveCloseoutDraft },
    "@/lib/shop-brain-invariants.ts": { swipeFinishDecision: () => false },
    "../../safe-action-controls": { SafeSubmitButton: () => null },
    "../../voice-capture-button": { VoiceCaptureButton: () => null },
    "./closeout-photo-input": { CloseoutPhotoInput: photo },
    "../../actions": {},
  }
  const source = readFileSync(new URL("../app/ops/leads/[id]/done-stamp.tsx", import.meta.url), "utf8")
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext(`(function(exports,require,module){${output}\n})`)(loaded.exports, (name) => { assert.ok(name in dependencies, name); return dependencies[name] }, loaded)
  function elements(node) { return node && typeof node === "object" ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : [] }
  return {
    photo,
    render() { cursor = 0; return elements(loaded.exports.DoneStamp({ leadId: 7, completed: false, undoUntil: null, voiceReady: false, reviewedCloseout, closeoutKey: "qa" })) },
  }
}

test("Photo reaches an actionable prerequisite before reviewed closeout, then the upload control after review", () => {
  const f = fixture(true)
  let nodes = f.render()
  const target = nodes.find(n => n.props?.["data-job-fragment"] === "finish-photo")
  assert.equal(target.props.tabIndex, -1)
  assert.ok(nodes.some(n => n.type === "a" && n.props.href === "#closeout-source"))
  assert.equal(nodes.some(n => n.type === f.photo), false)
  nodes.find(n => n.props?.["data-job-fragment"] === "closeout-source").props.onChange({ target: { value: "Finished, fit good, no extra trip, no rework, nothing left." } })
  nodes = f.render()
  nodes.find(n => n.props?.className === "ops-closeout-review").props.onClick()
  nodes = f.render()
  assert.ok(nodes.some(n => n.type === f.photo && n.props.mode === "completion"))
  assert.equal(nodes.some(n => n.props?.className === "ops-closeout-photo-prerequisite"), false)
})

test("Partial review retains Photo prerequisite and never enables completion photo upload", () => {
  const f = fixture(true)
  let nodes = f.render()
  nodes.find(n => n.props?.["data-job-fragment"] === "closeout-source").props.onChange({ target: { value: "Finished, fit good." } })
  nodes = f.render(); nodes.find(n => n.props?.className === "ops-closeout-review").props.onClick()
  nodes = f.render(); nodes.find(n => n.type === "select" && n.props.name === "completion").props.onChange({ target: { value: "partial" } })
  nodes = f.render()
  assert.ok(nodes.some(n => n.props?.["data-job-fragment"] === "finish-photo" && n.props.tabIndex === -1))
  assert.equal(nodes.some(n => n.type === f.photo), false)
  assert.ok(nodes.some(n => n.type === "a" && n.props.children === "Update the closeout"))
})

test("Ordinary closeout still renders the completion photo input immediately", () => {
  const f = fixture(false)
  const nodes = f.render()
  assert.ok(nodes.some(n => n.type === f.photo && n.props.mode === "completion"))
  assert.equal(nodes.some(n => n.props?.className === "ops-closeout-photo-prerequisite"), false)
})
