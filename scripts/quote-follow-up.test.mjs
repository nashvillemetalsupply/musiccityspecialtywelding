import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  planQuoteFollowUp,
  QUOTE_FOLLOW_UP_EVENT,
  QUOTE_FOLLOW_UP_EVENT_KIND,
  QUOTE_FOLLOW_UP_STEP_DAYS,
  scheduleQuoteFollowUp,
} from "../lib/quote-follow-up.ts"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const dayMs = 24 * 60 * 60 * 1000
const quotedAt = new Date("2026-10-01T15:00:00.000Z")
const plusDays = (days) => new Date(quotedAt.getTime() + days * dayMs).toISOString()

// A one-lead in-memory stand-in for the three statements scheduleQuoteFollowUp
// runs. The UPDATE re-applies the same guards the real WHERE clause carries.
function fakeShop(lead) {
  const state = { lead: { completed_at: null, next_follow_up_at: null, quoted_at: quotedAt.toISOString(), ...lead }, events: [], calls: [] }
  const sql = async (strings, ...values) => {
    const text = strings.join("?")
    state.calls.push({ text, values })
    if (/^\s*SELECT status, quoted_at/.test(text)) return [{ ...state.lead }]
    if (/SELECT count\(\*\)::int AS steps FROM events/.test(text)) {
      return [{ steps: state.events.filter((event) => event.kind === values[1]).length }]
    }
    if (/^\s*UPDATE leads SET next_follow_up_at/.test(text)) {
      const l = state.lead
      if (l.status !== "quoted" || l.next_follow_up_at || l.completed_at) return []
      l.next_follow_up_at = values[0]
      return [{ id: values[1] }]
    }
    throw new Error(`unexpected query: ${text}`)
  }
  const record = async (leadId, type, actor, detail) => {
    state.events.push({ leadId, type, actor, detail, kind: `lead.${type.replace(/_/g, ".")}` })
    return state.events.length
  }
  // What setFollowUp does with clear=1, minus auth and revalidation.
  const clear = async (now) => {
    state.lead.next_follow_up_at = null
    state.events.push({ type: "follow_up_cleared", kind: "lead.follow.up.cleared" })
    return scheduleQuoteFollowUp(sql, record, 7, now)
  }
  return { state, sql, record, clear }
}

test("the cadence is +2, +5 and +10 days after the quote, recorded as follow_up_auto_set", () => {
  assert.deepEqual([...QUOTE_FOLLOW_UP_STEP_DAYS], [2, 5, 10])
  assert.equal(QUOTE_FOLLOW_UP_EVENT, "follow_up_auto_set")
  // recordLeadEvent's fallback kind for an unmapped legacy type.
  assert.equal(QUOTE_FOLLOW_UP_EVENT_KIND, `lead.${QUOTE_FOLLOW_UP_EVENT.replace(/_/g, ".")}`)
  assert.doesNotMatch(source("lib/leads.ts"), /follow_up_auto_set:/, "the kind must stay the counted fallback kind")
})

test("a quote with no reminder sets one at quoted time + 2 days", async () => {
  const shop = fakeShop({ status: "quoted" })
  const plan = await scheduleQuoteFollowUp(shop.sql, shop.record, 7, quotedAt)

  assert.deepEqual(plan, { step: 1, days: 2, at: plusDays(2) })
  assert.equal(shop.state.lead.next_follow_up_at, plusDays(2))
  assert.equal(shop.state.events.length, 1)
  assert.equal(shop.state.events[0].type, "follow_up_auto_set")
  assert.equal(shop.state.events[0].actor, "system")
  assert.deepEqual(shop.state.events[0].detail, { at: plusDays(2), step: 1, days: 2, cadence: "quote" })
})

test("a manual follow-up date is never overwritten", async () => {
  const manual = "2026-10-20T14:00:00.000Z"
  const shop = fakeShop({ status: "quoted", next_follow_up_at: manual })
  assert.equal(await scheduleQuoteFollowUp(shop.sql, shop.record, 7, quotedAt), null)
  assert.equal(shop.state.lead.next_follow_up_at, manual)
  assert.equal(shop.state.events.length, 0)
  assert.equal(shop.state.calls.some((call) => /UPDATE/.test(call.text)), false)
})

test("a manual date set between the read and the write still wins", async () => {
  const manual = "2026-10-20T14:00:00.000Z"
  const shop = fakeShop({ status: "quoted" })
  const raceSql = async (strings, ...values) => {
    if (/^\s*UPDATE leads SET next_follow_up_at/.test(strings.join("?"))) shop.state.lead.next_follow_up_at = manual
    return shop.sql(strings, ...values)
  }
  assert.equal(await scheduleQuoteFollowUp(raceSql, shop.record, 7, quotedAt), null)
  assert.equal(shop.state.lead.next_follow_up_at, manual)
  assert.equal(shop.state.events.length, 0)
})

