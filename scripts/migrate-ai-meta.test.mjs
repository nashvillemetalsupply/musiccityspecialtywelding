import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const metaStep = "ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb"
const opsSessionStep = "ALTER TABLE ops_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()"
const claimSupersessionStep = "ALTER TABLE claims ADD COLUMN IF NOT EXISTS superseded_by BIGINT REFERENCES claims(id)"

test("automation_runs.meta stays before the appended S09 migration steps", () => {
  const statementsStart = migration.indexOf("const statements = [")
  const statementsEnd = migration.indexOf("\n]\n", statementsStart)
  const metaIndex = migration.indexOf(metaStep)
  const opsSessionIndex = migration.indexOf(opsSessionStep)
  const claimSupersessionIndex = migration.indexOf(claimSupersessionStep)

  assert.ok(statementsStart >= 0, "migration statements list exists")
  assert.ok(statementsEnd > statementsStart, "migration statements list closes")
  assert.ok(metaIndex > statementsStart && metaIndex < statementsEnd, "meta migration is inside the statements list")
  assert.equal(migration.split(metaStep).length - 1, 1, "meta migration appears exactly once")
  assert.ok(opsSessionIndex > metaIndex && opsSessionIndex < statementsEnd, "the session migration follows the meta migration")
  assert.ok(claimSupersessionIndex > opsSessionIndex && claimSupersessionIndex < statementsEnd, "the claims migration is the final array step")
  assert.doesNotMatch(migration.slice(claimSupersessionIndex + claimSupersessionStep.length, statementsEnd), /`(?:CREATE|ALTER|UPDATE|INSERT|DELETE|COMMENT|DO)\b/i, "no SQL step follows the claims migration")
  assert.doesNotMatch(migration.slice(statementsEnd), new RegExp(metaStep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "meta migration is not in the procedural tail")
})
