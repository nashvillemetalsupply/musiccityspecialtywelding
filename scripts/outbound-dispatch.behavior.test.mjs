import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { sendIfClaimed } from "../lib/deferred-sms.ts"
import { SmsNotSentError, isSmsNotSentError } from "../lib/sms-provider-truth.ts"

function load(relativePath, fakes) {
  const path = new URL(`../${relativePath}`, import.meta.url)
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const context = vm.createContext({
    console: { error() {} }, Date, Error, Request, Response, URL,
    process: { env: { TWILIO_PHONE_NUMBER: "+16155550100" } },
  })
  const loaded = { exports: {} }
  const require = (name) => {
    if (fakes.has(name)) return fakes.get(name)
    throw new Error(`Unexpected import: ${name}`)
  }
  vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, require, loaded)
  return loaded.exports
}

function smsHarness({ status = "persisted", isTest = false, consent = [true, true], journalFailures = 0, providerFailure = false, glass = false, glassAttempts = 1 } = {}) {
  const state = {
    id: 41, twilio_sid: "pending:sms-fixture", status, send_after: status === "queued" ? "2026-10-29T13:00:00Z" : null,
    to_phone: "+16155550111", body: "Your job is ready", lead_id: 7, person_id: 3,
    operator_id: 2, idempotency_key: glass ? `glass:${"a".repeat(64)}:send:1` : "fixture-sms-intent", quiet_hours_exempt: false, is_test: isTest,
  }
  const effects = { provider: 0, journal: [], notifications: 0, consentChecks: 0, glassStatus: glass ? "sending" : null, glassClaimed: glass, cleanupOrder: [] }
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (query.startsWith("INSERT INTO messages")) return [] // Replay the durable synthetic intent.
    if (query.startsWith("SELECT id, twilio_sid")) return [{ ...state }]
    if (query.startsWith("SELECT id FROM messages")) return state.status === "queued" ? [{ id: state.id }] : []
    if (query.startsWith("UPDATE messages SET status = 'sending'")) {
      const expected = query.includes("status = 'queued'") ? "queued" : "persisted"
      if (state.status !== expected) return []
      state.status = "sending"
      state.send_after = null
      return [{ ...state }]
    }
    if (query.startsWith("UPDATE messages SET status = 'canceled'")) { state.status = "canceled"; return [] }
    if (query.startsWith("UPDATE messages SET status = ?")) {
      if (state.status !== "sending") return []
      effects.cleanupOrder.push("message reset")
      state.status = values[0]
      if (query.includes("send_after =")) state.send_after = values[1]
      return [{ id: state.id }]
    }
    if (query.startsWith("UPDATE messages SET twilio_sid")) {
      state.twilio_sid = values[0]; state.status = values[1]; return []
    }
    if (query.startsWith("SELECT twilio_sid, status FROM messages")) return [{ ...state }]
    if (query.startsWith("UPDATE glass_links SET send_claimed_at = NULL")) {
      effects.cleanupOrder.push("glass cleanup")
      if (query.includes("AND send_attempts =") && Number(values[2]) !== glassAttempts) return []
      effects.glassStatus = values[0]; effects.glassClaimed = false; return []
    }
    throw new Error(`Unexpected SMS SQL: ${query}`)
  }
  const fakes = new Map([
    ["node:crypto", { randomUUID: () => "synthetic-sms-uuid" }],
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/events", { recordEvent: async (event) => {
      if (event.kind === "sms.out" && journalFailures-- > 0) throw new Error("journal unavailable")
      effects.journal.push(event.kind); return effects.journal.length
    } }],
    ["@/lib/notify", { notify: async () => { effects.notifications++ }, notifyAll: async () => { effects.notifications++ } }],
    ["@/lib/twilio", {
      twilioSmsConfigured: () => true, isDefinitiveTwilioError: () => false,
      twilioCallbackUrl: (path) => path,
      sendSms: async () => { effects.provider++; if (providerFailure) throw new Error("provider response lost"); return { sid: "SMaccepted", status: "accepted" } },
    }],
    ["@/lib/messaging-consent", { customerSmsAllowed: async () => {
      const result = consent[Math.min(effects.consentChecks++, consent.length - 1)]
      if (result instanceof Error) throw result
      return result
    } }],
    ["@/lib/shop-phone-shared", { FALLBACK_SHOP_PHONE_E164: "+16155550100" }],
    ["@/lib/shop-brain-invariants.ts", { normalizeUsPhone: (phone) => phone, isReservedCustomerPhone: () => false }],
    ["@/lib/sms-quiet-hours.ts", { isCentralQuietHours: () => false, getDeferredSmsSendAt: () => null }],
    ["@/lib/deferred-sms.ts", { sendIfClaimed }],
    ["@/lib/sms-provider-truth.ts", { SmsNotSentError }],
  ])
  const api = load("lib/messages.ts", fakes)
  return { api, state, effects, send: () => api.sendSmsPersisted({ to: state.to_phone, body: state.body, leadId: 7, personId: 3, operatorId: 2, idempotencyKey: state.idempotency_key }) }
}

