import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const SHELL = read("../app/ops/ops-shell.css")
const CONTROL = read("../styles/control.css")
const TOKENS = read("../tokens.css")
const LEGACY = read("../styles/ops-legacy.css")

// Every marketing token that ops-legacy.css uses inside an .ops-* rule has
// to resolve to a shell role on the dark shell, or it renders as ink on ink.
test("every legacy colour token the ops rules reference is aliased on the shell", () => {
  const start = CONTROL.indexOf(".ops-shell,.app,.updates-page,.calls,.cust{")
  assert.ok(start > -1, "the alias block is scoped to every shell root, board routes included")
  const shellBlock = CONTROL.slice(start, CONTROL.indexOf("}", start))
  const referenced = new Set([...LEGACY.matchAll(/var\((--color-[a-z0-9-]+)\)/g)].map((m) => m[1]))
  // Translucent sheens (white at a few percent alpha) read the same on any
  // ground and stay as they are; only opaque ink/paper values need a role.
  const defined = new Set([...TOKENS.matchAll(/^\s*(--color-[a-z0-9-]+):\s*([^;]+);/gm)].filter((m) => !/\/\s*0\./.test(m[2])).map((m) => m[1]))
  const missing = [...referenced].filter((token) => defined.has(token) && !shellBlock.includes(`${token}: var(--`))
  assert.deepEqual(missing, [], `legacy tokens used by ops rules but not aliased on the shells: ${missing.join(", ")}`)
  // and none of them alias to a raw colour -- the role map is the only source
  assert.doesNotMatch(shellBlock, /--color-[a-z0-9-]+: #/)
})

test("touch screens get 44px controls across the shell, summaries included", () => {
  assert.match(SHELL, /@media \(pointer: coarse\) \{[\s\S]*?\.ops-shell summary[\s\S]*?min-height: 44px;/)
})
