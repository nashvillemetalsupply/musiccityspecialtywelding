import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  ACCOUNT_READ_REPAIR_GUARD_MS,
  scheduleAccountReadRepair,
} from "../lib/account-read-maintenance.mjs"

const ACCOUNTS = readFileSync(new URL("../lib/accounts.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("account read repairs run after the response and are guarded for fifteen minutes per group", async () => {
  let now = 10_000
  const callbacks = []
  const queries = []
  const fakeSql = async (strings, ...values) => {
    queries.push({ text: strings.join("$"), values })
    return []
  }
  const after = (callback) => callbacks.push(callback)
  const write = () => fakeSql`UPDATE people SET account_key = ${"domain:example.com"}::text`

  assert.equal(scheduleAccountReadRepair({ key: "company:example.com", after, write, now: () => now }), true)
  assert.equal(scheduleAccountReadRepair({ key: "company:example.com", after, write, now: () => now }), false)
  assert.equal(callbacks.length, 1)
  assert.equal(queries.length, 0, "GET has not executed the repair before after() runs")

  await callbacks[0]()
  assert.equal(queries.length, 1)
  assert.match(queries[0].text, /UPDATE people SET account_key/)

  now += ACCOUNT_READ_REPAIR_GUARD_MS - 1
  assert.equal(scheduleAccountReadRepair({ key: "company:example.com", after, write, now: () => now }), false)
  now++
  assert.equal(scheduleAccountReadRepair({ key: "company:example.com", after, write, now: () => now }), true)
  assert.equal(callbacks.length, 2)
})

test("failed account repairs release the guard so a later request can retry", async () => {
  const callbacks = []
  const errors = []
  let attempts = 0
  const options = {
    key: "person:42",
    after: (callback) => callbacks.push(callback),
    now: () => 100,
    onError: (error) => errors.push(error),
    write: async () => {
      attempts++
      if (attempts === 1) throw new Error("fake SQL failure")
    },
  }

  assert.equal(scheduleAccountReadRepair(options), true)
  await callbacks.shift()()
  assert.equal(errors.length, 1)
  assert.equal(scheduleAccountReadRepair(options), true)
})

test("getAccount defers its real account-key repairs and still reads members during the deferred write", () => {
  assert.match(ACCOUNTS, /import \{ after \} from "next\/server"/)
  assert.equal((ACCOUNTS.match(/scheduleAccountReadRepair\(/g) ?? []).length, 2)
  assert.doesNotMatch(ACCOUNTS, /await sql`UPDATE people SET account_key/)
  assert.match(ACCOUNTS, /account_key = \$\{key\}::text OR id = \$\{personId\}::bigint/)
  assert.match(ACCOUNTS, /company_key = \$\{target\.company_key\}::text/)
})
