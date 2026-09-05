import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import postcss from "postcss"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
// Ignore horizontal indentation at the beginning of a line, and nothing else:
// value spacing, declaration order, comments, semicolons and line endings count.
const unindent = (text) => text.replace(/^[\t ]+/gm, "")

function openingBrace(text, start) {
  let quote = ""
  let comment = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (comment) {
      if (char === "*" && text[index + 1] === "/") { comment = false; index++ }
    } else if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = ""
    } else if (char === "/" && text[index + 1] === "*") { comment = true; index++ }
    else if (char === "\"" || char === "'") quote = char
    else if (char === "{") return index
  }
  throw new Error("declaration block has no opening brace")
}

function blocks(css) {
  const result = []
  postcss.parse(css).walk((node) => {
    if (!node.nodes || !node.nodes.some((child) => child.type === "decl")) return
    const context = []
    for (let parent = node.parent; parent?.type !== "root"; parent = parent.parent) {
      context.unshift(unindent(css.slice(parent.source.start.offset, openingBrace(css, parent.source.start.offset))))
    }
    const open = openingBrace(css, node.source.start.offset)
    result.push({
      body: unindent(css.slice(open, node.source.end.offset)),
      arms: node.type === "rule" ? postcss.list.comma(node.selector).map(unindent) : [unindent(css.slice(node.source.start.offset, open))],
      context: JSON.stringify(context),
      line: node.source.start.line,
    })
  })
  return result
}

function assertVerbatim(original, moved) {
  const before = blocks(original)
  const after = blocks(moved)
  assert.ok(after.length, "legacy must contain declaration blocks")
  let cursor = -1
  for (const block of after) {
    const match = before.findIndex((candidate, index) => {
      if (index <= cursor || candidate.body !== block.body || candidate.context !== block.context) return false
      let armCursor = -1
      return block.arms.every((arm) => {
        armCursor = candidate.arms.indexOf(arm, armCursor + 1)
        return armCursor !== -1
      })
    })
    assert.ok(match >= 0, `legacy line ${block.line}: declaration bytes, selector arms, enclosing at-rules or source order differ from the frozen globals`)
    cursor = match
  }
}

test("every moved declaration block is byte-identical to the frozen globals in source order", () => {
  assertVerbatim(read("scripts/qa/baseline/pre-retirement-globals.css"), read("styles/ops-legacy.css"))
})

test("verbatim proof permits selector-arm extraction and leading indentation only", () => {
  assertVerbatim("@media (max-width: 600px) {\n  .dead, .ops-live {\n    color: red; /* retained */\n    padding: 0;\n  }\n}", "@media (max-width: 600px) {\n.ops-live {\ncolor: red; /* retained */\npadding: 0;\n}\n}")
})

test("verbatim proof rejects reformatting, reordering, merging, splitting and rewritten values", () => {
  const original = ".ops-live {\n  color: red; /* retained */\n  padding: 0;\n}\n.ops-next { margin: 0; }"
  for (const moved of [
    ".ops-live { color: red; /* retained */ padding: 0; }",
    ".ops-live {\n  padding: 0;\n  color: red; /* retained */\n}",
    ".ops-live {\n  color: red; /* retained */\n  padding: 0;\n  margin: 0;\n}",
    ".ops-live {\n  color: red; /* retained */\n}\n.ops-live {\n  padding: 0;\n}",
    original.replace("red", "blue"),
    original.replace(" /* retained */", ""),
    original.replace("padding: 0;", "padding:  0;"),
    original.replaceAll("\n", "\r\n"),
    original.replace(".ops-live", ".ops-live.ops-live"),
    ".ops-next { margin: 0; }\n" + original.slice(0, original.indexOf("\n.ops-next")),
    `@media (max-width: 600px) {${original}}`,
  ]) assert.throws(() => assertVerbatim(original, moved), /differ from the frozen globals/)
})

const projection = ({ body, arms, context }) => ({ body, arms, context })

// Compare complete ordered projections as well as individual block provenance:
// dropping one rule must fail even when another rule still names the class.
test("every live selector arm and its complete declaration block survives the move", () => {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const out = execFileSync("git", ["grep", "-ho", "ops-[a-z0-9-]*", "--", "app/board", "app/ops", "components"], { cwd: root, encoding: "utf8" })
  const used = new Set(out.trim().split(/\s+/).filter(Boolean).map((name) => `.${name}`))
  const expected = blocks(read("scripts/qa/baseline/pre-retirement-globals.css")).map(projection).flatMap((block) => {
    const arms = block.context.includes("@keyframes paid-land") ? block.arms : block.arms.filter((arm) => (arm.match(/\.ops-[a-z0-9-]+/g) ?? []).some((name) => used.has(name)))
    return arms.length ? [{ ...block, arms }] : []
  })
  const actual = blocks(read("styles/ops-legacy.css")).map(projection)
  assert.deepEqual(actual, expected, "a live selector arm, declaration block, context or source order changed")
})

test("marketing, customer glass, theme and global imports remain verbatim in order", () => {
  const original = read("scripts/qa/baseline/pre-retirement-globals.css")
  const current = read("app/globals.css")
  const expected = blocks(original).map(projection).flatMap((block) => {
    if (/@keyframes (?:paid-land|done-hold|money-odometer)\b/.test(block.context)) return []
    const arms = block.arms.filter((arm) => !/\.ops-[a-z0-9-]+/.test(arm))
    return arms.length ? [{ ...block, arms }] : []
  })
  const actual = blocks(current).map(projection)
  assert.deepEqual(actual, expected, "a retained selector arm, declaration block, context or source order changed")
  const imports = (css) => postcss.parse(css).nodes.filter((node) => node.type === "atrule" && !node.nodes).map((node) => css.slice(node.source.start.offset, node.source.end.offset))
  assert.deepEqual(imports(current), imports(original), "global imports and leaf at-rules must remain byte-identical")
})
