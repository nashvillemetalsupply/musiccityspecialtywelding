import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  builderboxDayCount,
  closeRoofLeadsForPhone,
  FEED_WINDOW_DAYS,
  hashPhone,
  leadBadgeCounts,
  markRoofLeadContacted,
  parseFeedLeads,
  ROOF_LEAD_BUSINESSES,
  syncLeadFeeds,
} from "../lib/roof-leads.ts"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const crew = { id: 71, role: "crew" }
const HASH = `sha256:${"a".repeat(64)}`

function fakeSql(answer = () => []) {
  const calls = []
  const sql = async (strings, ...values) => {
    const call = { text: strings.join("?"), values }
    calls.push(call)
    return answer(call)
  }
  return { sql, calls }
}

test("lead badges: phone hash matches Mirror's rule (digits, drop leading 1, ten digits, sha256)", () => {
  const expected = `sha256:${createHash("sha256").update("6155550142").digest("hex")}`
  assert.equal(hashPhone("(615) 555-0142"), expected)
  assert.equal(hashPhone("+1 615 555 0142"), expected)
  assert.equal(hashPhone("555-0142"), null)
  assert.equal(hashPhone(null), null)
})

test("lead badges: feed rows skip test and unqualified leads; booked or lost arrive already actioned", () => {
  const leads = parseFeedLeads({
    leads: [
      { lead_id: "a1", created_at: "2026-10-24T14:00:00Z", source: "google", is_test: false, phone_hash: HASH, email_hash: HASH },
      { lead_id: "t1", created_at: "2026-10-24T14:00:00Z", is_test: true },
      { lead_id: "q1", created_at: "2026-10-24T14:00:00Z", is_test: false, qualified: false },
      { lead_id: "b1", created_at: "2026-10-23T14:00:00Z", is_test: false, status: "booked", status_at: "2026-10-24T09:00:00Z" },
      { lead_id: "x1", created_at: "not a date" },
      { created_at: "2026-10-24T14:00:00Z" },
    ],
  })
  assert.deepEqual(leads.map((lead) => lead.lead_id), ["a1", "b1"])
  assert.equal(leads[0].phone_hash, HASH)
  assert.equal(leads[0].attribution, "google")
  assert.equal(leads[0].actioned_at, null)
  assert.equal(leads[1].actioned_at, "2026-10-24T09:00:00.000Z")
  assert.throws(() => parseFeedLeads({ error: "nope" }), /no leads array/)
})

test("lead badges: BuilderBox today = quotes + trade applications for the Chicago day", () => {
  const body = { days: [
    { day: "2026-10-24", quotes: { new: 1, total: 2 }, applications: { pending: 1, total: 1 } },
    { day: "2026-10-23", quotes: { total: 9 }, applications: { total: 9 } },
  ] }
  assert.equal(builderboxDayCount(body, "2026-10-24"), 3)
  assert.equal(builderboxDayCount(body, "2026-10-22"), 0)
})

test("lead badges: sync reads only feeds with a secret, a short window, and keeps a contacted lead contacted", async () => {
  const urls = []
  const fetchImpl = async (url, init) => {
    urls.push(url)
    assert.equal(init.headers.Authorization, "Bearer s3cret")
    assert.ok(init.signal, "every feed read has a timeout")
    if (url.includes("boxesforbuilders")) return { ok: true, status: 200, json: async () => ({ days: [{ day: "2026-10-24", quotes: { total: 2 }, applications: { total: 0 } }] }) }
    return { ok: true, status: 200, json: async () => ({ leads: [{ lead_id: "a1", created_at: "2026-10-24T14:00:00Z", is_test: false }] }) }
  }
  const { sql, calls } = fakeSql()
  const now = new Date("2026-10-24T18:00:00Z")
  await syncLeadFeeds({ sql, fetchImpl, env: { LEADS_FEED_SECRET_LD2R: "s3cret", LEADS_FEED_SECRET_BUILDERBOX: "s3cret" }, now, force: true })
  assert.deepEqual(urls.sort(), [
    "https://boxesforbuilders.com/api/admin/leads?days=1",
    `https://www.ld2rcleaningservice.com/api/admin/leads?days=${FEED_WINDOW_DAYS}`,
  ])
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /ON CONFLICT \(business, lead_id\) DO UPDATE/)
  assert.match(calls[0].text, /COALESCE\(roof_leads\.contacted_at, EXCLUDED\.contacted_at\)/)
  assert.equal(calls[0].values[0], "ld2r")

  // Throttled: a second render inside 5 minutes reads nothing.
  urls.length = 0
  await syncLeadFeeds({ sql, fetchImpl, env: { LEADS_FEED_SECRET_LD2R: "s3cret" }, now: new Date(now.getTime() + 60_000) })
  assert.deepEqual(urls, [])

  const badges = await leadBadgeCounts({ sql: fakeSql().sql, now })
  assert.deepEqual(badges.builderbox, { count: 2, title: "2 quote or trade requests today", today: true })
})

