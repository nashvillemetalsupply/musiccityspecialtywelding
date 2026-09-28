import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import {
  defaultFollowUpAtFromDurations,
  FOLLOW_UP_DAY_BOUNDS,
  getDefaultFollowUpAt,
  median,
} from "../lib/follow-up-cadence.ts"

const repo = path.join(import.meta.dirname, "..")
const fixedNow = new Date("2026-09-27T12:00:00.000Z")
const dayMs = 24 * 60 * 60 * 1000

function sqlStub(rows) {
  const calls = []
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join(""), values })
    return rows
  }
  return { sql, calls }
}

test("median handles odd and even sample counts", () => {
  assert.equal(median([9, 1, 5]), 5)
  assert.equal(median([7, 1, 5, 3]), 4)
  assert.equal(median([]), null)
})

test("five won jobs set a new lead reminder from the median days-to-close", () => {
  const result = defaultFollowUpAtFromDurations([9, 1, 5, 3, 7], fixedNow)
  assert.equal(result, new Date(fixedNow.getTime() + 5 * dayMs).toISOString())
})

test("fewer than five qualifying wins and no wins preserve the current NULL default", () => {
  assert.equal(defaultFollowUpAtFromDurations([1, 2, 3, 4], fixedNow), null)
  assert.equal(defaultFollowUpAtFromDurations([], fixedNow), null)
})

test("cadence clamps to the named one-to-thirty-day bounds", () => {
  assert.deepEqual(FOLLOW_UP_DAY_BOUNDS, { min: 1, max: 30 })
  assert.equal(
    defaultFollowUpAtFromDurations([-8, -4, -2, 0, 0], fixedNow),
    new Date(fixedNow.getTime() + FOLLOW_UP_DAY_BOUNDS.min * dayMs).toISOString(),
  )
  assert.equal(
    defaultFollowUpAtFromDurations([31, 32, 33, 34, 35], fixedNow),
    new Date(fixedNow.getTime() + FOLLOW_UP_DAY_BOUNDS.max * dayMs).toISOString(),
  )
})

test("cadence SQL includes only non-test won leads and excludes the internal-test marker", async () => {
  const { sql, calls } = sqlStub([
    { days_to_close: 1 },
    { days_to_close: 2 },
    { days_to_close: 3 },
    { days_to_close: 4 },
    { days_to_close: 5 },
  ])
  await getDefaultFollowUpAt(sql, fixedNow)

  const query = calls[0].text
  assert.match(query, /FROM leads/)
  assert.match(query, /status = 'won'/)
  assert.match(query, /won_at IS NOT NULL/)
  assert.match(query, /is_test = false/)
  assert.match(query, /concat_ws\([\s\S]*\) NOT ILIKE '%\[INTERNAL TEST\]%'/)
})

test("cadence SQL does not aggregate or refer to worker, operator, crew, or claim fields", async () => {
  const { sql, calls } = sqlStub([])
  await getDefaultFollowUpAt(sql, fixedNow)

  const query = calls[0].text
  assert.doesNotMatch(query, /\b(?:GROUP\s+BY|JOIN)\b/i)
  assert.doesNotMatch(
    query,
    /\b(?:operators?|workers?|crew|claims?|claimants?)\b|\b(?:assigned_operator_id|operator_id|worker_id|crew_id|claimed_by)\b/i,
  )
})

test("a failed history lookup keeps the existing NULL default", async () => {
  const sql = async () => { throw new Error("history unavailable") }
  assert.equal(await getDefaultFollowUpAt(sql, fixedNow), null)
})

test("new lead inserts store the computed default in the existing next_follow_up_at column", async () => {
  const source = await readFile(path.join(repo, "lib", "leads.ts"), "utf8")
  assert.match(source, /getDefaultFollowUpAt\(sql\)/)

  const insertStart = source.indexOf("INSERT INTO leads (")
  const insertEnd = source.indexOf("RETURNING id, public_id", insertStart)
  assert.ok(insertStart >= 0 && insertEnd > insertStart, "createLead must keep its lead insert inspectable")
  const insert = source.slice(insertStart, insertEnd)
  assert.match(insert, /next_follow_up_at/)
  assert.match(insert, /\$\{defaultFollowUpAt\}::timestamptz/)
})

test("the existing job-page follow-up control lets the owner change the reminder", async () => {
  const page = await readFile(path.join(repo, "app", "ops", "leads", "[id]", "page.tsx"), "utf8")
  const actions = await readFile(path.join(repo, "app", "ops", "actions.ts"), "utf8")

  assert.match(page, /import[\s\S]*?setFollowUp/)
  assert.match(page, /<form action=\{setFollowUp\}/)
  assert.match(page, /name="leadId" value=\{lead\.id\}/)
  assert.match(actions, /export async function setFollowUp\(/)
  assert.match(actions, /UPDATE leads SET next_follow_up_at = \$\{followUp\}::timestamptz/)
})
