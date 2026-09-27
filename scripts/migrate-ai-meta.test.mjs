import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8")
const metaStep = "ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb"

test("automation_runs.meta migration is the final statements-array step", () => {
  const statementsStart = migration.indexOf("const statements = [")
  const statementsEnd = migration.indexOf("\n]\n", statementsStart)
  const metaIndex = migration.indexOf(metaStep)

  assert.ok(statementsStart >= 0, "migration statements list exists")
  assert.ok(statementsEnd > statementsStart, "migration statements list closes")
  assert.ok(metaIndex > statementsStart && metaIndex < statementsEnd, "meta migration is inside the statements list")
  assert.equal(migration.split(metaStep).length - 1, 1, "meta migration appears exactly once")
  assert.doesNotMatch(migration.slice(metaIndex + metaStep.length, statementsEnd), /`(?:CREATE|ALTER|UPDATE|INSERT|DELETE|COMMENT|DO)\b/i, "no SQL step follows the meta migration")
  assert.doesNotMatch(migration.slice(statementsEnd), new RegExp(metaStep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "meta migration is not in the procedural tail")
})