test("lead badges: a failing feed or a missing table never throws", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) })
  await syncLeadFeeds({ sql: fakeSql().sql, fetchImpl, env: { LEADS_FEED_SECRET_RAILING: "s" }, force: true })
  const broken = async () => { throw new Error('relation "roof_leads" does not exist') }
  const badges = await leadBadgeCounts({ sql: broken, now: new Date("2020-01-01T00:00:00Z") })
  assert.deepEqual(badges, {})
})

test("lead badges: counts per tab with channel titles; welding uses the board's new-lead predicate", async () => {
  const { sql, calls } = fakeSql((call) => call.text.includes("FROM leads")
    ? [{ source: "phone-in", count: 2 }, { source: "website", count: 1 }]
    : [{ business: "ld2r", source: "form", count: 1 }, { business: "grease-patrol", source: "form", count: 3 }])
  const badges = await leadBadgeCounts({ sql, now: new Date("2020-01-01T00:00:00Z") })
  assert.match(calls[0].text, /status = 'new' AND is_test = false AND routed_to_lead_id IS NULL/)
  assert.deepEqual(badges[""], { count: 3, title: "2 calls, 1 form" })
  assert.deepEqual(badges.ld2r, { count: 1, title: "1 form" })
  assert.deepEqual(badges["grease-patrol"], { count: 3, title: "3 forms" })
  assert.equal(badges.railing, undefined)
})

test("lead badges: Contacted and a booked job with the lead's phone both clear it", async () => {
  assert.deepEqual(ROOF_LEAD_BUSINESSES, ["ld2r", "grease-patrol", "railing"])
  const { sql, calls } = fakeSql()
  await markRoofLeadContacted({ operator: crew, business: "grease-patrol", id: 5, sql })
  assert.match(calls[0].text, /SET contacted_at = now\(\), contacted_by = /)
  assert.deepEqual(calls[0].values, [71, 5, "grease-patrol"])
  await assert.rejects(markRoofLeadContacted({ operator: crew, business: "builderbox", id: 5, sql }), /Unknown business/)
  await assert.rejects(markRoofLeadContacted({ operator: crew, business: "ld2r", id: 0, sql }), /Refresh/)

  await closeRoofLeadsForPhone({ business: "ld2r", phone: "615-555-0142", operator: crew, sql })
  assert.match(calls[1].text, /phone_hash = /)
  assert.equal(calls[1].values[2], hashPhone("6155550142"))
  await closeRoofLeadsForPhone({ business: "ld2r", phone: "", operator: crew, sql })
  await closeRoofLeadsForPhone({ business: "builderbox", phone: "6155550142", operator: crew, sql })
  assert.equal(calls.length, 2)

  const actions = read("app/board/business-actions.ts")
  assert.match(actions, /closeRoofLeadsForPhone\(\{ business, phone: job\.phone, operator \}\)/)
})

test("lead badges: migration registered after roof_jobs, hashes only", () => {
  const migrate = read("scripts/migrate.mjs")
  assert.match(migrate, /\{ name: "roof-jobs-o1-2026-10-23", query: roofJobsStatement \},\r?\n    \{ name: "roof-leads-badges-2026-10-24", query: roofLeadsStatement \}/)
  const statement = migrate.slice(migrate.indexOf("export const roofLeadsStatement"), migrate.indexOf("roof_leads_open_idx"))
  assert.match(statement, /UNIQUE \(business, lead_id\)/)
  assert.doesNotMatch(statement, /customer_name|email TEXT|phone TEXT/)
})
