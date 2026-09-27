import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

function claimRoutingCte(sqlSource, endMarker) {
  const start = sqlSource.indexOf("claim_candidates AS MATERIALIZED")
  const end = sqlSource.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, "routed projection must include the claim-history CTEs")
  return sqlSource.slice(start, end)
}

test("lead routing preserves the original claim and links a target replacement", () => {
  const reconciliation = source("lib/routing.ts")
  const operatorRouting = source("app/ops/actions.ts")
  const migration = source("scripts/migrate.mjs")

  for (const sql of [
    claimRoutingCte(reconciliation, "    SELECT target_id,"),
    claimRoutingCte(operatorRouting, "    ), claim_write AS"),
  ]) {
    assert.match(sql, /INSERT INTO claims\s*\([\s\S]*?item_key\s*\)/)
    assert.match(sql, /candidate\.target_id/)
    assert.match(sql, /candidate\.id::text/)
    assert.match(sql, /UPDATE claims prior SET superseded_by = replacement\.id/)
    assert.match(sql, /prior\.superseded_by IS NULL/)
    assert.doesNotMatch(sql, /UPDATE claims[^`]*SET subject_id/)
  }
  assert.match(migration, /ALTER TABLE claims ADD COLUMN IF NOT EXISTS superseded_by BIGINT REFERENCES claims\(id\)/)
})
