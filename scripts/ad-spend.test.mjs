import { strict as assert } from "node:assert"
import test from "node:test"

import { costPerLeadCents, costPerLeadTile, parseAdSpendPayload, parseSpendDollars, spendDaysBehind } from "../lib/ad-spend.mjs"

const NOW = Date.parse("2026-09-18T15:00:00Z")
const SEPTEMBER = {
  monthLabel: "September",
  totalLeads: 24,
  channels: [
    { channel: "google", leads: 14, spendCents: 71438 },
    { channel: "facebook", leads: 1, spendCents: 3166 },
  ],
  spendAsOf: "2026-09-18T10:30:00Z",
  perChannelReady: false,
}

test("the tile divides all ad spend by every lead on the books, in Fable's words", () => {
  assert.deepEqual(costPerLeadTile(SEPTEMBER, NOW), {
    big: "$31",
    beside: "per lead",
    under: "$746 in ads as of Sep 18 ÷ 24 leads on the books in September, any source",
    channelsLine: null,
  })
})

test("no spend yet is a dash, not a zero", () => {
  const none = { ...SEPTEMBER, spendAsOf: null, channels: SEPTEMBER.channels.map((c) => ({ ...c, spendCents: null })) }
  assert.deepEqual(costPerLeadTile(none, NOW), {
    big: "—",
    beside: "per lead",
    under: "No ad spend received for September yet · 24 leads on the books",
    channelsLine: null,
  })
})

test("spend with no leads shows the whole spend, not a divide by zero", () => {
  const tile = costPerLeadTile({ ...SEPTEMBER, totalLeads: 0 }, NOW)
  assert.equal(tile.big, "$746")
  assert.equal(tile.beside, null)
  assert.equal(tile.under, "$746 in ads as of Sep 18 ÷ 0 leads on the books in September")
})

test("one lead is singular", () => {
  assert.equal(costPerLeadTile({ ...SEPTEMBER, totalLeads: 1 }, NOW).under,
    "$746 in ads as of Sep 18 ÷ 1 lead on the books in September, any source")
})

test("a feed more than two days old says how far behind it is", () => {
  const stale = costPerLeadTile({ ...SEPTEMBER, spendAsOf: "2026-09-15T10:30:00Z" }, NOW)
  assert.equal(stale.under, "$746 in ads as of Sep 15 ÷ 24 leads on the books in September, any source · spend feed 3 days behind")
  assert.equal(spendDaysBehind("2026-09-16T16:00:00Z", NOW), 0)
  assert.equal(spendDaysBehind("not a date", NOW), 0)
})

test("per-channel figures appear only once the tracking numbers cover the month", () => {
  const ready = costPerLeadTile({ ...SEPTEMBER, perChannelReady: true, channels: [
    { channel: "google", leads: 14, spendCents: 71438 },
    { channel: "facebook", leads: 0, spendCents: 3166 },
  ] }, NOW)
  assert.equal(ready.channelsLine, "Google $51/lead · Facebook $32, no leads")
})

test("blank spend leaves the saved number alone", () => {
  assert.deepEqual(parseSpendDollars(""), { ok: true, cents: null })
  assert.deepEqual(parseSpendDollars("   "), { ok: true, cents: null })
  assert.deepEqual(parseSpendDollars(null), { ok: true, cents: null })
})

test("zero is a real answer and is kept", () => {
  assert.deepEqual(parseSpendDollars("0"), { ok: true, cents: 0 })
})

test("dollars, commas and a dollar sign all parse", () => {
  assert.deepEqual(parseSpendDollars("450"), { ok: true, cents: 45000 })
  assert.deepEqual(parseSpendDollars("$1,234.50"), { ok: true, cents: 123450 })
})

test("junk and negatives are refused rather than stored as zero", () => {
  assert.equal(parseSpendDollars("abc").ok, false)
  assert.equal(parseSpendDollars("-5").ok, false)
  assert.equal(parseSpendDollars("2000000").ok, false)
})

test("cost per lead divides spend by leads", () => {
  assert.equal(costPerLeadCents(45000, 12), 3750)
  assert.equal(costPerLeadCents(0, 12), 0)
})

test("no recorded spend is not the same answer as no leads", () => {
  assert.equal(costPerLeadCents(null, 12), null)
  // Spend with nothing to show for it is the whole spend, not a divide by zero.
  assert.equal(costPerLeadCents(45000, 0), 45000)
  assert.equal(costPerLeadCents(0, 0), null)
})

test("the ingest payload takes an optional YYYY-MM month", () => {
  assert.deepEqual(parseAdSpendPayload({ google: 450, facebook: "120.50" }), {
    ok: true,
    monthStart: null,
    updates: [{ channel: "google", cents: 45000 }, { channel: "facebook", cents: 12050 }],
  })
  assert.equal(parseAdSpendPayload({ month: "2026-08", google: 1 }).monthStart, "2026-08-01")
  assert.equal(parseAdSpendPayload({ month: "2026-13", google: 1 }).ok, false)
  assert.equal(parseAdSpendPayload({ month: "August", google: 1 }).ok, false)
})

test("the ingest payload refuses junk rather than writing a wrong number", () => {
  assert.equal(parseAdSpendPayload({ google: "abc" }).ok, false)
  assert.equal(parseAdSpendPayload({ google: -5 }).ok, false)
  assert.equal(parseAdSpendPayload(null).ok, false)
  // No channel at all is a broken sender, not a month of zero spend.
  assert.equal(parseAdSpendPayload({ month: "2026-09" }).ok, false)
})

test("one channel alone leaves the other channel's saved figure alone", () => {
  const parsed = parseAdSpendPayload({ google: 200 })
  assert.deepEqual(parsed.updates, [{ channel: "google", cents: 20000 }])
})