test("overnight STOP cancels a previously queued text without contacting the provider", async () => {
  const harness = smsHarness({ status: "queued", consent: [false] })
  await harness.api.sendDeferredSms()
  assert.equal(harness.state.status, "canceled")
  assert.equal(harness.effects.provider, 0)
  assert.equal(harness.effects.notifications, 0)
})

test("STOP clears a queued Customer Page claim without falsely marking delivery unknown", async () => {
  const harness = smsHarness({ status: "queued", consent: [false], glass: true })
  await harness.api.sendDeferredSms()
  assert.equal(harness.state.status, "canceled")
  assert.equal(harness.effects.glassStatus, "failed")
  assert.equal(harness.effects.glassClaimed, false)
  assert.equal(harness.effects.provider, 0)
})

test("a stale deferred attempt cannot release a newer Customer Page send claim", async () => {
  const harness = smsHarness({ status: "queued", consent: [false], glass: true, glassAttempts: 2 })
  await harness.api.sendDeferredSms()
  assert.equal(harness.state.status, "canceled")
  assert.equal(harness.effects.glassStatus, "sending")
  assert.equal(harness.effects.glassClaimed, true)
  assert.equal(harness.effects.provider, 0)
})

test("retryable deferred text is exposed only after its Customer Page cleanup finishes", async () => {
  const harness = smsHarness({ status: "queued", glass: true, journalFailures: 1 })
  await harness.api.sendDeferredSms()
  assert.equal(harness.state.status, "queued")
  assert.equal(harness.effects.glassStatus, "deferred")
  assert.deepEqual(harness.effects.cleanupOrder, ["glass cleanup", "message reset"])
})

test("Customer Page wrapper distinguishes a known unsent text from a lost provider response", async () => {
  for (const error of [new SmsNotSentError("Customer opted out"), new Error("provider response lost")]) {
    let resultingStatus
    const sql = async (strings, ...values) => {
      const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
      if (query.startsWith("UPDATE glass_links g SET send_claimed_at")) return [{ lead_id: 7, phone: "+16155550111", person_id: 3, is_test: false, send_attempts: 1 }]
      if (query.startsWith("UPDATE glass_links SET send_claimed_at = NULL")) { resultingStatus = values[0]; return [] }
      throw new Error(`Unexpected Customer Page SQL: ${query}`)
    }
    const api = load("lib/glass-delivery.ts", new Map([
      ["@/lib/db", { getSql: () => sql }],
      ["@/lib/events", { recordEvent: async () => { throw new Error("No delivery receipt expected") } }],
      ["@/lib/glass", { hashGlassToken: () => "a".repeat(64) }],
      ["@/lib/messages", { sendSmsPersisted: async () => { throw error } }],
      ["@/lib/people", { isReservedShopPhone: () => false }],
      ["@/lib/twilio", { isDefinitiveTwilioError: () => false }],
      ["@/lib/sms-provider-truth.ts", { isSmsNotSentError }],
    ]))
    await assert.rejects(api.deliverGlassClipboard({ token: "synthetic", leadId: 7, operatorId: 2 }), (thrown) => thrown === error)
    assert.equal(resultingStatus, isSmsNotSentError(error) ? "failed" : "unknown")
  }
})

test("late Customer Page wrapper failure cannot clear the next attempt's active claim", async () => {
  const link = { attempts: 1, status: "sending", claimed: true }
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (query.startsWith("UPDATE glass_links g SET send_claimed_at")) return [{ lead_id: 7, phone: "+16155550111", person_id: 3, is_test: false, send_attempts: 1 }]
    if (query.startsWith("UPDATE glass_links SET send_claimed_at = NULL")) {
      if (query.includes("AND send_attempts =") && Number(values[3]) !== link.attempts) return []
      link.status = values[0]; link.claimed = false; return []
    }
    throw new Error(`Unexpected Customer Page SQL: ${query}`)
  }
  const api = load("lib/glass-delivery.ts", new Map([
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/events", { recordEvent: async () => 1 }],
    ["@/lib/glass", { hashGlassToken: () => "a".repeat(64) }],
    ["@/lib/messages", { sendSmsPersisted: async () => {
      // A second request claims immediately after inner preflight cleanup.
      link.attempts = 2
      throw new SmsNotSentError("Journal unavailable")
    } }],
    ["@/lib/people", { isReservedShopPhone: () => false }],
    ["@/lib/twilio", { isDefinitiveTwilioError: () => false }],
    ["@/lib/sms-provider-truth.ts", { isSmsNotSentError }],
  ]))
  await assert.rejects(api.deliverGlassClipboard({ token: "synthetic", leadId: 7, operatorId: 2 }), /Journal unavailable/)
  assert.equal(link.status, "sending")
  assert.equal(link.claimed, true)
})

