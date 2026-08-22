import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

function sourceFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs)$/.test(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
}

test("nothing writes lead_events any more", () => {
  const offenders = [...sourceFiles("app"), ...sourceFiles("lib")]
    .filter((file) => readFileSync(file, "utf8").includes("INSERT INTO lead_events"))
  assert.deepEqual(offenders, [])
})

test("the creation gates read the events journal", () => {
  const leads = readFileSync("lib/leads.ts", "utf8")
  assert.doesNotMatch(leads, /FROM lead_events/)
  const intake = readFileSync("lib/job-intake.ts", "utf8")
  assert.doesNotMatch(intake, /FROM lead_events/)
  assert.match(intake, /'form\.quote','lead\.intake\.restored'/)
})

test("the dead lead_events reader is gone", () => {
  assert.doesNotMatch(readFileSync("lib/ops-data.ts", "utf8"), /FROM lead_events/)
})

test("the frozen table is documented, not dropped", () => {
  const migrate = readFileSync("scripts/migrate.mjs", "utf8")
  assert.match(migrate, /CREATE TABLE IF NOT EXISTS lead_events/)
  assert.match(migrate, /COMMENT ON TABLE lead_events/)
  assert.doesNotMatch(migrate, /DROP TABLE[^`]*lead_events/)
})
