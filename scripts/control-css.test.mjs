import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const control = readFileSync("styles/control.css", "utf8")
const board = readFileSync("app/board/board.css", "utf8")

test("control.css owns the tokens and board.css imports it", () => {
  assert.match(control, /--surface-raised\s*:/)
  assert.match(control, /\.btn--go\b/)
  assert.match(board, /@import\s+"..\/..\/styles\/control.css"/)
})

test("no component in control.css names a raw colour", () => {
  // roles are defined once in the :root token block; component rules use var()
  const afterTokens = control.slice(control.indexOf("}") + 1)
  assert.doesNotMatch(afterTokens, /#[0-9a-fA-F]{3,8}\b/)
})
