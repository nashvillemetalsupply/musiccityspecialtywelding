import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = fileURLToPath(new URL("..", import.meta.url))
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n")
const pagesUnder = (dir) => {
  const out = []
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name)
    if (statSync(join(root, p)).isDirectory()) out.push(...pagesUnder(p))
    else if (name === "page.tsx") out.push(p)
  }
  return out
}
const PAGES = [...pagesUnder("app/board"), ...pagesUnder("app/ops")]

test("every CRM page exports a title", () => {
  for (const p of PAGES) assert.match(read(p), /title:\s*["`']/, `${p} has no metadata title`)
})

test("exactly one main per route, and it is #main", () => {
  // /ops pages sit under a layout that owns the landmark; the three board
  // satellites and board.tsx render their own, so theirs must be #main.
  for (const p of pagesUnder("app/ops")) assert.doesNotMatch(read(p), /<main[\s>]/, `${p} renders a nested <main>`)
  assert.match(read("app/ops/layout.tsx"), /<main id="main" tabIndex=\{-1\}>/)
  for (const p of ["app/board/board.tsx", "app/board/calls/page.tsx", "app/board/customers/page.tsx", "app/board/updates/page.tsx"]) {
    const src = read(p)
    assert.equal((src.match(/<main[\s>]/g) ?? []).length, 1, `${p} renders ${(src.match(/<main[\s>]/g) ?? []).length} <main>`)
    assert.match(src, /<main id="main" tabIndex=\{-1\}/, `${p}'s main is not #main`)
  }
})

test("both shells put the skip link first", () => {
  assert.match(read("app/board/skip-link.tsx"), /href="#main"/)
  assert.match(read("app/board/board.tsx"), /<SkipLink/)
  assert.match(read("app/ops/ops-header.tsx"), /<SkipLink/)
})

test("/board has its own error, not-found and loading surfaces in the board language", () => {
  for (const f of ["error.tsx", "not-found.tsx", "loading.tsx"]) {
    const src = read(`app/board/${f}`)
    assert.match(src, /href="\/board"/, `${f} links back to the tracker`)
    assert.doesNotMatch(src, /#[0-9a-f]{3,6}\b/i, `${f} names a hex colour`)
  }
})

test("ops fallback and form components inherit the layout landmark", () => {
  for (const p of ["error.tsx", "loading.tsx", "not-found.tsx", "login-form.tsx", "intake/job-intake-form.tsx"]) {
    assert.doesNotMatch(read(`app/ops/${p}`), /<main[\s>]/, `${p} renders a nested main`)
  }
  assert.match(read("app/ops/layout.tsx"), /!operator && <SkipLink/)
})

test("the visible tracker title is the board's only h1", () => {
  const src = read("app/board/board.tsx")
  assert.equal((src.match(/<h1[\s>]/g) ?? []).length, 1)
  assert.match(src, /<h1 className="t-title">Job tracker<\/h1>/)
  assert.doesNotMatch(src, /<h[3-6][\s>]/)
})

test("embedded Call Sketch inherits the ops landmark", () => {
  const src = read("components/call-sketch/call-sketch-prototype.tsx")
  assert.match(src, /const Surface = embedded \? "div" : "main"/)
  assert.match(src, /<Surface className=/)
  assert.doesNotMatch(src, /<main[\s>]/)
})
