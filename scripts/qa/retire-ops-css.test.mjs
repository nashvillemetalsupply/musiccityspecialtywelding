import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { classify, scanClassUsage, sourceUsageFromTexts } from "./retire-ops-css.mjs"
import test from "node:test"

const root = fileURLToPath(new URL("../..", import.meta.url))

test("class scanning covers app, components, lib, and static className strings", () => {
  const usage = scanClassUsage(root)
  assert.ok(usage.filesScanned > 100)
  assert.ok(usage.classes.has(".ms-hero"))
  assert.ok(usage.classes.has(".glass-page"))
})

test("unused selector arms are deleted while live and dynamically composed prefixes stay", () => {
  const usage = sourceUsageFromTexts([
    '<section className={active ? "ms-live" : "ms-inactive"} />',
    '<section className={`glass-${tone}`} />',
    'const className = "ops-" + state',
  ])
  const source = [
    ".ms-live { color: red; }",
    ".ms-inactive { color: gray; }",
    ".ms-dead { color: blue; }",
    ".ms-dead .ms-live { border: 0; }",
    ".ms-live:not(.ms-hidden) { outline: 0; }",
    ".glass-current { display: block; }",
    ".glass-current:not(.glass-hidden) { display: grid; }",
    ".ops-dynamic { opacity: 1; }",
  ].join("\n")
  const result = classify(source, usage)

  assert.match(result.text.KEEP, /\.ms-live/)
  assert.match(result.text.KEEP, /\.ms-inactive/)
  assert.match(result.text.KEEP, /\.ms-live:not\(\.ms-hidden\)/)
  assert.match(result.text.KEEP, /\.glass-current/)
  assert.match(result.text.KEEP, /\.glass-current:not\(\.glass-hidden\)/)
  assert.match(result.text.KEEP, /\.ops-dynamic/)
  assert.doesNotMatch(result.text.KEEP, /\.ms-dead/)
  assert.deepEqual([...result.stats.deletedClasses], [".ms-dead"])
})

test("the retirement set has no source references in app, components, or lib", () => {
  const baseline = readFileSync(join(root, "scripts", "qa", "baseline", "pre-s11-public-css.css"), "utf8")
  const usage = scanClassUsage(root)
  const result = classify(baseline, usage)
  assert.ok(result.stats.deletedClasses.size > 0, "the S11 pass must retire at least one dead selector")

  for (const name of result.stats.deletedClasses) {
    assert.equal(usage.classes.has(name), false, `${name} has a static source reference`)
    const prefix = /^\.(ops|ms|glass)-/.exec(name)?.[1]
    assert.equal(prefix ? usage.dynamicPrefixes.has(prefix) : false, false, `${name} has a dynamic source prefix`)
  }
})
