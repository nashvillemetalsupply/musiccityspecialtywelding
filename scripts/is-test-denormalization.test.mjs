import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const tableNames = ["events", "claims", "commitments", "calls", "messages", "notifications"]
const migration = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8")

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.(?:[cm]?js|tsx?)$/.test(entry.name) && !entry.name.endsWith(".test.mjs") ? [path] : []
  })
}

function insertColumnListEnd(source, openParen) {
  let depth = 1
  for (let index = openParen + 1; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1
    if (source[index] === ")") depth -= 1
    if (depth === 0) return index
  }
  throw new Error("Unclosed INSERT column list")
}

function insertSites(source, file) {
  const sites = []
  const expression = new RegExp(`\\bINSERT\\s+INTO\\s+(${tableNames.join("|")})\\s*\\(`, "gi")
  for (const match of source.matchAll(expression)) {
    const openParen = match.index + match[0].lastIndexOf("(")
    const closeParen = insertColumnListEnd(source, openParen)
    const columns = source.slice(openParen + 1, closeParen).toLowerCase()
    sites.push({ table: match[1].toLowerCase(), file, start: match.index, closeParen, columns })
  }
  return sites
}

function statementBodies(source) {
  const start = source.indexOf("const statements = [")
  const end = source.indexOf("\n]", start)
  assert.ok(start >= 0 && end > start, "migration statements array exists")
  return [...source.slice(start, end).matchAll(/^  `([\s\S]*?)`(?=,?\r?$)/gm)]
    .map((match) => match[1].replace(/\r\n/g, "\n"))
}

function fakeSqlIsTestRow({ leadIsTest = false, personIsTest = false, sourceEventIsTest = false, draftIsTest = false, detail = null, text = "" }) {
  return leadIsTest || personIsTest || sourceEventIsTest || draftIsTest
    || String(detail?.isTest ?? "false").toLowerCase() === "true"
    || `${JSON.stringify(detail ?? {})} ${text}`.toLowerCase().includes("[internal test]")
}

