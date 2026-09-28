import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8")
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("S06 adds only idempotent indexes whose leading columns serve named queries", () => {
  const indexes = [
    ["leads_next_follow_up_idx", /ON leads\(next_follow_up_at\) WHERE next_follow_up_at IS NOT NULL/, source("lib/recovery-sweep.ts"), /WHERE next_follow_up_at IS NOT NULL[\s\S]*?ORDER BY next_follow_up_at ASC/],
    ["leads_scheduled_at_idx", /ON leads\(scheduled_at\)/, source("lib/job-calendar-data.ts"), /WHERE l\.scheduled_at >=[\s\S]*?ORDER BY l\.scheduled_at ASC/],
    ["leads_won_at_idx", /ON leads\(won_at\)/, source("lib/ops-data.ts"), /status = 'won' AND won_at >=/],
    ["events_occurred_at_idx", /ON events\(occurred_at\)/, source("lib/events.ts"), /export async function listTodayEvents[\s\S]*?WHERE e\.occurred_at >=[\s\S]*?ORDER BY e\.occurred_at DESC/],
    ["commitments_person_open_idx", /ON commitments\(person_id, due_at\) WHERE status = 'open'/, source("lib/accounts.ts"), /c\.status = 'open'[\s\S]*?c\.person_id = ANY/],
    ["calls_to_phone_idx", /ON calls\(to_phone\)/, source("lib/ops-data.ts"), /SELECT count\(DISTINCT to_phone\)[\s\S]*?WHERE to_phone = ANY/],
    ["rate_limits_ts_idx", /ON rate_limits\(ts\)/, source("lib/recovery-sweep.ts"), /DELETE FROM rate_limits WHERE ts </],
  ]

  for (const [name, definition, querySource, queryShape] of indexes) {
    assert.match(migration, new RegExp(`CREATE INDEX IF NOT EXISTS ${name}`), `${name} must be repeatable`)
    assert.match(migration, definition, `${name} must use the query's leading column(s)`)
    assert.match(querySource, queryShape, `${name} must serve a named query in code`)
  }
})

test("S06 does not add audit suggestions with no matching queryable column or predicate", () => {
  for (const unsupported of [
    /ON leads\(follow_up_at\)/,
    /ON leads\(id\) WHERE open_invoice/,
    /ON leads USING gin \(name gin_trgm_ops\)/,
    /ON events\(id\) WHERE NOT processed/,
    /ON events\(source_event_id\)/,
    /ON notifications\(quote_lead_id\)/,
    /ON calls\(id\) WHERE outbound_pending/,
    /ON calls\(id\) WHERE transcript IS NULL/,
    /ON messages\(id\) WHERE status = 'sending'/,
  ]) assert.doesNotMatch(migration, unsupported)
})