test("clearing on a still-quoted lead schedules +5d, then +10d, and there is no step 4", async () => {
  const shop = fakeShop({ status: "quoted" })
  await scheduleQuoteFollowUp(shop.sql, shop.record, 7, quotedAt)
  assert.equal(shop.state.lead.next_follow_up_at, plusDays(2))

  const second = await shop.clear(new Date(plusDays(2)))
  assert.deepEqual(second, { step: 2, days: 5, at: plusDays(5) })
  assert.equal(shop.state.lead.next_follow_up_at, plusDays(5))

  const third = await shop.clear(new Date(plusDays(5)))
  assert.deepEqual(third, { step: 3, days: 10, at: plusDays(10) })
  assert.equal(shop.state.lead.next_follow_up_at, plusDays(10))

  const fourth = await shop.clear(new Date(plusDays(10)))
  assert.equal(fourth, null)
  assert.equal(shop.state.lead.next_follow_up_at, null)
  assert.equal(shop.state.events.filter((event) => event.type === "follow_up_auto_set").length, 3)
})

test("won, lost and spam stop the cadence and leave next_follow_up_at alone", async () => {
  for (const status of ["won", "lost", "spam"]) {
    const empty = fakeShop({ status })
    assert.equal(await scheduleQuoteFollowUp(empty.sql, empty.record, 7, quotedAt), null, status)
    assert.equal(empty.state.lead.next_follow_up_at, null, status)
    assert.equal(empty.state.events.length, 0, status)

    const kept = "2026-10-04T15:00:00.000Z"
    const set = fakeShop({ status, next_follow_up_at: kept })
    assert.equal(await scheduleQuoteFollowUp(set.sql, set.record, 7, quotedAt), null, status)
    assert.equal(set.state.lead.next_follow_up_at, kept, status)
  }

  // Mid-cadence: the lead is won, then the operator clears the reminder.
  const shop = fakeShop({ status: "quoted" })
  await scheduleQuoteFollowUp(shop.sql, shop.record, 7, quotedAt)
  shop.state.lead.status = "won"
  assert.equal(await shop.clear(new Date(plusDays(3))), null)
  assert.equal(shop.state.lead.next_follow_up_at, null)
  assert.equal(shop.state.events.filter((event) => event.type === "follow_up_auto_set").length, 1)
})

test("finished work and other open statuses get no cadence step", () => {
  const base = { quoted_at: quotedAt.toISOString(), next_follow_up_at: null, completed_at: null }
  for (const status of ["new", "contacted", "qualified"]) {
    assert.equal(planQuoteFollowUp({ ...base, status }, 0, quotedAt), null, status)
  }
  assert.equal(planQuoteFollowUp({ ...base, status: "quoted", completed_at: plusDays(1) }, 0, quotedAt), null)
  assert.equal(planQuoteFollowUp({ ...base, status: "quoted" }, 3, quotedAt), null)
})

test("a step whose time already passed lands a day out instead of being due at once", () => {
  const lateClear = new Date(plusDays(8))
  const plan = planQuoteFollowUp(
    { status: "quoted", quoted_at: quotedAt.toISOString(), next_follow_up_at: null, completed_at: null },
    1,
    lateClear,
  )
  assert.deepEqual(plan, { step: 2, days: 5, at: new Date(lateClear.getTime() + dayMs).toISOString() })
})

test("the write re-checks every guard and every interpolation is cast", async () => {
  const shop = fakeShop({ status: "quoted" })
  await scheduleQuoteFollowUp(shop.sql, shop.record, 7, quotedAt)
  const update = shop.state.calls.find((call) => /UPDATE leads/.test(call.text)).text
  assert.match(update, /next_follow_up_at = \?::timestamptz/)
  assert.match(update, /WHERE id = \?::bigint\s+AND status = 'quoted'\s+AND next_follow_up_at IS NULL\s+AND completed_at IS NULL/)
  const count = shop.state.calls.find((call) => /count\(\*\)/.test(call.text)).text
  assert.match(count, /lead_id = \?::bigint AND kind = \?::text/)

  const module = source("lib/quote-follow-up.ts")
  const interpolations = module.match(/\$\{[^}]+\}(::\w+)?/g) ?? []
  for (const value of interpolations) assert.match(value, /::\w+$/, `uncast interpolation ${value}`)
})

test("every path that makes a lead quoted, and the clear path, schedules the cadence", () => {
  const actions = source("app/ops/actions.ts")
  const claims = source("app/ops/leads/[id]/claim-actions.ts")
  const body = (text, name) => {
    const start = text.indexOf(`export async function ${name}(`)
    assert.ok(start >= 0, name)
    const end = text.indexOf("\nexport ", start + 1)
    return text.slice(start, end < 0 ? undefined : end)
  }

  assert.match(body(actions, "updateLeadStatus"), /if \(status === "quoted"\) await scheduleQuoteFollowUpForLead\(leadId\)/)
  assert.match(body(actions, "saveEstimate"), /if \(cents !== null\) await scheduleQuoteFollowUpForLead\(leadId\)/)
  assert.match(body(actions, "setFollowUp"), /if \(clear\) await scheduleQuoteFollowUpForLead\(leadId\)/)
  assert.match(body(claims, "acceptQuoteCapture"), /scheduleQuoteFollowUp\(sql, recordLeadEvent, leadId\)/)
})

test("the cadence never contacts the customer and adds no cron", () => {
  const module = source("lib/quote-follow-up.ts")
  assert.doesNotMatch(module, /\bimport\b/)
  assert.doesNotMatch(module, /sendCustomerEmail|sendSms|twilio|resend|gmail|notifyAll|fetch\(/i)
  assert.doesNotMatch(source("vercel.json"), /quote-follow-up|follow-up-cadence/)
})
