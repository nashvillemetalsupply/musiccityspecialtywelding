import assert from "node:assert/strict"
import test from "node:test"
import { ackDeadNotifications, parseAckArgs } from "./ack-dead-notifications.mjs"

function fakeSql(counts) {
  const calls = []
  const sql = async (strings, ...values) => {
    const text = strings.join("$")
    calls.push({ text, values })
    if (/^\s*WITH acked AS/.test(text)) return [{ count: counts.updated }]
    return [{ count: counts.matched }]
  }
  return { sql, calls }
}

test("arguments default to a dry run over dead alerts older than 14 days", () => {
  assert.deepEqual(parseAckArgs([]), { apply: false, olderThanDays: 14 })
  assert.deepEqual(parseAckArgs(["--apply", "--older-than-days", "30"]), { apply: true, olderThanDays: 30 })
  assert.deepEqual(parseAckArgs(["--older-than-days=7"]), { apply: false, olderThanDays: 7 })
  assert.throws(() => parseAckArgs(["--older-than-days", "0"]), /positive whole number/)
  assert.throws(() => parseAckArgs(["--older-than-days", "abc"]), /positive whole number/)
  assert.throws(() => parseAckArgs(["--yes"]), /Unknown argument/)
})

test("a dry run counts and never writes", async () => {
  const { sql, calls } = fakeSql({ matched: 227, updated: 0 })
  const result = await ackDeadNotifications({ sql, apply: false, olderThanDays: 14 })
  assert.deepEqual(result, { apply: false, olderThanDays: 14, matched: 227, updated: 0 })
  assert.equal(calls.length, 1)
  assert.doesNotMatch(calls[0].text, /UPDATE/)
})

test("--apply sets read_at only on dead, unread, non-test rows older than the cutoff", async () => {
  const { sql, calls } = fakeSql({ matched: 227, updated: 227 })
  const result = await ackDeadNotifications({ sql, apply: true, olderThanDays: 30 })
  assert.deepEqual(result, { apply: true, olderThanDays: 30, matched: 227, updated: 227 })
  assert.equal(calls.length, 2)
  const update = calls[1].text
  assert.match(update, /UPDATE notifications SET read_at = now\(\)/)
  assert.match(update, /n\.delivery_status = 'dead' AND n\.read_at IS NULL/)
  assert.match(update, /n\.created_at < now\(\) - \$::int \* interval '1 day'/)
  assert.match(update, /n\.is_test = false/)
  assert.match(update, /COALESCE\(l\.is_test, false\) = false/)
  assert.match(update, /COALESCE\(p\.is_test, false\) = false/)
  assert.match(update, /lower\(COALESCE\(e\.detail->>'isTest', 'false'\)\) <> 'true'/)
  assert.match(update, /lower\(COALESCE\(n\.action_detail->>'isTest', 'false'\)\) <> 'true'/)
  assert.match(update, /NOT ILIKE '%\[INTERNAL TEST\]%'/)
  assert.doesNotMatch(update, /delivery_status = '(?!dead)/, "never changes delivery status")
  assert.deepEqual(calls[1].values, [30])
})

test("the script prints counts only", async () => {
  const { formatAckResult } = await import("./ack-dead-notifications.mjs")
  assert.equal(formatAckResult({ apply: false, olderThanDays: 14, matched: 227, updated: 0 }),
    "Dry run: 227 dead unread non-test alert(s) older than 14 day(s). Re-run with --apply to mark them read.")
  assert.equal(formatAckResult({ apply: true, olderThanDays: 14, matched: 227, updated: 225 }),
    "Marked 225 of 227 dead unread non-test alert(s) older than 14 day(s) as read.")
})