test("consent revoked between request validation and dispatch also prevents immediate SMS", async () => {
  const harness = smsHarness({ consent: [true, false] })
  await assert.rejects(harness.send(), /no longer has texting permission/)
  assert.equal(harness.state.status, "canceled")
  assert.equal(harness.effects.provider, 0)
})

test("initial consent lookup outage is known unsent and the same intent can retry", async () => {
  const harness = smsHarness({ consent: [new Error("consent unavailable"), true, true] })
  await assert.rejects(harness.send(), (error) => isSmsNotSentError(error) && error.message === "consent unavailable")
  assert.equal(harness.effects.provider, 0)
  assert.equal(harness.effects.journal.length, 0)
  assert.equal(harness.state.status, "persisted")
  await harness.send()
  assert.equal(harness.effects.provider, 1)
  assert.equal(harness.state.status, "accepted")
})

test("Customer Page with a missing or reserved phone remains safely retryable", async () => {
  for (const phone of ["", "+16155550100"]) {
    let resultingStatus
    let sends = 0
    const sql = async (strings, ...values) => {
      const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
      if (query.startsWith("UPDATE glass_links g SET send_claimed_at")) return [{ lead_id: 7, phone, person_id: 3, is_test: false, send_attempts: 1 }]
      if (query.startsWith("UPDATE glass_links SET send_claimed_at = NULL")) { resultingStatus = values[0]; return [] }
      throw new Error(`Unexpected Customer Page SQL: ${query}`)
    }
    const api = load("lib/glass-delivery.ts", new Map([
      ["@/lib/db", { getSql: () => sql }],
      ["@/lib/events", { recordEvent: async () => 1 }],
      ["@/lib/glass", { hashGlassToken: () => "a".repeat(64) }],
      ["@/lib/messages", { sendSmsPersisted: async () => { sends++; throw new Error("must not send") } }],
      ["@/lib/people", { isReservedShopPhone: (value) => value === "+16155550100" }],
      ["@/lib/twilio", { isDefinitiveTwilioError: () => false }],
      ["@/lib/sms-provider-truth.ts", { SmsNotSentError, isSmsNotSentError }],
    ]))
    await assert.rejects(api.deliverGlassClipboard({ token: "synthetic", leadId: 7, operatorId: 2 }), isSmsNotSentError)
    assert.equal(sends, 0)
    assert.equal(resultingStatus, "failed")
  }
})

test("test-partition intents cannot send immediately or through the deferred worker", async () => {
  for (const status of ["persisted", "queued"]) {
    const harness = smsHarness({ status, isTest: true })
    if (status === "queued") await harness.api.sendDeferredSms()
    else await assert.rejects(harness.send(), /Internal test/)
    assert.equal(harness.state.status, "canceled")
    assert.equal(harness.effects.provider, 0)
    assert.equal(harness.effects.journal.length, 0)
  }
})

test("journal outage before SMS provider dispatch preserves a safely retryable intent", async () => {
  for (const status of ["persisted", "queued"]) {
    const harness = smsHarness({ status, journalFailures: 1 })
    if (status === "queued") await harness.api.sendDeferredSms()
    else await assert.rejects(harness.send(), /journal unavailable/)
    assert.equal(harness.state.status, status)
    assert.equal(harness.effects.provider, 0)
    assert.equal(harness.effects.notifications, 0)
    if (status === "queued") {
      assert.ok(harness.state.send_after)
      await harness.api.sendDeferredSms()
    } else await harness.send()
    assert.equal(harness.effects.provider, 1)
    assert.equal(harness.state.status, "accepted")
  }
})

test("response loss after SMS provider dispatch remains unknown and cannot automatically resend", async () => {
  const harness = smsHarness({ providerFailure: true })
  await assert.rejects(harness.send(), /provider response lost/)
  assert.equal(harness.state.status, "unknown")
  await assert.rejects(harness.send(), /may have accepted/)
  assert.equal(harness.effects.provider, 1)
})

