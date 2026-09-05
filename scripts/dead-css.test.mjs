import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = fileURLToPath(new URL("..", import.meta.url))
const read = (path) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n")
const classes = (css) => new Set(css.match(/\.ops-[a-z0-9-]+/g) ?? [])
const ANCESTOR_ALLOWLIST = new Set(`
  .ops-account-page .ops-account-people .ops-add-job-action .ops-card
  .ops-filters .ops-header-actions .ops-job-row .ops-kicker .ops-login .ops-main
  .ops-more-view .ops-phone-row .ops-row-actions .ops-shop-page .ops-sub
  .ops-table-wrap .ops-ticket-actions .ops-ticket-urgent .ops-wall-vnext
  .ops-work-order-vnext
`.trim().split(/\s+/))

test("globals.css carries no ops-era rule", () => {
  const globals = read("app/globals.css")
  assert.equal(classes(globals).size, 0, "an .ops-* selector is still in globals.css")
  assert.ok(globals.split("\n").length < 4000, `globals.css is ${globals.split("\n").length} lines`)
})

test("used ops classes retain their old global rules and legacy ancestors are explicit", () => {
  const oldGlobalsDefined = classes(read("scripts/qa/baseline/pre-retirement-globals.css"))
  const legacyDefined = classes(read("styles/ops-legacy.css"))
  // This deliberately uses the inventory's token scan, not a claim that every
  // token is a rendered class. Route-only classes and non-class tokens need no
  // legacy rule unless the frozen globals actually defined one before the move.
  const out = execFileSync("git", ["grep", "-ho", "ops-[a-z0-9-]*", "--", "app/board", "app/ops", "components"], { cwd: root, encoding: "utf8" })
  const used = new Set(out.trim().split(/\s+/).filter(Boolean).map((name) => `.${name}`))
  for (const name of used) {
    if (oldGlobalsDefined.has(name)) assert.ok(legacyDefined.has(name), `${name} lost its rule`)
  }
  for (const name of legacyDefined) {
    assert.ok(used.has(name) || ANCESTOR_ALLOWLIST.has(name), `${name} has a rule but nothing renders it`)
  }
})

test("the rejected design previews are gone", () => {
  // Assert on files, not on the directory. existsSync() of a directory is true
  // for an EMPTY one, and git does not track empty directories -- so a stale
  // local `app/design-preview/<something>/` left behind by abandoned work
  // survives the deletion commit and fails this test on a checkout whose
  // repository contents are entirely correct.
  //
  // That is exactly what happened at the root during this landing: one empty
  // directory dated three weeks earlier, never tracked on any branch, zero
  // files under it. The worktree passed, the root failed, and the difference
  // was not the code. An empty directory is not a route either -- Next needs a
  // page.tsx -- so it renders nothing and 404s regardless.
  //
  // Counting files is immune to that noise and stricter about what matters: it
  // fails if ANY file reappears anywhere underneath, which the directory check
  // could not tell apart from the empty case.
  const dir = join(root, "app/design-preview")
  const files = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else files.push(p.slice(root.length).replace(/\\/g, "/"))
    }
  }
  if (existsSync(dir)) walk(dir)
  assert.deepEqual(files, [], "a design-preview file is back")
})

test("all five route entry points load legacy CSS before component and control styles", () => {
  for (const path of ["app/ops/layout.tsx", "app/board/page.tsx", "app/board/calls/page.tsx", "app/board/customers/page.tsx", "app/board/updates/page.tsx"]) {
    assert.match(read(path), /^import "(?:\.\.\/)+styles\/ops-legacy\.css"\n/, `${path} must import legacy first to preserve the old cascade`)
  }
  assert.match(read("app/globals.css"), /^@import "\.\.\/tokens\.css";/m)
  assert.doesNotMatch(read("styles/ops-legacy.css"), /@import/)
})
