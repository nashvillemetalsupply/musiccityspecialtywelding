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
  // The first version of this pin sliced from the block to end-of-file and
  // substring-matched each selector. That could not fail for .chip: deleting
  // .chip from the border rule left ".chip i" three lines below, which contains
  // ".chip" and satisfied the match on its own. A pin that stays green while the
  // thing it pins is deleted is worse than no pin, so it asserts the border
  // rule's own selector list now, arm by arm.
  const open = CONTROL.indexOf("@media (forced-colors:active){")
  assert.ok(open > -1, "no forced-colors block")
  const block = CONTROL.slice(open, CONTROL.indexOf("\n}", open))
  const border = block.match(/\n\s*([^\n{]+)\{border:1px solid ButtonText\}/)
  assert.ok(border, "no `border:1px solid ButtonText` rule in the forced-colors block")
  const arms = border[1].split(",").map((s) => s.trim())
  for (const sel of [".chip", ".tab", ".btn", ".skip", ".find"]) {
    assert.ok(arms.includes(sel), `${sel} is not an arm of the forced-colors border rule (arms: ${arms.join(" ")})`)
  }
  // The dot inside a chip is a fill, not a border, so it is pinned separately.
  assert.match(block, /\n\s*\.chip i\{background:CanvasText\}/, ".chip i has no forced-colors fill")
  assert.match(block, /\n\s*\.tab\[aria-pressed="true"\],\.tab\[aria-current="page"\]\{border:2px solid Highlight\}/,
    "the pressed/current tab loses its forced-colors boundary")
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
