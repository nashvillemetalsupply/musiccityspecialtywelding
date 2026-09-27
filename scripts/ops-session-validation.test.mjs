import assert from "node:assert/strict"
import test from "node:test"

let validateSessionTokenWithSql
try {
  ({ validateSessionTokenWithSql } = await import("../lib/ops-session-validation.mjs"))
} catch {
  validateSessionTokenWithSql = null
}

function fakeSql(responses, throwAt = 0) {
  const calls = []
  const sql = async (strings, ...values) => {
    const query = [...strings].join("$value")
    calls.push({ query, values })
    if (calls.length === throwAt) throw new Error("database unavailable")
    return responses.shift() ?? []
  }
  return { sql, calls }
}

test("recent session validation performs only a read", async () => {
  assert.equal(typeof validateSessionTokenWithSql, "function", "session validation needs a testable query boundary")
  const operator = { id: 7, email: "owner@example.com", active: true }
  const { sql, calls } = fakeSql([[{ ...operator, refresh_due: false }]])

  const session = await validateSessionTokenWithSql(sql, "a".repeat(64))

  assert.equal(session.id, 7)
  assert.equal(calls.length, 1)
  assert.match(calls[0].query, /^\s*SELECT\b/i)
  assert.doesNotMatch(calls[0].query, /\bUPDATE\b/i)
  assert.deepEqual(calls[0].values, ["a".repeat(64)])
  assert.match(calls[0].query, /expires_at > now\(\)/)
  assert.match(calls[0].query, /last_used_at > now\(\) - interval '14 days'/)
  assert.equal("refresh_due" in session, false)
})

test("session idle over one hour is refreshed and returned", async () => {
  assert.equal(typeof validateSessionTokenWithSql, "function", "session validation needs a testable query boundary")
  const operator = { id: 8, email: "owner@example.com", active: true }
  const { sql, calls } = fakeSql([
    [{ ...operator, refresh_due: true }],
    [operator],
  ])

  const session = await validateSessionTokenWithSql(sql, "b".repeat(64))

  assert.equal(session.id, 8)
  assert.equal(calls.length, 2)
  assert.match(calls[0].query, /^\s*SELECT\b/i)
  assert.match(calls[0].query, /last_used_at < now\(\) - interval '1 hour'/)
  assert.match(calls[1].query, /^\s*UPDATE\b/i)
  assert.match(calls[1].query, /last_used_at = now\(\)/)
  assert.match(calls[1].query, /expires_at = now\(\) \+ interval '14 days'/)
  assert.match(calls[1].query, /last_used_at > now\(\) - interval '14 days'/)
  assert.match(calls[1].query, /last_used_at < now\(\) - interval '1 hour'/)
})

test("session idle over fourteen days is refused without a write", async () => {
  assert.equal(typeof validateSessionTokenWithSql, "function", "session validation needs a testable query boundary")
  const { sql, calls } = fakeSql([[]])

  assert.equal(await validateSessionTokenWithSql(sql, "c".repeat(64)), null)
  assert.equal(calls.length, 1)
  assert.match(calls[0].query, /^\s*SELECT\b/i)
  assert.match(calls[0].query, /last_used_at > now\(\) - interval '14 days'/)
})

test("any session database error fails closed", async () => {
  assert.equal(typeof validateSessionTokenWithSql, "function", "session validation needs a testable query boundary")
  const freshFailure = fakeSql([], 1)
  assert.equal(await validateSessionTokenWithSql(freshFailure.sql, "d".repeat(64)), null)

  const refreshFailure = fakeSql([[{ id: 9, refresh_due: true }]], 2)
  assert.equal(await validateSessionTokenWithSql(refreshFailure.sql, "e".repeat(64)), null)
})
