import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// The plan's draft resolved the root through `URL.pathname`, which is percent-encoded:
// under a checkout whose path contains spaces every read raised ENOENT on a "%20" path.
// `new URL(relative, import.meta.url)` handed straight to readFileSync is the decoding
// form the rest of scripts/*.test.mjs already uses.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")

const FORMS = ["app/ops/intake/job-intake-form.tsx", "app/ops/intake/inline-job-intake.tsx"]

test("phone fields open the tel keypad and autofill", () => {
  for (const f of FORMS) {
    const src = read(f)
    for (const m of src.matchAll(/<input[^>]*type="tel"[^>]*>/gs)) {
      assert.match(m[0], /autoComplete="tel"/, `${f}: ${m[0].slice(0, 60)}`)
      assert.match(m[0], /inputMode="tel"/, `${f}: ${m[0].slice(0, 60)}`)
    }
  }
})

test("name and email fields autofill", () => {
  for (const f of FORMS) {
    const src = read(f)
    assert.match(src, /autoComplete="name"/, `${f} has no name autofill`)
    for (const m of src.matchAll(/<input[^>]*type="email"[^>]*>/gs)) assert.match(m[0], /autoComplete="email"/)
  }
})

test("every input in the intake forms is labelled", () => {
  for (const f of FORMS) {
    const src = read(f)
    for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*>/gs)) {
      const tag = m[0]
      if (/type="(hidden|submit)"/.test(tag)) continue
      assert.ok(/\bid=/.test(tag) || /aria-label=/.test(tag), `${f}: unlabelled ${tag.slice(0, 80)}`)
    }
  }
})

test("a failed submit moves focus to the first invalid field, and a pending one says so", () => {
  for (const f of FORMS) {
    const src = read(f)
    assert.match(src, /\[aria-invalid="true"\]/, `${f} does not focus the first invalid field`)
    assert.match(src, /aria-busy=\{/, `${f} has no aria-busy`)
  }
})
