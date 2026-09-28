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

test("legacy migration steps preserve main's prefix and append the recorded S09/S10 steps", () => {
  const mainMigration = execFileSync("git", ["show", "main:scripts/migrate.mjs"], { encoding: "utf8" })
  const originalSteps = statementBodies(mainMigration)
  const currentSteps = statementBodies(migration)
  const appendedSteps = [
    "ALTER TABLE ops_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    "ALTER TABLE claims ADD COLUMN IF NOT EXISTS superseded_by BIGINT REFERENCES claims(id)",
    "UPDATE glass_links SET expires_at = created_at + interval '180 days' WHERE expires_at IS NULL",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS send_after TIMESTAMPTZ",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS quiet_hours_exempt BOOLEAN NOT NULL DEFAULT false",
    "CREATE INDEX IF NOT EXISTS messages_deferred_sms_due_idx ON messages(send_after, id) WHERE direction = 'out' AND status = 'queued' AND send_after IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS leads_next_follow_up_idx\n    ON leads(next_follow_up_at) WHERE next_follow_up_at IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS leads_won_at_idx ON leads(won_at)",
    "CREATE INDEX IF NOT EXISTS rate_limits_ts_idx ON rate_limits(ts)",
    "CREATE INDEX IF NOT EXISTS leads_scheduled_at_idx ON leads(scheduled_at)",
    "CREATE INDEX IF NOT EXISTS events_occurred_at_idx ON events(occurred_at)",
    "CREATE INDEX IF NOT EXISTS commitments_person_open_idx\n    ON commitments(person_id, due_at) WHERE status = 'open'",
    "CREATE INDEX IF NOT EXISTS calls_to_phone_idx ON calls(to_phone)",
  ]

  assert.ok(originalSteps.length > 0, "main contains the recorded legacy statements")
  const mismatchAt = originalSteps.findIndex((step, index) => currentSteps[index] !== step)
  assert.equal(
    mismatchAt,
    -1,
    `pre-existing positional step ${mismatchAt + 1} differs from main (${JSON.stringify(originalSteps[mismatchAt]?.slice(0, 120))} vs ${JSON.stringify(currentSteps[mismatchAt]?.slice(0, 120))})`,
  )
  assert.deepEqual(currentSteps.slice(-appendedSteps.length), appendedSteps, "all new schema changes are idempotent final array steps")
})
