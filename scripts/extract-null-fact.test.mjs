import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("extraction skips facts with no value before calling addClaim", () => {
  const extract = source("lib/extract.ts")
  const loop = extract.slice(extract.indexOf("for (const fact of object.facts)"))
  const beforeClaim = loop.slice(0, loop.indexOf("await addClaim("))
  assert.match(beforeClaim, /if \(fact\.value === undefined \|\| fact\.value === null\) continue/)
})

test("claim inserts reject missing values with the predicate before accessing SQL", () => {
  const claims = source("lib/claims.ts")
  for (const [name, input] of [["addClaim", "input"], ["supersedeClaim", "replacement"]]) {
    const body = claims.slice(claims.indexOf(`export async function ${name}(`))
    const beforeSql = body.slice(0, body.indexOf("const sql = getSql()"))
    assert.ok(beforeSql.includes(`if (${input}.value === undefined || ${input}.value === null)`))
    assert.match(beforeSql, /throw new Error\(/)
    assert.ok(beforeSql.includes(`\${${input}.predicate}`), "the error identifies the predicate")
  }
})
