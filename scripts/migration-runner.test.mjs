import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runWithMigrationLock } from "./migration-runner.mjs"

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const migrationSource = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8")

class MemoryMigrationDatabase {
  applied = new Map()
  queries = []
  lockHolder = null
  waiters = []
  nextClientId = 1

  createPool() {
    return new MemoryPool(this)
  }

  async query(client, text, values = []) {
    this.queries.push({ client: client.id, text, values })
    if (text.startsWith("SELECT pg_advisory_lock")) {
      while (this.lockHolder && this.lockHolder !== client.id) {
        await new Promise((resolve) => this.waiters.push(resolve))
      }
      this.lockHolder = client.id
      return { rows: [{}] }
    }
    if (text.startsWith("SELECT pg_advisory_unlock")) {
      assert.equal(this.lockHolder, client.id)
      this.lockHolder = null
      this.waiters.shift()?.()
      return { rows: [{ pg_advisory_unlock: true }] }
    }
    if (text.startsWith("SELECT name FROM schema_migrations")) {
      return { rows: this.applied.has(values[0]) ? [{ name: values[0] }] : [] }
    }
    if (text.startsWith("INSERT INTO schema_migrations")) {
      const name = values[0]
      this.applied.set(name, (this.applied.get(name) ?? 0) + 1)
      return { rows: [] }
    }
    return { rows: [] }
  }
}

class MemoryPool {
  constructor(database) {
    this.database = database
    this.ended = false
  }

  async connect() {
    const client = {
      id: this.database.nextClientId++,
      query: (text, values) => this.database.query(client, text, values),
      release: (error) => {
        client.releaseError = error
        client.released = true
      },
    }
    return client
  }

  async end() {
    this.ended = true
  }
}

test("concurrent migration runs serialize and record every named step once", async () => {
  const database = new MemoryMigrationDatabase()
  const poolA = database.createPool()
  const poolB = database.createPool()
  const executions = new Map()
  let activeSteps = 0
  let maximumActiveSteps = 0

  const recordStep = async (name) => {
    activeSteps += 1
    maximumActiveSteps = Math.max(maximumActiveSteps, activeSteps)
    executions.set(name, (executions.get(name) ?? 0) + 1)
    await pause(10)
    activeSteps -= 1
  }
  const options = (pool) => ({
    pool,
    steps: [
      { name: "first", run: () => recordStep("first") },
      { name: "second", run: () => recordStep("second") },
    ],
    runTail: () => recordStep("legacy-procedural-tail"),
  })

  await Promise.all([
    runWithMigrationLock(options(poolA)),
    runWithMigrationLock(options(poolB)),
  ])

  assert.equal(maximumActiveSteps, 1, "only one runner may execute migration work at a time")
  assert.deepEqual([...executions.entries()].sort(), [
    ["first", 1],
    ["legacy-procedural-tail", 1],
    ["second", 1],
  ])
  assert.deepEqual([...database.applied.entries()].sort(), [
    ["first", 1],
    ["legacy-procedural-tail", 1],
    ["second", 1],
  ])
  assert.equal(database.queries.filter(({ text }) => text.startsWith("SELECT pg_advisory_lock")).length, 2)
  assert.equal(database.queries.filter(({ text }) => text.startsWith("BEGIN")).length, 3)
  assert.equal(database.queries.filter(({ text }) => text.startsWith("COMMIT")).length, 3)
  assert.ok(database.queries.some(({ text }) => text.includes("CREATE TABLE IF NOT EXISTS schema_migrations")))
  assert.ok(database.queries.some(({ text, values }) => text.includes("SET lock_timeout") && values.length === 0))
  assert.ok(database.queries.some(({ text }) => text.includes("SET statement_timeout")))
  assert.ok(database.queries.some(({ text }) => text.includes("SET idle_session_timeout")))
  assert.ok(database.queries.some(({ text }) => text.includes("WHERE name = $1::text")))
  assert.ok(database.queries.some(({ text }) => text.includes("VALUES ($1::text, now())")))
  assert.equal(poolA.ended, true)
  assert.equal(poolB.ended, true)
  assert.equal(database.lockHolder, null)
})

test("a failed named step rolls back and releases the lock so a safe rerun can finish", async () => {
  const database = new MemoryMigrationDatabase()
  let shouldFail = true
  let attempts = 0
  const makeOptions = () => ({
    pool: database.createPool(),
    steps: [{
      name: "retryable",
      run: async () => {
        attempts += 1
        if (shouldFail) throw new Error("simulated step failure")
      },
    }],
  })

  await assert.rejects(runWithMigrationLock(makeOptions()), /simulated step failure/)
  assert.equal(database.applied.has("retryable"), false)
  assert.equal(database.lockHolder, null)

  shouldFail = false
  await runWithMigrationLock(makeOptions())
  assert.equal(attempts, 2)
  assert.equal(database.applied.get("retryable"), 1)
  assert.equal(database.lockHolder, null)
})

test("the migration entry point routes the existing SQL list and procedural tail through the Pool lock", () => {
  assert.match(migrationSource, /import \{ Pool \} from "@neondatabase\/serverless"/)
  assert.match(migrationSource, /import \{ runWithMigrationLock \} from "\.\/migration-runner\.mjs"/)
  assert.match(migrationSource, /name: `legacy-sql-\$\{String\(index \+ 1\)\.padStart\(4, "0"\)\}`/)
  assert.match(migrationSource, /\{ name: "events-lead-events-immutable", query: eventsImmutabilityStatement \}/)
  assert.match(migrationSource, /runTail: \(client\) => runLegacyProceduralTail\(createTaggedSql\(client\)\)/)
  assert.match(migrationSource, /if \(process\.argv\[1\].*pathToFileURL\(process\.argv\[1\]\)/)
  assert.doesNotMatch(migrationSource, /\bawait sql\.query\(statement\)/)
})