test("every INSERT into the six denormalized tables writes is_test through the shared classifier", () => {
  const roots = ["../app", "../lib", "."].map((path) => fileURLToPath(new URL(path, import.meta.url)))
  const files = roots.flatMap((path) => walk(path))
  const missing = []
  for (const file of files) {
    const source = readFileSync(file, "utf8")
    const sites = insertSites(source, file)
    if (!sites.length) continue
    for (const [index, site] of sites.entries()) {
      if (!/\bis_test\b/.test(site.columns)) missing.push(`${file}: INSERT INTO ${site.table} omits is_test`)
      const nextTargetInsert = sites[index + 1]?.start ?? source.length
      const valueWindow = source.slice(site.closeParen + 1, Math.min(nextTargetInsert, site.closeParen + 1800))
      const cteWindow = source.slice(Math.max(0, site.start - 900), site.start)
      if (!/\bmcsw_is_test_row\s*\(/i.test(valueWindow) && !/\bmcsw_is_test_row\s*\(/i.test(cteWindow)) {
        missing.push(`${file}: INSERT INTO ${site.table} does not use mcsw_is_test_row to set is_test`)
      }
    }
  }
  assert.deepEqual(missing, [], missing.join("\n"))
})

test("read marker classifiers and positional backfills use the same test-row inputs", () => {
  const steps = statementBodies(migration)
  const backfills = steps.filter((step) => /^UPDATE (events|claims|commitments|calls|messages|notifications) \w+ SET is_test = true/m.test(step))
  assert.deepEqual(backfills.map((step) => step.match(/^UPDATE (\w+)/m)?.[1]), tableNames)
  for (const step of backfills) {
    assert.match(step, /WHERE \w+\.is_test = false\s+AND mcsw_is_test_row\([\s\S]+\) = true$/)
  }

  const helper = steps.find((step) => step.startsWith("CREATE OR REPLACE FUNCTION mcsw_is_test_row("))
  assert.ok(helper, "the shared classifier is installed before backfill")
  assert.match(helper, /ILIKE '%\[INTERNAL TEST\]%'/)
  assert.match(helper, /lower\(COALESCE\(p_detail->>'isTest', 'false'\)\) = 'true'/)
  assert.match(helper, /lead\.first_name[\s\S]+lead\.message[\s\S]+lead\.notes/)
  assert.match(helper, /person\.display_name[\s\S]+person\.phones::text[\s\S]+person\.emails::text/)
  assert.match(helper, /source_event\.body[\s\S]+source_event\.crew_body[\s\S]+source_event\.detail::text/)
  assert.match(helper, /draft\.call_sid = p_call_sid AND draft\.is_test = true/)

  const readSources = [
    "../lib/events.ts", "../lib/event-access.ts", "../lib/ops-data.ts", "../lib/ops-pulse.mjs",
    "../lib/commitments.ts", "../lib/delivery-errors.ts", "../app/api/health/route.ts",
    "../app/api/ops/attachment/route.ts", "../app/api/ops/brief/route.ts",
  ]
  const markerReadSources = readSources.map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    .filter((source) => /ILIKE '%\[INTERNAL TEST\]%'/i.test(source))
  assert.ok(markerReadSources.length >= 6, "existing read predicates remain as the belt")
  for (const source of markerReadSources) assert.match(source, /ILIKE '%\[INTERNAL TEST\]%'/i)

  const migrationTail = steps.slice(-13)
  assert.equal(migrationTail.length, 13, "six columns, one helper, and six backfills are appended together")
  assert.deepEqual(migrationTail.slice(0, 6).map((step) => step.match(/^ALTER TABLE (\w+)/)?.[1]), tableNames)
  assert.equal(migrationTail[6], helper)
  assert.deepEqual(migrationTail.slice(7), backfills)
})

test("existing read predicates and the shared backfill classifier keep every intake partition aligned", () => {
  const readPredicates = {
    events: ["../lib/events.ts", "../lib/event-access.ts", "../lib/ops-data.ts", "../lib/ops-pulse.mjs", "../app/api/ops/attachment/route.ts"],
    claims: ["../lib/ops-data.ts"],
    commitments: ["../lib/commitments.ts", "../lib/ops-data.ts", "../app/api/ops/brief/route.ts"],
    calls: ["../app/api/health/route.ts", "../lib/ops-pulse.mjs", "../lib/delivery-errors.ts"],
    messages: ["../app/api/ops/attachment/route.ts"],
    notifications: ["../lib/ops-pulse.mjs"],
  }
  for (const [table, paths] of Object.entries(readPredicates)) {
    assert.ok(paths.length > 0, `${table} has at least one existing belt predicate`)
    for (const path of paths) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8")
      assert.match(source, /INTERNAL TEST/i, `${table} reader ${path} keeps its copied classifier`)
    }
  }

  // Current event readers differ in whether linked person fields participate,
  // and call readers mix ILIKE with a case-sensitive marker check. The helper
  // and backfill deliberately take the union so neither variant under-marks.
  const helper = statementBodies(migration).find((step) => step.startsWith("CREATE OR REPLACE FUNCTION mcsw_is_test_row("))
  const backfills = statementBodies(migration).filter((step) => /^UPDATE (events|claims|commitments|calls|messages|notifications) \w+ SET is_test = true/m.test(step))
  assert.match(helper, /OR concat_ws\(' ', p_text, p_detail::text/)
  assert.match(helper, /lead_person\.phones::text[\s\S]+source_event_person\.phones::text/)
  assert.match(helper, /OR lower\(COALESCE\(source_event\.detail->>'isTest', 'false'\)\) = 'true'/)
  assert.match(helper, /ILIKE '%\[INTERNAL TEST\]%'/)
  assert.match(backfills.find((step) => step.startsWith("UPDATE events")), /e\.body, e\.crew_body, e\.detail::text/)
  assert.match(backfills.find((step) => step.startsWith("UPDATE calls")), /c\.twilio_sid/)

  const intakePaths = [
    ["../app/api/quote/route.ts", /createLead\(/],
    ["../app/api/twilio/voice/route.ts", /mcsw_is_test_row[\s\S]+UPDATE calls[\s\S]+is_test = is_test OR mcsw_is_test_row/],
    ["../app/api/twilio/sms/route.ts", /INSERT INTO messages[\s\S]+mcsw_is_test_row[\s\S]+UPDATE messages[\s\S]+is_test = is_test OR mcsw_is_test_row/],
    ["../lib/glass-uploads.ts", /INSERT INTO messages[\s\S]+mcsw_is_test_row[\s\S]+INSERT INTO events[\s\S]+mcsw_is_test_row/],
  ]
  for (const [path, contract] of intakePaths) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), contract)
  }

  const tableFixtures = tableNames.map((table) => ({ table, text: `row for ${table}` }))
  for (const row of tableFixtures) {
    assert.equal(fakeSqlIsTestRow({ ...row, leadIsTest: true }), true, `${row.table} copies a test lead's flag`)
    assert.equal(fakeSqlIsTestRow({ ...row, leadIsTest: false }), false, `${row.table} keeps a normal lead false`)
  }
  assert.equal(fakeSqlIsTestRow({ text: "ordinary body with [INTERNAL TEST] marker" }), true)
  assert.equal(fakeSqlIsTestRow({ detail: { isTest: true }, text: "ordinary body" }), true)
})
