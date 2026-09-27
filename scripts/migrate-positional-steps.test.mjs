import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8")

function statementBodies(source) {
  const start = source.indexOf("const statements = [")
  const end = source.indexOf("\n]", start)
  assert.ok(start >= 0 && end > start, "migration statements array exists")
  return [...source.slice(start, end).matchAll(/^  `([\s\S]*?)`(?=,?\r?$)/gm)]
    .map((match) => match[1].replace(/\r\n/g, "\n"))
}

test("legacy migration steps preserve main's original prefix and append S09 ALTERs", () => {
  const mainMigration = execFileSync("git", ["show", "main:scripts/migrate.mjs"], { encoding: "utf8" })
  const originalSteps = statementBodies(mainMigration)
  const currentSteps = statementBodies(migration)
  const appendedSteps = [
    "ALTER TABLE ops_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    "ALTER TABLE claims ADD COLUMN IF NOT EXISTS superseded_by BIGINT REFERENCES claims(id)",
  ]

  assert.ok(originalSteps.length > 0, "main contains the recorded legacy statements")
  const mismatchAt = originalSteps.findIndex((step, index) => currentSteps[index] !== step)
  assert.equal(
    mismatchAt,
    -1,
    `pre-existing positional step ${mismatchAt + 1} differs from main (${JSON.stringify(originalSteps[mismatchAt]?.slice(0, 120))} vs ${JSON.stringify(currentSteps[mismatchAt]?.slice(0, 120))})`,
  )
  assert.deepEqual(currentSteps.slice(originalSteps.length), appendedSteps, "S09 schema changes are appended after all recorded steps")
})
