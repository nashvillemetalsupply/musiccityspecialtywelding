import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

// fileURLToPath, not URL.pathname: the checkout lives under a directory with a
// space in its name, and pathname hands that back percent-encoded, which every
// fs call then fails to find.
const root = fileURLToPath(new URL("..", import.meta.url))
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n")
const cssUnder = (dir) => {
  const out = []
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name)
    if (statSync(join(root, p)).isDirectory()) out.push(...cssUnder(p))
    else if (name.endsWith(".css")) out.push(p)
  }
  return out
}
const BOARD_CSS = ["styles/control.css", ...cssUnder("app/board"), ...cssUnder("app/ops")]
const CONTROL = read("styles/control.css")

test("control.css owns the scale, and nothing on it is below 14px", () => {
  for (const tok of ["--t-caption", "--t-label", "--t-body", "--t-data", "--t-sub", "--t-name", "--t-title", "--t-lede", "--t-display"]) {
    const m = CONTROL.match(new RegExp(`${tok}:\\s*([\\d.]+)px`))
    assert.ok(m, `${tok} is defined in control.css`)
    assert.ok(parseFloat(m[1]) >= 14, `${tok} = ${m[1]}px is under the 14px floor`)
  }
})

test("no board-language stylesheet hard-codes a font-size or redefines a type token", () => {
  for (const file of BOARD_CSS) {
    const css = read(file)
    const hard = [...css.matchAll(/font-size\s*:\s*([\d.]+)px/g)]
    assert.deepEqual(hard.map((m) => m[0]), [], `${file} hard-codes font-size`)
    if (file !== "styles/control.css") {
      assert.doesNotMatch(css, /--t-(caption|label|body|data|sub|name|title|lede):/, `${file} redefines a type token`)
      assert.doesNotMatch(css, /--w-(reg|med|semi):/, `${file} redefines a weight`)
    }
  }
})

test("both weight ladders live in control.css and the dark one is a notch lighter", () => {
  assert.match(CONTROL, /--w-reg:\s*420;\s*--w-med:\s*500;\s*--w-semi:\s*640/)
  assert.match(CONTROL, /--w-reg:\s*400;\s*--w-med:\s*480;\s*--w-semi:\s*620/)
})

test("fonts come from next/font, not a Google @import", () => {
  assert.doesNotMatch(CONTROL, /@import\s+url\(/)
  const fonts = read("app/fonts.ts")
  assert.match(fonts, /Golos_Text\(/)
  assert.match(fonts, /Chivo\(/)
  assert.match(fonts, /adjustFontFallback:\s*true/)
  assert.match(fonts, /display:\s*"swap"/)
  assert.match(CONTROL, /--font:\s*var\(--font-golos\)/)
  assert.match(CONTROL, /--font-display:\s*var\(--font-chivo\)/)
  for (const shell of ["app/ops/layout.tsx", "app/board/page.tsx", "app/board/calls/page.tsx", "app/board/customers/page.tsx", "app/board/updates/page.tsx"]) {
    const src = read(shell)
    assert.match(src, /golos\.variable/, `${shell} applies the Golos variable`)
    assert.match(src, /chivo\.variable/, `${shell} applies the Chivo variable`)
  }
})

test("the floor survives Tailwind's preflight, which sizes small/sub/sup in percentages", () => {
  // The floor is easy to believe and hard to hold, because the rule that broke
  // it is not in this repo. app/globals.css opens with @import "tailwindcss",
  // and preflight ships small{font-size:80%} and sub,sup{font-size:75%}. A
  // percentage names no size, so a grep for px or rem under 14 finds nothing
  // while a bare <small> renders at 80% of the 15px shell base -- 12px. The
  // 2026-09-04 baseline caught exactly this element at 10.8px on the job route.
  // 37 <small> elements are rendered under app/board and app/ops today.
  assert.match(CONTROL, /(^|\n)small\{[^}]*font-size:var\(--t-caption\)/,
    "control.css must floor bare <small>, or Tailwind preflight puts it under 14px")
  assert.match(CONTROL, /(^|\n)sub,sup\{[^}]*font-size:var\(--t-caption\)/,
    "control.css must floor bare <sub>/<sup> for the same reason")
  // And the preflight rules this defends against must still be the ones shipped.
  // If Tailwind ever drops them, this test is guarding nothing and should be
  // re-read rather than deleted.
  const preflight = readFileSync(new URL("../node_modules/tailwindcss/preflight.css", import.meta.url), "utf8")
  assert.match(preflight, /small\s*\{\s*font-size:\s*80%/, "preflight no longer shrinks <small>; re-check this defence")
})
