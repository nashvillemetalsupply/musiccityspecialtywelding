import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = new URL("..", import.meta.url)
const source = (path) => readFileSync(new URL(path, root), "utf8")
const exists = (path) => existsSync(new URL(path, root))

test("ops layout wears the board language and the old sheets are gone", () => {
  const layout = source("app/ops/layout.tsx")
  assert.match(layout, /control\.css/)
  assert.match(layout, /ops-shell\.css/)
  assert.doesNotMatch(layout, /jobs-brand/)
  assert.doesNotMatch(layout, /jobs\.css/)
  assert.doesNotMatch(layout, /jobs-root|jobs-product-frame|data-jobs-theme/)
  assert.match(layout, /colorScheme:\s*"dark"/)
  assert.equal(exists("app/ops/jobs-brand.css"), false)
  assert.equal(exists("app/ops/jobs.css"), false)
})

test("/ops front door is the board", () => {
  const home = source("app/ops/page.tsx")
  assert.match(home, /redirect\("\/board"\)/)
  assert.match(home, /force-dynamic/)
})

test("the two legacy job indexes are archived, not live", () => {
  assert.equal(exists("app/ops/weighted-job-index.tsx"), false)
  assert.equal(exists("app/ops/active-job-index.tsx"), false)
  for (const file of ["jobs.css.txt", "jobs-brand.css.txt", "weighted-job-index.tsx.txt", "active-job-index.tsx.txt", "README.md"]) {
    assert.equal(exists(`archive/ops-legacy-2026-08-20/${file}`), true, `archive/ops-legacy-2026-08-20/${file} must exist`)
  }
})

test("the layout owns control.css; no child imports it directly", () => {
  const offenders = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.(tsx|ts|css)$/.test(name)) continue
      if (full.endsWith(join("app", "ops", "layout.tsx"))) continue
      if (readFileSync(full, "utf8").match(/import\s+"[./]*styles\/control\.css"/)) offenders.push(full)
    }
  }
  walk(fileURLToPath(new URL("app/ops", root)))
  assert.deepEqual(offenders, [])
})

test("the menu inerts the new shell's page surface", () => {
  const more = source("app/ops/more-menu.tsx")
  assert.doesNotMatch(more, /\.jobs-root/)
  assert.match(more, /\.ops-shell main/)
})
