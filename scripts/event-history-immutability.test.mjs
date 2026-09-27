import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8")
const statementMatch = source.match(/const eventsImmutabilityStatement = `([\s\S]*?)`\r?\n/)

class MemoryPostgres {
  triggers = new Map()

  async query(statement) {
    assert.match(statement, /CREATE OR REPLACE FUNCTION events_no_delete\(\)/)
    assert.match(statement, /RAISE EXCEPTION 'events is immutable'/)

    const normalized = statement.replace(/\s+/g, " ")
    for (const [, name] of normalized.matchAll(/DROP TRIGGER IF EXISTS (\w+) ON (?:events|lead_events);/g)) {
      this.triggers.delete(name)
    }
    for (const [, name, operations, table] of normalized.matchAll(
      /CREATE TRIGGER (\w+) BEFORE (INSERT OR UPDATE OR DELETE|DELETE) ON (events|lead_events) FOR EACH ROW EXECUTE FUNCTION events_no_delete\(\);/g,
    )) {
      this.triggers.set(name, { operations: operations.split(" OR "), table })
    }
    return { rows: [] }
  }

  execute(table, operation) {
    for (const trigger of this.triggers.values()) {
      if (trigger.table === table && trigger.operations.includes(operation)) {
        throw new Error("events is immutable")
      }
    }
  }
}

test("migration defines and behaviorally installs immutable history triggers", async () => {
  assert.ok(statementMatch, "migration must install the named history triggers")
  const statement = statementMatch[1]
  assert.match(statement, /DROP TRIGGER IF EXISTS events_truth_no_delete ON events/)
  assert.match(statement, /DROP TRIGGER IF EXISTS lead_events_frozen ON lead_events/)
  assert.match(statement, /CREATE TRIGGER events_truth_no_delete BEFORE DELETE ON events/)
  assert.match(statement, /CREATE TRIGGER lead_events_frozen BEFORE INSERT OR UPDATE OR DELETE ON lead_events/)

  const database = new MemoryPostgres()
  await database.query(statement)
  await database.query(statement)

  assert.throws(() => database.execute("events", "DELETE"), /events is immutable/)
  assert.throws(() => database.execute("lead_events", "INSERT"), /events is immutable/)
  assert.throws(() => database.execute("lead_events", "UPDATE"), /events is immutable/)
  assert.throws(() => database.execute("lead_events", "DELETE"), /events is immutable/)
  assert.doesNotThrow(() => database.execute("events", "INSERT"))
  assert.equal(database.triggers.size, 2, "rerunning the DDL leaves one trigger per protected table")
})
