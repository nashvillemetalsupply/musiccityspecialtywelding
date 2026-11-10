import assert from "node:assert/strict"
import { createHmac, createHash } from "node:crypto"
import { createRequire, registerHooks } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { z } from "zod"
import { stripAssistantMoney } from "../lib/assistant/money.ts"

const nativeRequire = createRequire(import.meta.url)
const sid = `CA${"a".repeat(32)}`
const caller = "+16155550199"
const base = "https://example.test"
const emptyTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const env = {
  TWILIO_ACCOUNT_SID: `AC${"b".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "synthetic-voice-token",
  TWILIO_PHONE_NUMBER: "+16155550100",
  OWNER_CELL_PHONE: "+16155550101",
  TWILIO_WEBHOOK_BASE_URL: base,
}
const compiledModules = new Map()

function loadModule(path, fakeEnv, fakes = new Map()) {
  if (!compiledModules.has(path)) compiledModules.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)
  const output = compiledModules.get(path)
  const context = vm.createContext({
    process: { env: fakeEnv }, Response, Request, URL, URLSearchParams, Buffer,
    console: { error() {}, warn() {} },
  })
  const loaded = { exports: {} }
  const run = vm.runInContext(`(function(require, module, exports) { ${output}\n})`, context)
  run((name) => {
    if (name.startsWith("node:")) return nativeRequire(name)
    assert.ok(fakes.has(name), `unexpected import in ${path}: ${name}`)
    return fakes.get(name)
  }, loaded, loaded.exports)
  return loaded.exports
}

function signedRequest(path, params, signature = "valid") {
  const body = new URLSearchParams(params)
  let payload = `${base}${path}`
  for (const key of [...new Set(body.keys())].sort()) {
    for (const value of body.getAll(key).sort()) payload += `${key}${value}`
  }
  const signed = createHmac("sha1", env.TWILIO_AUTH_TOKEN).update(payload).digest("base64")
  return new Request(`${base}${path}`, {
    method: "POST", body,
    headers: signature === "missing" ? {} : { "x-twilio-signature": signature === "valid" ? signed : signature },
  })
}

function statusHarness({ flag, isTest = false, exists = true, duplicate = false, missingEvent = false, draft = false } = {}) {
  const fakeEnv = { ...env, ...(flag === undefined ? {} : { ASSISTANT_VOICE: flag }) }
  const twilio = loadModule("lib/twilio.ts", fakeEnv)
  const sqlCalls = []
  const events = []
  const notifications = []
  const sms = []
  const background = []
  const order = []
  const sql = async (strings, ...values) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim()
    sqlCalls.push({ text, values })
    if (text.startsWith("UPDATE calls SET status")) return exists ? [{
      lead_id: draft ? null : 41, person_id: 9, from_phone: caller, is_test: isTest,
    }] : []
    if (text.startsWith("SELECT id FROM operators")) return [{ id: 1 }]
    if (text.startsWith("SELECT id FROM events")) return missingEvent ? [] : [{ id: 201 }]
    if (text.startsWith("UPDATE leads SET")) return []
    throw new Error(`Unexpected status SQL: ${text}`)
  }
  const modules = new Map([
    ["next/server", { after: (fn) => background.push(fn) }],
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/events", { recordEvent: async (value) => { order.push("receipt"); events.push(structuredClone(value)); return duplicate || missingEvent ? null : 201 } }],
    ["@/lib/messages", { sendSmsPersisted: async (value) => { order.push("sms"); sms.push(structuredClone(value)) } }],
    ["@/lib/notify", { notifyAll: async (value) => { order.push("notify"); notifications.push(structuredClone(value)) } }],
    ["@/lib/people", { normalizePhone: (value) => value }],
    ["@/lib/job-intake", { prepareInboundCallIntake: async () => ({
      kind: "draft", leadId: null, person: { id: 9, is_test: isTest },
      draft: { public_id: "draft-9", is_test: isTest },
    }) }],
    ["@/lib/twilio", { ...twilio, twilioSmsConfigured: () => true, twiml: (...args) => {
      order.push(args[0].includes("<Redirect") ? "redirect" : "response")
      return twilio.twiml(...args)
    } }],
    ["@/lib/recovery-sweep", { runRecoverySweep: async () => ({ ok: true, skipped: true }) }],
    ["@/lib/gmail-wake", { wakeGmailIngest: async () => ({ ok: true }) }],
    ["zod", { z }],
  ])
  const { POST } = loadModule("app/api/twilio/voice-status/route.ts", fakeEnv, modules)
  return { POST, sqlCalls, events, notifications, sms, background, order }
}

const statusRequest = (status, extras = {}, signature) => signedRequest("/api/twilio/voice-status", {
  CallSid: sid, From: caller, To: env.TWILIO_PHONE_NUMBER,
  DialCallStatus: status, DialCallDuration: "0", ...extras,
}, signature)

test("voice-status flag unset and non-one values keep original empty TwiML byte for byte", async () => {
  for (const flag of [undefined, "0", "true", " 1"]) {
    for (const status of ["no-answer", "busy", "failed", "canceled", "completed", "answered", "unknown"]) {
      for (const options of [{}, { isTest: true }, { duplicate: true }, { draft: true }, { exists: false }]) {
        const h = statusHarness({ flag, ...options })
        const response = await h.POST(statusRequest(status))
        assert.equal(response.status, 200)
        assert.equal(await response.text(), emptyTwiml, `${flag}: ${status}: ${JSON.stringify(options)}`)
        assert.equal(response.headers.get("content-type"), "text/xml; charset=utf-8")
      }
    }
  }
})

test("flag-off missed calls retain the existing receipt, notification and SMS behavior", async () => {
  for (const flag of [undefined, "0"]) {
    const h = statusHarness({ flag })
    assert.equal(await (await h.POST(statusRequest("no-answer"))).text(), emptyTwiml)
    assert.equal(h.events[0].kind, "call.missed")
    assert.equal(h.events[0].externalId, `${sid}:missed`)
    assert.equal(h.notifications.length, 1)
    assert.equal(h.notifications[0].title, "Missed shop call")
    assert.equal(h.notifications[0].sourceEventId, 201)
    assert.equal(h.sms.length, 1)
    assert.equal(h.sms[0].idempotencyKey, `missed-call:${sid}:auto-reply`)
    assert.deepEqual(h.sms[0], {
      to: caller,
      body: "Sorry we missed you. Text what you need and send a photo if you can. — Music City Specialty Welding",
      leadId: 41, personId: 9, idempotencyKey: `missed-call:${sid}:auto-reply`,
    })
    assert.deepEqual(h.order, ["receipt", "notify", "sms", "response"])
    assert.equal(h.background.length, 1)
  }
  const internal = statusHarness({ isTest: true })
  await internal.POST(statusRequest("no-answer"))
  assert.equal(internal.notifications.length, 0)
  assert.equal(internal.sms.length, 0)
  assert.equal(internal.background.length, 0)
})

test("only a known missed inbound call reaches the assistant with exact flag one", async () => {
  for (const status of ["no-answer", "busy", "failed", "canceled"]) {
    for (const isTest of [false, true]) {
      const h = statusHarness({ flag: "1", isTest })
      const response = await h.POST(statusRequest(status))
      assert.equal(await response.text(), '<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">https://example.test/api/twilio/assist-voice</Redirect></Response>')
      assert.equal(h.events[0].kind, "call.missed", "signed provider receipt still lands first")
      assert.equal(h.notifications.length, isTest ? 0 : 1)
      if (!isTest) {
        assert.equal(h.notifications[0].title, "Missed shop call")
        assert.equal(h.notifications[0].sourceEventId, 201)
        assert.deepEqual(h.order, ["receipt", "notify", "redirect"])
      } else assert.deepEqual(h.order, ["receipt", "redirect"])
      assert.equal(h.sms.length, 0)
      if (isTest) assert.equal(h.background.length, 0)
    }
  }
  for (const options of [{ exists: false }, {}]) {
    for (const status of ["answered", "completed", "unknown"]) {
      const h = statusHarness({ flag: "1", ...options })
      assert.equal(await (await h.POST(statusRequest(status))).text(), emptyTwiml)
    }
  }
  const unknown = statusHarness({ flag: "1", exists: false })
  assert.equal(await (await unknown.POST(statusRequest("no-answer"))).text(), emptyTwiml)
})

test("assistant missed-call retries reuse the immutable receipt and crew notification identity", async () => {
  for (const draft of [false, true]) {
    const h = statusHarness({ flag: "1", duplicate: true, draft })
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await h.POST(statusRequest("no-answer"))
      assert.match(await response.text(), /<Redirect method="POST">/)
      assert.equal(h.events[attempt].externalId, `${sid}:missed`)
      assert.equal(h.notifications[attempt].sourceEventId, 201)
      assert.equal(h.notifications[attempt].url, draft ? "/ops/intake/draft-9" : "/ops/leads/41")
    }
    assert.equal(h.sqlCalls.filter((query) => query.text.startsWith("SELECT id FROM events")).length, 2)
    assert.equal(h.sms.length, 0)
    assert.deepEqual(h.order, ["receipt", "notify", "redirect", "receipt", "notify", "redirect"])
  }
  for (const flag of [undefined, "1"]) {
    const h = statusHarness({ flag, missingEvent: true })
    const body = await (await h.POST(statusRequest("no-answer"))).text()
    assert.equal(h.notifications.length, 0)
    assert.equal(h.sms.length, 0)
    if (flag === "1") assert.match(body, /<Redirect method="POST">/)
    else assert.equal(body, emptyTwiml)
  }
})

test("voice-status rejects invalid signatures and malformed callback fields before SQL", async () => {
  for (const flag of [undefined, "0", "1"]) {
    for (const signature of ["missing", "invalid"]) {
      const h = statusHarness({ flag })
      const response = await h.POST(statusRequest("no-answer", {}, signature))
      assert.equal(response.status, 403)
      assert.equal(await response.text(), emptyTwiml)
      assert.equal(h.sqlCalls.length, 0)
    }
    for (const extras of [{ CallSid: "bad" }, { DialCallDuration: "bad" }, { DialCallDuration: "-1" }]) {
      const h = statusHarness({ flag })
      const response = await h.POST(statusRequest("no-answer", extras))
      assert.equal(response.status, 400)
      assert.equal(await response.text(), emptyTwiml)
      assert.equal(h.sqlCalls.length, 0)
    }
  }
})

test("original voice greeting and recorded shop Dial are identical with flag unset, zero or one", async () => {
  const expected = '<?xml version="1.0" encoding="UTF-8"?><Response>'
    + '<Say voice="man">Music City Specialty Welding. This call may be recorded for job notes.</Say>'
    + '<Dial answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="https://example.test/api/twilio/recording" action="https://example.test/api/twilio/voice-status">+16155550101</Dial></Response>'
  for (const flag of [undefined, "0", "1"]) {
    const fakeEnv = { ...env, ...(flag === undefined ? {} : { ASSISTANT_VOICE: flag }) }
    const twilio = loadModule("lib/twilio.ts", fakeEnv)
    let writes = 0
    const modules = new Map([
      ["@/lib/db", { getSql: () => async () => { writes++; return [] } }],
      ["next/server", { after() {} }],
      ["@/lib/job-intake", {
        inboundCallNotificationDedupeKey() {}, markInboundCallReconciliationHandled() {},
        persistInboundCallReceipt() {}, prepareInboundCallIntake() {},
      }],
      ["@/lib/notify", { notifyAll() {} }],
      ["@/lib/people", { normalizePhone: (value) => value }],
      ["@/lib/roof-leads", { recordRoofCall() {} }],
      ["@/lib/twilio", twilio],
    ])
    const { POST } = loadModule("app/api/twilio/voice/route.ts", fakeEnv, modules)
    const response = await POST(signedRequest("/api/twilio/voice", { CallSid: sid, From: caller, To: env.TWILIO_PHONE_NUMBER }))
    assert.equal(response.status, 200)
    assert.equal(await response.text(), expected)
    assert.equal(writes, 1, "provider payload persists before returning Dial")
  }
})

function dependencyHarness({ isTest = false, missing = false, from = caller, duplicate = false, leadId = null, leadIsTest = null, filedIsTest, linkMissing = false } = {}) {
  const queries = []
  const log = []
  const records = []
  const notifications = []
  const filed = []
  const followUps = []
  const handoffs = []
  const sql = async (strings, ...values) => {
    for (let index = 0; index < values.length; index++) assert.match(strings[index + 1], /^::(?:text|uuid|bigint|int|boolean|jsonb)/, "every interpolation needs an explicit PostgreSQL cast")
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim()
    queries.push({ text, values })
    if (text.includes("FROM calls c LEFT JOIN")) return missing ? [] : [{ from_phone: from, is_test: isTest, lead_id: leadId, lead_is_test: leadIsTest }]
    if (text.startsWith("WITH linked AS")) {
      log.push("link")
      return linkMissing ? [] : [{ lead_id: leadId ?? 41 }]
    }
    if (text.startsWith("SELECT id FROM events")) return [{ id: 202 }]
    throw new Error(`Unexpected voice dependency SQL: ${text}`)
  }
  const fakes = new Map([
    ["../db.ts", { getSql: () => sql }],
    ["@/lib/events", { recordEvent: async (value) => { log.push("receipt"); records.push(structuredClone(value)); return duplicate ? null : 201 } }],
    ["@/lib/job-intake", { fileAssistantLead: async (value) => { log.push("lead"); filed.push(structuredClone(value)); return { leadId: 41, isTest: filedIsTest ?? value.isTest } } }],
    ["@/lib/notify", { notifyAll: async (value) => { log.push("notify"); notifications.push(structuredClone(value)) } }],
    ["@/lib/rate-limit", { consumeStrictRateLimit: async () => false, rateLimitFingerprint: (value) => createHash("sha256").update(value).digest("hex") }],
    ["@/lib/shop-contact", { getShopPhone: () => ({ display: "(615) 555-0100", href: "tel:+16155550100" }) }],
    ["./money.ts", { stripAssistantMoney }],
    ["./store.ts", { PostgresAssistantStore: class { constructor(key) { this.intakeKey = key } } }],
    ["./turn.ts", { handleAssistantTurn: async () => { throw new Error("model should be unused") } }],
    ["./voice.ts", { voiceCallbackPhone: (value) => value }],
    ["./followup.ts", { followUpAssistantLead: async (value) => { followUps.push(structuredClone(value)) } }],
    ["./handoff.ts", { deliverAssistantHandoff: async (value) => { handoffs.push(structuredClone(value)); return { leadId: value.leadId } } }],
  ])
  const { voiceDependencies } = loadModule("lib/assistant/voice-store.ts", env, fakes)
  return { voiceDependencies, queries, log, records, notifications, filed, followUps, handoffs }
}

test("voice dependencies wire the same lead followup used by chat", async () => {
  const h = dependencyHarness()
  const { deps } = await h.voiceDependencies(sid, caller)
  const input = { leadId: 41, eventId: 201, fields: { callback_phone: caller, callback_window: "after 3" }, isTest: false }
  await deps.followUpLead(input)
  assert.deepEqual(h.followUps, [input])
})

test("voice handoff adapter includes call identity and verified callback and reuses its linked lead", async () => {
  for (const linkedLead of [null, 73]) {
    const h = dependencyHarness({ leadId: linkedLead })
    const { deps, leadId } = await h.voiceDependencies(sid, caller)
    assert.equal(leadId, linkedLead)
    const input = {
      sessionId: "voice-session", turnIndex: 2, message: "A real person please", reply: "I'll try the shop now.",
      fields: { name: null, callback_phone: caller, need: "gate repair", is_job: "unsure" },
      reason: "human", leadId: null, isTest: false,
    }
    const result = await deps.handoff(input)
    assert.equal(result.leadId, linkedLead)
    assert.deepEqual(h.handoffs[0], {
      ...input, leadId: linkedLead, channel: "voice", callSid: sid, from: caller, callbackPhone: caller, deferDelivery: true,
    })
    await deps.handoff({ ...input, leadId: 41, isTest: true })
    assert.equal(h.handoffs[1].leadId, 41, "an explicit current session lead precedes the call's earlier link")
    assert.equal(h.handoffs[1].isTest, true)
    assert.equal(h.filed.length, 0, "the adapter leaves intake and notification gates to handoff delivery")
    assert.equal(h.notifications.length, 0)
  }
})

test("voice dependencies resolve durable call test context and reject missing or changed caller receipts", async () => {
  for (const isTest of [false, true]) {
    const h = dependencyHarness({ isTest })
    const context = await h.voiceDependencies(sid, caller)
    assert.equal(context.isTest, isTest)
    assert.equal(context.from, caller)
    assert.equal(context.deps.store.intakeKey, `call:${sid}`, "voice lease test fence shares the call intake key")
    const query = h.queries[0]
    assert.deepEqual(query.values, [sid])
    for (const evidence of ["c.is_test", "c.detail->>'isTest'", "c.detail->>'callerName'", "l.is_test", "p.is_test", "call_intake_drafts"]) assert.ok(query.text.includes(evidence), evidence)
  }
  await assert.rejects(dependencyHarness({ missing: true }).voiceDependencies(sid, caller), /receipt could not be confirmed/)
  await assert.rejects(dependencyHarness({ from: "+16155550188" }).voiceDependencies(sid, caller), /receipt could not be confirmed/)
})

test("voice lead adapter selects phone source; immutable receipt and notify payload remove money", async () => {
  const h = dependencyHarness()
  const { deps } = await h.voiceDependencies(sid, caller)
  const input = {
    sessionId: "voice-session", turnIndex: 1, leadId: 41, isTest: false,
    fields: { name: "Ava", callback_phone: caller, need: "gate repair $300", material_size: "48 inch steel", location: "Lebanon", timing: "next week", is_job: "yes" },
  }
  await deps.fileLead(input)
  assert.equal(h.filed[0].channel, "voice")
  assert.equal(h.filed[0].callSid, sid)
  const eventId = await deps.receipt(input)
  await deps.notify({ ...input, eventId })
  assert.deepEqual(h.log, ["lead", "link", "receipt"])
  assert.match(h.queries[1].text, /UPDATE calls c SET lead_id = l.id/)
  assert.match(h.queries[1].text, /UPDATE call_intake_drafts d SET status = 'saved'/)
  assert.deepEqual(h.queries[1].values, [sid, 41, sid])
  assert.equal(h.records[0].kind, "assistant.voice")
  assert.equal(h.records[0].externalId, `${sid}:1`)
  assert.equal(h.records[0].detail.callSid, sid)
  assert.doesNotMatch(h.records[0].body, /\$300/)
  assert.equal(h.records[0].crewBody, h.records[0].body)
  assert.equal(h.notifications.length, 0)
  assert.equal(h.handoffs[0].reason, "lead")
  assert.equal(h.handoffs[0].turnIndex, input.turnIndex)
  assert.equal(h.handoffs[0].leadId, input.leadId)
  assert.equal(h.handoffs[0].channel, "voice")
  assert.equal(h.handoffs[0].callSid, sid)
  assert.equal(h.handoffs[0].callbackPhone, caller)
  assert.equal(h.handoffs[0].deferDelivery, true, "providers run after the voice response from the durable outbox")
})

test("voice receipt retry resolves the same immutable external ID without duplicating it", async () => {
  const h = dependencyHarness({ isTest: true, duplicate: true })
  const { deps } = await h.voiceDependencies(sid, caller)
  const eventId = await deps.receipt({
    sessionId: "voice-session", turnIndex: 2, leadId: 41, isTest: true,
    fields: { need: "gate repair", material_size: null, location: null, timing: null },
  })
  assert.equal(eventId, 202)
  assert.match(h.records[0].body, /\[INTERNAL TEST\]/)
  assert.equal(h.records[0].detail.isTest, true)
  assert.equal(h.queries[1].values[0], `${sid}:2`)
  assert.equal(h.notifications.length, 0)
})

test("voice filing reuses a linked job and refuses partition mismatches before linking or notifying", async () => {
  const input = { sessionId: "voice-session", fields: { need: "gate repair" }, isTest: false }
  const reused = dependencyHarness({ leadId: 73, leadIsTest: false })
  const reusedContext = await reused.voiceDependencies(sid, caller)
  const result = await reusedContext.deps.fileLead(input)
  assert.equal(result.leadId, 73)
  assert.equal(reused.filed.length, 0, "an existing call job must not create another lead")
  assert.deepEqual(reused.log, ["link"])
  assert.equal(reused.queries[1].values[1], 73)
  for (const options of [{ leadId: 73, leadIsTest: true }, { filedIsTest: true }]) {
    const h = dependencyHarness(options)
    const { deps } = await h.voiceDependencies(sid, caller)
    await assert.rejects(deps.fileLead(input), /test partition changed/)
    assert.equal(h.queries.length, 1, "partition must be checked before linking")
    assert.equal(h.records.length, 0)
    assert.equal(h.notifications.length, 0)
  }
  const lostLink = dependencyHarness({ linkMissing: true })
  const { deps } = await lostLink.voiceDependencies(sid, caller)
  await assert.rejects(deps.fileLead(input), /could not be linked/)
  assert.equal(lostLink.records.length, 0)
  assert.equal(lostLink.notifications.length, 0)
})

const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true })
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const sources = {
      "@/lib/call-artifacts": "export const attachRecoveredCallArtifacts = async () => {};",
      "@/lib/build-sheets": "export const ingestCallSketchBuildFacts = async () => {};",
      "@/lib/db": "export const getSql = () => globalThis.__voiceWiringSql;",
      "@/lib/events": "export const recordEvent = async () => null;",
      "@/lib/leads": "export const createLead = (...args) => globalThis.__voiceWiringCreateLead(...args);",
      "@/lib/people": `
        export const findOrCreatePerson = async () => null;
        export const findOpenLeadResolutionForPerson = async () => ({leadId:null});
        export const normalizePhone = (value) => { const digits = value.replace(/\\D/g, '').replace(/^1(?=\\d{10}$)/, ''); return /^[2-9]\\d{2}[2-9]\\d{6}$/.test(digits) ? '+1' + digits : ''; };
      `,
    }
    if (Object.hasOwn(sources, specifier)) return stub(sources[specifier])
    return nextResolve(specifier, context)
  },
})
const { fileAssistantLead } = await import("../lib/job-intake.ts")
hooks.deregister()

test("real assistant intake shares the call Save Job key across voice session retries", async () => {
  const leads = new Map()
  const savedInputs = []
  const queryKeys = []
  globalThis.__voiceWiringSql = async (strings, ...values) => {
    const query = strings.join(" ? ")
    if (query.includes("WHERE intake_key")) {
      queryKeys.push(values[0])
      const lead = leads.get(values[0])
      return lead ? [{ id: lead.id, is_test: lead.isTest }] : []
    }
    if (query.includes("WHERE id")) {
      const lead = [...leads.values()].find((row) => row.id === values[0])
      return lead ? [{ id: lead.id, is_test: lead.isTest }] : []
    }
    throw new Error(`Unexpected assistant intake SQL: ${query}`)
  }
  globalThis.__voiceWiringCreateLead = async (input, options) => {
    savedInputs.push(structuredClone({ input, options }))
    if (!leads.has(options.intakeKey)) leads.set(options.intakeKey, { id: 81, isTest: input.isTest })
    return { id: leads.get(options.intakeKey).id }
  }
  const input = {
    sessionId: "voice-session-one", channel: "voice", callSid: sid, isTest: true,
    fields: { name: "Ava", callback_phone: caller, need: "repair gate $300", material_size: "48 inch steel", location: "Lebanon", timing: "next week", callback_window: "after 3; budget $400", is_job: "yes" },
  }
  assert.equal((await fileAssistantLead(input)).leadId, 81)
  assert.equal((await fileAssistantLead({ ...input, sessionId: "voice-session-two" })).leadId, 81)
  assert.equal(leads.size, 1)
  assert.deepEqual(queryKeys, [`call:${sid}`, `call:${sid}`])
  assert.equal(savedInputs[0].options.intakeKey, `call:${sid}`)
  assert.equal(savedInputs[0].options.sourceOverride, "phone-assistant")
  assert.equal(savedInputs[0].input.service, "Phone assistant request")
  assert.equal(savedInputs[0].input.userAgent, "phone-assistant")
  assert.equal(savedInputs[0].input.preferredContact, "Call")
  assert.match(savedInputs[0].input.message, /\[INTERNAL TEST\]/)
  assert.doesNotMatch(savedInputs[0].input.message, /\$300/)
  assert.match(savedInputs[0].input.message, /Callback requested: after 3/)
  assert.doesNotMatch(savedInputs[0].input.message, /\$400/)
  await assert.rejects(fileAssistantLead({ ...input, callSid: "bad" }), /needs a call receipt/)
  const synthetic = `CA_INTERNAL_TEST_${"c".repeat(32)}`
  assert.equal((await fileAssistantLead({ ...input, callSid: synthetic })).isTest, true)
  assert.ok(leads.has(`call:${synthetic}`))
  await assert.rejects(fileAssistantLead({ ...input, callSid: synthetic, isTest: false }), /needs a call receipt/)
  await assert.rejects(fileAssistantLead({ ...input, callSid: "CA_INTERNAL_TEST_bad" }), /needs a call receipt/)
})
