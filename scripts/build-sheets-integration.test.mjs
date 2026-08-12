import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("Build Sheets migration is additive, rerunnable, immutable, and test-partitioned", async () => {
  const migration = await read("scripts/migrate.mjs")

  for (const table of [
    "build_sketch_job_links",
    "build_claim_conflicts",
    "build_fact_decisions",
    "build_lock_receipts",
    "build_sheet_sequences",
    "build_sheets",
    "build_paperwork",
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))

  assert.match(migration, /CHECK \(is_test = true\)/)
  assert.match(migration, /CREATE TRIGGER build_sheets_immutable/)
  assert.match(migration, /BEFORE UPDATE OR DELETE ON build_sheets/)
  assert.doesNotMatch(migration, /(?:DROP|TRUNCATE)\s+(?:TABLE\s+)?(?:leads|events|claims)/i)
})

test("Builds is absent unless the feature is on for an owner viewing an internal-test job", async () => {
  const [access, page, job] = await Promise.all([
    read("lib/build-sheets-access.ts"),
    read("app/ops/leads/[id]/builds/page.tsx"),
    read("app/ops/leads/[id]/page.tsx"),
  ])

  assert.match(access, /process\.env\.SHOP_BRAIN_LIVING_JOB\?\.trim\(\)\.toLowerCase\(\) === "true"/)
  assert.match(page, /if \(!operator \|\| operator\.role !== "owner" \|\| !buildSheetsEnabled\(\)\) notFound\(\)/)
  assert.match(page, /getBuildsWorkspace\(leadId\)/)
  assert.match(job, /operator\.role === "owner" && lead\.is_test && buildSheetsEnabled\(\)/)
  assert.match(job, /href={`\/ops\/leads\/\$\{lead\.id\}\/builds`}/)
  assert.match(job, /\["quoted_price_cents", "build_fact"\]\.includes\(claim\.predicate\)/)
})

test("Call Sketch ingestion has an explicit test-only job bridge and converges on retry", async () => {
  const [intake, store] = await Promise.all([
    read("lib/job-intake.ts"),
    read("lib/build-sheets.ts"),
  ])

  assert.match(intake, /INSERT INTO build_sketch_job_links/)
  assert.match(intake, /WHERE l\.id = \$\{created\.id\}::bigint AND l\.is_test = true/)
  assert.match(store, /ON CONFLICT \(source_event_id, item_key\).*DO NOTHING/s)
  assert.match(store, /ON CONFLICT \(lead_id, conflict_key\) DO NOTHING/)
  assert.match(store, /WHERE link\.lead_id = \$\{leadId\}::bigint AND link\.is_test = true/)
  assert.doesNotMatch(store, /notify|Needs Attention|Morning Brief/i)
})

test("lock retries return one immutable Build Sheet and allocate the next number without a gap", async () => {
  const [store, migration] = await Promise.all([
    read("lib/build-sheets.ts"),
    read("scripts/migrate.mjs"),
  ])

  assert.match(store, /export async function lockCurrentBuildSheet/)
  assert.match(store, /INSERT INTO build_lock_receipts/)
  assert.match(store, /ON CONFLICT \(lead_id, lock_key\) DO NOTHING/)
  assert.match(store, /UPDATE build_sheet_sequences sequence/)
  assert.match(store, /JOIN receipt ON true/)
  assert.match(store, /UPDATE build_lock_receipts target SET build_sheet_id = sheet\.id/)
  assert.match(store, /WHERE l\.id = \$\{leadId\}::bigint AND l\.is_test = true/)
  assert.match(migration, /UNIQUE \(lead_id, sequence\)/)
})

test("every owner mutation is independently flag-gated, owner-gated, test-partitioned, and silent", async () => {
  const [actions, store] = await Promise.all([
    read("app/ops/leads/[id]/builds/actions.ts"),
    read("lib/build-sheets.ts"),
  ])

  assert.match(actions, /operator\.role !== "owner" \|\| !buildSheetsEnabled\(\)/)
  assert.match(actions, /getBuildsWorkspace\(leadId\)/)
  for (const action of [
    "decideBuildFactAction",
    "proposeBuildFactChangeAction",
    "addWorkingBuildFactAction",
    "lockBuildSheetAction",
  ]) assert.match(actions, new RegExp(`export async function ${action}`))
  assert.match(store, /JOIN operators o ON o\.id = \$\{input\.operatorId\}::bigint AND o\.role = 'owner'/)
  assert.match(store, /WHERE l\.id = \$\{input\.leadId\}::bigint AND l\.is_test = true/)
  assert.doesNotMatch(`${actions}\n${store}`, /INSERT INTO notifications|Needs Attention|Morning Brief/i)
})

test("the owner workspace exposes evidence, decisions, immutable sheets, and dependency-aware Paperwork", async () => {
  const [page, css, store] = await Promise.all([
    read("app/ops/leads/[id]/builds/page.tsx"),
    read("app/ops/jobs.css"),
    read("lib/build-sheets.ts"),
  ])

  for (const label of [
    "Heard on call",
    "Doesn't match",
    "Still need",
    "Working number",
    "Exact utterance",
    "Lock Build Sheet",
    "Read-only record",
    "Paperwork",
    "Old numbers",
    "Hold — change needs review",
  ]) assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.match(page, /disabled=\{workspace\.draft\.conflicts\.length > 0 \|\| acceptedCount === 0\}/)
  assert.match(page, /This record cannot be edited\./)
  assert.match(css, /\.jobs-root \.ops-builds/)
  assert.match(css, /min-height: 48px/)
  assert.match(css, /@media \(min-width: 880px\)/)
  assert.match(store, /kind: "material-note", label: "Material note", dependencies: material/)
})

test("migration seeds exactly one explicit internal fixture without changing notification state", async () => {
  const migration = await read("scripts/migrate.mjs")

  assert.match(migration, /const buildFixturePublicId = "internal-build-sheets-fixture"/)
  assert.match(migration, /'\[INTERNAL TEST\] Gate Build'::text/)
  assert.match(migration, /l\.public_id = \$\{buildFixturePublicId\}::text AND l\.is_test = true/)
  assert.match(migration, /'unresolved-reference'::text/)
  assert.match(migration, /ON CONFLICT \(public_id\) DO NOTHING/)
  assert.match(migration, /ON CONFLICT \(kind, external_id\) WHERE external_id <> '' DO NOTHING/)
  const fixtureBlock = migration.slice(migration.indexOf("const buildFixturePublicId"), migration.indexOf("const tables ="))
  assert.doesNotMatch(fixtureBlock, /notifications|push_subscriptions|messages/i)
})

test("Build Sheets tests join the full gate and owner vocabulary is checked in", async () => {
  const [pkg, glossary] = await Promise.all([
    read("package.json"),
    read("docs/build-sheets-glossary.md"),
  ])

  assert.match(pkg, /scripts\/build-sheets-domain\.test\.mjs/)
  assert.match(pkg, /scripts\/build-sheets-integration\.test\.mjs/)
  for (const term of ["Doesn't match", "Working number", "Build Sheet", "Old numbers", "Paperwork"]) {
    assert.match(glossary, new RegExp(term))
  }
})
