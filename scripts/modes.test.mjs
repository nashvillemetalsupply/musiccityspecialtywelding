import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const CONTROL = read("styles/control.css")

test("one global focus ring", () => {
  assert.match(CONTROL, /:focus-visible\{outline:2px solid var\(--focus\);outline-offset:2px\}/)
  assert.doesNotMatch(read("app/board/board.css"), /outline:\s*(none|0)\b/)
  assert.doesNotMatch(read("app/ops/ops-shell.css"), /outline:\s*(none|0)\b/)
})

test("reduced motion is global, so /ops stops too", () => {
  assert.match(CONTROL, /@media \(prefers-reduced-motion:reduce\)/)
  assert.doesNotMatch(read("app/board/board.css"), /prefers-reduced-motion/)
})

test("forced colours keep a boundary on every stateful control", () => {
  const block = CONTROL.slice(CONTROL.indexOf("@media (forced-colors:active)"))
  assert.ok(block.length > 0, "no forced-colors block")
  for (const sel of [".chip", ".tab", ".btn", ".skip", ".chip i"]) assert.match(block, new RegExp(sel.replace(/\./g, "\\.")), `${sel} has no forced-colors rule`)
})

test("more contrast lifts the quiet tier", () => {
  assert.match(CONTROL, /@media \(prefers-contrast:more\)\{[^}]*--text-muted:var\(--text-secondary\)/)
})

test("the tracker's service drawing stays named", () => {
  // Already true today (board.tsx ~665): the SVG is role="img" with the service
  // as its label when there is one. Pinned so the forced-colors pass cannot
  // strip it.
  const board = read("app/board/board.tsx")
  assert.match(board, /role: "img", "aria-label": lead\.service\.trim\(\)/)
})