function callHarness({ lead = {}, prior = null, journalFailures = 0, providerFailure = false } = {}) {
  const job = { id: 7, first_name: "Fixture", phone: "+16155550111", person_id: 3, is_test: false,
    person_is_test: false, service: "Trailer repair", routed_to_lead_id: null, account_key: "", ...lead }
  let state = prior ? { id: 88, status: "persisted", twilio_sid: "pending:call-fixture", lead_id: 7, to_phone: job.phone, is_test: false, ...prior } : null
  const effects = { provider: 0, journal: [], claims: 0 }
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (query.startsWith("SELECT l.id")) return [job]
    if (query.startsWith("INSERT INTO calls")) {
      if (state) return []
      state = { id: 88, status: "persisted", twilio_sid: values[0], lead_id: 7, to_phone: job.phone, is_test: false }
      return [{ id: state.id, is_test: state.is_test }]
    }
    if (query.startsWith("SELECT id, status, twilio_sid")) return [{ ...state }]
    if (query.startsWith("UPDATE calls SET status = 'starting'")) {
      effects.claims++
      if (state.status !== "persisted") return []
      state.status = "starting"; return [{ id: state.id }]
    }
    if (query.startsWith("UPDATE calls SET twilio_sid")) { state.twilio_sid = values[0]; state.status = values[1]; return [] }
    if (query.startsWith("UPDATE calls SET status = ?")) { state.status = values[0]; return [{ id: state.id }] }
    if (query.startsWith("SELECT twilio_sid FROM calls")) return [{ twilio_sid: state.twilio_sid }]
    throw new Error(`Unexpected call SQL: ${query}`)
  }
  const fakes = new Map([
    ["node:crypto", { randomUUID: () => "call-fixture" }],
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/ops-auth", { getAuthenticatedOperator: async () => ({ id: 2, role: "owner", name: "Fixture", cell_phone: "+16155550122" }) }],
    ["@/lib/people", { normalizePhone: (phone) => phone, isReservedShopPhone: () => false }],
    ["@/lib/events", { recordEvent: async (event) => {
      if (event.kind === "call.out.intent" && journalFailures-- > 0) throw new Error("journal unavailable")
      effects.journal.push(event.kind); return effects.journal.length
    } }],
    ["@/lib/notify", { notify: async () => {} }],
    ["@/lib/twilio", { twilioVoiceConfigured: () => true, isDefinitiveTwilioError: () => false, twilioCallbackUrl: (path) => path,
      startVoiceCall: async () => { effects.provider++; if (providerFailure) throw new Error("provider response lost"); return { sid: "CAaccepted", status: "ringing" } } }],
  ])
  const api = load("app/api/ops/call/route.ts", fakes)
  return { effects, state: () => state, send: () => api.POST(new Request("https://fixture.invalid/api/ops/call", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId: 7, targetPhone: job.phone, intentKey: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }),
  })) }
}

test("call journal failure before claim can retry the same intent without a stranded starting state", async () => {
  const harness = callHarness({ journalFailures: 1 })
  await assert.rejects(harness.send(), /journal unavailable/)
  assert.equal(harness.state().status, "persisted")
  assert.equal(harness.effects.provider, 0)
  assert.equal(harness.effects.claims, 0)
  assert.equal((await harness.send()).status, 200)
  assert.equal(harness.effects.provider, 1)
})

test("call response loss remains unknown and a replay cannot ring again", async () => {
  const harness = callHarness({ providerFailure: true })
  assert.equal((await harness.send()).status, 502)
  assert.equal(harness.state().status, "unknown")
  assert.equal((await harness.send()).status, 409)
  assert.equal(harness.effects.provider, 1)
})

test("routed, unmatched, or test-linked calls fail before writing or dialing", async () => {
  for (const lead of [{ routed_to_lead_id: 8 }, { service: "Needs job match" }, { is_test: true }, { person_is_test: true }]) {
    const harness = callHarness({ lead })
    assert.equal((await harness.send()).status, 409)
    assert.equal(harness.state(), null)
    assert.equal(harness.effects.provider, 0)
  }
})

test("reusing a call intent for another job or contact cannot misfile a receipt or dial", async () => {
  for (const prior of [{ lead_id: 8 }, { to_phone: "+16155550199" }, { is_test: true }]) {
    const harness = callHarness({ prior })
    assert.equal((await harness.send()).status, 409)
    assert.equal(harness.effects.journal.length, 0)
    assert.equal(harness.effects.provider, 0)
  }
})
