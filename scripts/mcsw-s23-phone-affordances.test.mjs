import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { normalizeUsPhone } from "../lib/shop-brain-invariants.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const read = (path) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n")

function sourceFiles(dir) {
  const files = []
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name)
    if (statSync(join(root, path)).isDirectory()) files.push(...sourceFiles(path))
    else if (/\.(?:tsx|jsx)$/.test(name)) files.push(path)
  }
  return files
}

const UI_SOURCE_FILES = [...sourceFiles("app"), ...sourceFiles("components")]

test("every phone input has a telephone keyboard and telephone autofill", () => {
  for (const file of UI_SOURCE_FILES) {
    const source = read(file)
    for (const match of source.matchAll(/<input\b[^>]*>/gs)) {
      const tag = match[0]
      const hasTelMode = /\btype\s*=\s*["']tel["']/i.test(tag)
        || /\binputMode\s*=\s*["']tel["']/i.test(tag)
      const namesPhone = /\b(?:name|id|placeholder|aria-label)\s*=\s*["'][^"']*(?:phone|cell|mobile)/i.test(tag)
      if (!hasTelMode && !namesPhone) continue
      assert.ok(hasTelMode, `${file}: phone input has no tel keyboard: ${tag}`)
      assert.match(tag, /\bautoComplete\s*=\s*["']tel["']/i, `${file}: phone input has no telephone autofill`)
    }
  }
})

test("customer and crew direct-call links normalize to a dialable number", () => {
  const callButton = read("app/ops/tracked-call-button.tsx")
  const quoteRoute = read("app/api/quote/route.ts")
  assert.match(callButton, /normalizeUsPhone\(phone\)/)
  assert.match(quoteRoute, /normalizeUsPhone\(phone\)/)
  assert.doesNotMatch(callButton, /href=\{`tel:\$\{phone\.replace/)
  assert.doesNotMatch(quoteRoute, /tel:\$\{escapeHtml\(phone\.replace/)
  assert.equal(normalizeUsPhone("(615) 555-0123"), "+16155550123")
  assert.equal(normalizeUsPhone("+44 20 7946 0958"), "+442079460958")
  assert.equal(normalizeUsPhone("call the shop"), "")
})
