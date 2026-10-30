import assert from "node:assert/strict"
import test from "node:test"
import { jobFragmentScrollTarget, revealJobFragment } from "../app/ops/leads/[id]/job-fragment.ts"

function fixture() {
  const elements = []
  const root = { tagName: "DIV", parentElement: null }
  const contains = (ancestor, target) => {
    for (let current = target; current; current = current.parentElement) if (current === ancestor) return true
    return false
  }
  root.ownerDocument = { getElementById: (id) => elements.find((element) => element.id === id) ?? null }
  root.contains = (target) => contains(root, target)
  root.querySelectorAll = (selector) => elements.filter((element) => root.contains(element)
    && (selector.includes("[id]") ? Boolean(element.id || element.dataset.jobFragment) : element.tagName === "LABEL"))
  const node = (tagName, parentElement = root, id) => {
    const element = { tagName, parentElement, id, dataset: {}, open: false }
    element.contains = (target) => contains(element, target)
    elements.push(element)
    return element
  }
  return { root, node }
}

test("a fragment keeps a visible preceding label with its field", () => {
  const { root, node } = fixture()
  const target = node("INPUT", root, "lead-estimate")
  target.getBoundingClientRect = () => ({ top: 120 })
  const label = node("LABEL")
  label.htmlFor = "lead-estimate"
  label.getClientRects = () => [{}]
  label.getBoundingClientRect = () => ({ top: 90 })
  assert.equal(jobFragmentScrollTarget(root, target), label)
})

test("hidden, following, and outside labels do not move a fragment away from its field", () => {
  const { root, node } = fixture()
  const target = node("INPUT", root, "lead-estimate")
  target.getBoundingClientRect = () => ({ top: 120 })
  assert.equal(jobFragmentScrollTarget(root, target), target)
  const hidden = node("LABEL")
  hidden.htmlFor = "lead-estimate"
  hidden.getClientRects = () => []
  const following = node("LABEL")
  following.htmlFor = "lead-estimate"
  following.getClientRects = () => [{}]
  following.getBoundingClientRect = () => ({ top: 150 })
  const outside = node("LABEL", null)
  outside.htmlFor = "lead-estimate"
  assert.equal(jobFragmentScrollTarget(root, target), target)
})

test("cached job IDs and native label associations cannot select the previous job", () => {
  const { root, node } = fixture()
  const cachedJob = node("DIV", null)
  const cachedDrawer = node("DETAILS", cachedJob)
  const cachedInput = node("INPUT", cachedDrawer, "lead-estimate")
  const cachedLabel = node("LABEL", cachedDrawer)
  cachedLabel.htmlFor = "lead-estimate"
  const currentDrawer = node("DETAILS")
  const currentInput = node("INPUT", currentDrawer, "lead-estimate")
  const currentLabel = node("LABEL", currentDrawer)
  currentLabel.htmlFor = "lead-estimate"
  currentLabel.getClientRects = () => [{}]
  currentLabel.getBoundingClientRect = () => ({ top: 90 })
  currentInput.getBoundingClientRect = () => ({ top: 120 })
  currentInput.labels = [] // The duplicate ID makes native labels resolve to the cached field.

  assert.equal(root.ownerDocument.getElementById("lead-estimate"), cachedInput)
  assert.equal(revealJobFragment(root, "#lead-estimate"), currentInput)
  assert.equal(jobFragmentScrollTarget(root, currentInput), currentLabel)
  assert.equal(currentDrawer.open, true)
  assert.equal(cachedDrawer.open, false)
})

test("a price deep link opens only its enclosing disclosures", () => {
  const { root, node } = fixture()
  const contact = node("DETAILS")
  const price = node("DETAILS")
  const nested = node("DETAILS", price)
  const target = node("INPUT", nested, "lead-estimate")
  assert.equal(revealJobFragment(root, "#lead-estimate"), target)
  assert.equal(price.open, true)
  assert.equal(nested.open, true)
  assert.equal(contact.open, false)
})

test("following the same fragment reopens a manually closed drawer", () => {
  const { root, node } = fixture()
  const price = node("DETAILS")
  const target = node("INPUT", price, "lead-estimate")
  revealJobFragment(root, "#lead-estimate")
  price.open = false
  assert.equal(revealJobFragment(root, "#lead-estimate"), target)
  assert.equal(price.open, true)
})

test("encoded fragments and a disclosure's own ID are supported", () => {
  const { root, node } = fixture()
  const target = node("DETAILS", root, "job details")
  assert.equal(revealJobFragment(root, "#job%20details"), target)
  assert.equal(target.open, true)
})

test("malformed, missing, and outside-job fragments are ignored", () => {
  const { root, node } = fixture()
  const elsewhere = node("DETAILS", null)
  node("INPUT", elsewhere, "outside")
  for (const hash of ["", "#", "#missing", "#%E0%A4", "#outside"]) {
    assert.equal(revealJobFragment(root, hash), null)
  }
  assert.equal(elsewhere.open, false)
})

test("old deep links resolve a unique native field ID and its current label without a disclosure", () => {
  const { root, node } = fixture()
  const previousJob = node("DIV", null)
  const previous = node("INPUT", previousJob, "job-7-old-lead-estimate")
  previous.dataset.jobFragment = "lead-estimate"
  const current = node("INPUT", root, "job-7-current-lead-estimate")
  current.dataset.jobFragment = "lead-estimate"
  current.getBoundingClientRect = () => ({ top: 120 })
  const label = node("LABEL")
  label.htmlFor = current.id
  label.getClientRects = () => [{}]
  label.getBoundingClientRect = () => ({ top: 90 })
  assert.equal(revealJobFragment(root, "#lead-estimate"), current)
  assert.equal(jobFragmentScrollTarget(root, current), label)
  assert.equal(revealJobFragment(root, "#job-7-current-lead-estimate"), current)
})

test("local native IDs take precedence over aliases and visible section anchors still resolve", () => {
  const { root, node } = fixture()
  const alias = node("INPUT", root, "unique-input")
  alias.dataset.jobFragment = "target"
  const native = node("H2", root, "target")
  assert.equal(revealJobFragment(root, "#target"), native)
})

test("a reply form alias opens its drawer and focuses the visible reply field", () => {
  const { root, node } = fixture()
  const drawer = node("DETAILS")
  const form = node("FORM", drawer, "reply-current")
  form.dataset.jobFragment = "job-reply"
  const hiddenField = node("INPUT", form)
  hiddenField.getClientRects = () => []
  const reply = node("INPUT", form, "reply-current-body")
  reply.getClientRects = () => [{}]
  form.querySelectorAll = (selector) => {
    assert.match(selector, /:not\(\[type='hidden'\]\)/)
    assert.match(selector, /:not\(\[disabled\]\)/)
    return [hiddenField, reply]
  }
  assert.equal(revealJobFragment(root, "#job-reply"), reply)
  assert.equal(drawer.open, true)
})
