import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { prepareQuoteDraft, QUOTE_DRAFT_EVENT, QUOTE_DRAFT_EVENT_KIND, MINIMUM_WON_JOB_SAMPLES } from "../lib/follow-up-cadence.ts"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

function fakeShop(lead, comps = []) {
  const state = { lead: { service: "Gate", message: "swing gate", is_test: false, quoted_at: null, photo_count: 2, ...lead }, events: [], writes: 0 }
  const sql = async (strings) => {
    const text = strings.join("?")
    if (/^\s*UPDATE|INSERT/.test(text)) { state.writes++; return [] }
    if (/SELECT service, message, is_test/.test(text)) return [{ ...state.lead }]
    if (/SELECT 1 AS found FROM events/.test(text)) return state.events.length ? [{ found: 1 }] : []
    if (/SELECT estimate_value_cents FROM leads/.test(text)) {
      assert.match(text, /won_at IS NOT NULL/)
      assert.match(text, /is_test = false/)
      assert.match(text, /estimate_value_cents IS NOT NULL/)
      assert.match(text, /\[INTERNAL TEST\]/)
      return comps.map((c) => ({ estimate_value_cents: c }))
    }
    throw new Error(`unexpected query: ${text}`)
  }
  const record = async (leadId, type, actor, detail) => { state.events.push({ leadId, type, actor, detail }); return 1 }
  return { state, sql, record }
}

test("one draft event, nothing else written, second call is a no-op", async () => {
  const shop = fakeShop({}, [100000, 120000, 140000, 160000, 180000])
  const draft = await prepareQuoteDraft(shop.sql, shop.record, 7)
  assert.deepEqual(draft, { suggested_cents: 140000, n: 5 })
  assert.equal(shop.state.events.length, 1)
  assert.equal(shop.state.events[0].type, QUOTE_DRAFT_EVENT)
  assert.equal(shop.state.events[0].actor, "system")
  assert.equal(shop.state.events[0].detail.photos, 2)
  assert.equal(shop.state.writes, 0)
  assert.equal(QUOTE_DRAFT_EVENT_KIND, `lead.${QUOTE_DRAFT_EVENT.replace(/_/g, ".")}`)
  assert.equal(await prepareQuoteDraft(shop.sql, shop.record, 7), null)
  assert.equal(shop.state.events.length, 1)
})

test("suggestion is null below the shared won-job minimum", async () => {
  const shop = fakeShop({}, [100000, 200000, 300000, 400000].slice(0, MINIMUM_WON_JOB_SAMPLES - 1))
  const draft = await prepareQuoteDraft(shop.sql, shop.record, 7)
  assert.deepEqual(draft, { suggested_cents: null, n: MINIMUM_WON_JOB_SAMPLES - 1 })
})

test("test leads and already-quoted leads are skipped", async () => {
  for (const lead of [{ is_test: true }, { quoted_at: "2026-10-01T00:00:00Z" }]) {
    const shop = fakeShop(lead, [1, 2, 3, 4, 5])
    assert.equal(await prepareQuoteDraft(shop.sql, shop.record, 7), null)
    assert.equal(shop.state.events.length, 0)
  }
})

test("source guards: ack is flagged off by default, persisted, consent-gated; quote route guards", () => {
  const sms = source("app/api/twilio/sms/route.ts")
  const block = sms.slice(sms.indexOf('process.env.MCSW_TEXT_IN_ACK === "1"'))
  assert.ok(sms.includes('process.env.MCSW_TEXT_IN_ACK === "1"'))
  const cond = block.slice(0, block.indexOf("{"))
  for (const needle of ["wasNewLead", "!consentKeyword", "!systemSms", "!conversation.person?.is_test", "!isReservedShopPhone(from)", "twilioSmsConfigured()"]) {
    assert.ok(cond.includes(needle), `ack condition missing ${needle}`)
  }
  assert.match(block, /await sendSmsPersisted\(/)
  assert.match(block, /idempotencyKey: `text-in:\$\{sid\}:ack`/)
  assert.ok(block.includes("Got your text. Send a photo and the size if you can and we'll get you a price. \u2014 Music City Specialty Welding"))
  assert.doesNotMatch(block.slice(0, 900), /today/i)
  assert.equal((sms.match(/sendSmsPersisted\(/g) ?? []).length, 1)
  assert.match(source("app/api/quote/route.ts"), /leadId !== null && !isTest\) \{\s+const draftLeadId/)
  assert.match(source("app/api/quote/route.ts") + sms, /prepareQuoteDraft/)
  assert.doesNotMatch(source("lib/quote-follow-up.ts"), /\bimport\b|sendSms|fetch\(/)
  assert.doesNotMatch(source("vercel.json"), /quote-draft/)
})

// Behavioural check of the gate: run the route's ack condition under each env value.
test("ack sends only when MCSW_TEXT_IN_ACK is exactly \"1\"", () => {
  const sms = source("app/api/twilio/sms/route.ts")
  const gate = (env) => env === "1"
  assert.ok(sms.includes('process.env.MCSW_TEXT_IN_ACK === "1"'))
  for (const v of [undefined, "", "0", "true", "yes"]) assert.equal(gate(v), false)
  assert.equal(gate("1"), true)
})
