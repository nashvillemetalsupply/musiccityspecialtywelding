import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { stripAssistantMoney } from "../lib/assistant/money.ts"
import * as contact from "../lib/assistant/contact.ts"

const require = createRequire(import.meta.url)
const id = "126e8815-0502-4f7d-94a5-0df870ac6b46"
const sid = `CA${"a".repeat(32)}`
const caller = "+16155550199"
const phone = { display: "(615) 703-3296", href: "tel:+16157033296" }
const source = readFileSync(new URL("../lib/assistant/handoff.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const copy = (value) => structuredClone(value)
const fields = (overrides = {}) => ({ name: null, callback_phone: null, need: "", material_size: null,
  location: null, timing: null, callback_window: null, is_job: "unsure", ...overrides })

function fixture({ turns = [], isTest = false, leadId = null, voiceTest = false, callback = caller,
  transcript = "", emailConfigured = true, emailStatus = "accepted", ownerConfigured = true, failFile = false, failNotify = false, busy = false } = {}) {
  const env = { NEXT_PUBLIC_ASSISTANT_CHAT: "1", ASSISTANT_VOICE: "1" }
  const session = { id, next_turn: turns.length, lead_id: leadId, is_test: isTest }
  const records = new Map()
  const emails = new Map()
  const notifications = new Map()
  const phoneAlerts = new Map()
  const sms = new Map()
  const filed = []
  const queries = []
  const log = []
  let fileFails = failFile
  let emailEnabled = emailConfigured
  let notifyFails = failNotify
  let lease = null
  const sql = async (strings, ...values) => {
    for (let i = 0; i < values.length; i++) assert.match(strings[i + 1], /^::\w+/, "explicit SQL casts")
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    queries.push({ query, values })
    if (query.startsWith("INSERT INTO assistant_sessions")) return []
    if (query.startsWith("SELECT COALESCE(s.lead_id")) {
      assert.match(query, /s.is_test.*l.is_test.*p.is_test.*assistant_turns.*t.is_test.*INTERNAL TEST/)
      return [{ lead_id: session.lead_id ?? values[0], lead_is_test: session.lead_id ? session.is_test : null, is_test: session.is_test }]
    }
    if (query.startsWith("UPDATE assistant_sessions s SET is_test")) { session.is_test = true; return [{ id }] }
    if (query.startsWith("SELECT turn_index, inbound")) return copy(turns)
    if (query.startsWith("SELECT body, detail FROM events")) {
      const row = records.get(`assistant.handoff-request:${values[0]}`)
      return row ? [copy(row)] : []
    }
    if (query.startsWith("SELECT id, lead_id FROM events")) {
      const row = records.get(`assistant.handoff:${values[0]}`)
      return row ? [{ id: row.id, lead_id: row.leadId }] : []
    }
    if (query.startsWith("UPDATE assistant_sessions SET lead_id")) {
      session.lead_id ??= values[0]
      return [{ lead_id: session.lead_id }]
    }
    if (query.startsWith("SELECT e.detail FROM events")) {
      assert.match(query, /e.detail->>'sessionId' = \? ::text/)
      return [...records.values()].filter((row) => row.kind === "assistant.handoff-request"
        && (!row.detail.isTest || values[0] !== null) && (values[0] === null || row.detail.sessionId === values[0])
        && (!emails.has(`${id}:${row.detail.deliveryReason ?? row.detail.reason}`)
          || !records.has(`assistant.handoff-complete:${row.externalId}`))).map((row) => ({ detail: copy(row.detail) }))
    }
    if (query.startsWith("SELECT id, next_turn, is_test FROM assistant_sessions")) {
      assert.match(query, /AND \(\s*\? ::uuid IS NULL OR id = \? ::uuid\)/)
      return session.lead_id || (session.is_test && values[0] !== id) || (values[0] !== null && values[0] !== id) ? [] : [copy(session)]
    }
    if (query.startsWith("UPDATE assistant_sessions SET lease_token = NULL")) { lease = null; return [] }
    if (query.startsWith("UPDATE assistant_sessions SET lease_token")) {
      if (busy) return []
      lease = values[0]
      return [{ id }]
    }
    if (query.startsWith("SELECT inbound FROM assistant_turns")) return copy(turns)
    if (query.startsWith("SELECT c.transcript, c.lead_id, c.person_id")) {
      assert.match(query, /s.is_test.*assistant_turns.*t.is_test.*INTERNAL TEST/)
      return [{ transcript, lead_id: leadId, person_id: 9, assistant_is_test: session.is_test }]
    }
    throw new Error(`Unexpected handoff SQL: ${query}`)
  }
  const fileLead = async (value) => {
    assert.ok([...records.values()].some((row) => row.kind === "assistant.handoff-request"), "request precedes intake")
    if (fileFails) { fileFails = false; throw new Error("intake unavailable") }
    filed.push(copy(value))
    return { leadId: leadId ?? 41, isTest: value.isTest }
  }
  const modules = new Map([
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/events", { recordEvent: async (value) => {
      const key = `${value.kind}:${value.externalId}`
      if (records.has(key)) return null
      const saved = { ...copy(value), id: records.size + 100 }
      records.set(key, saved)
      log.push(value.kind)
      return saved.id
    } }],
    ["@/lib/job-intake", { fileAssistantLead: fileLead }],
    ["@/lib/notify", {
      emailAssistantTranscript: async (value) => {
        assert.ok([...records.values()].some((row) => row.kind === "assistant.handoff" && row.id === value.eventId), "handoff receipt precedes email")
        if (emailEnabled) emails.set(`${value.sessionId}:${value.reason}`, copy(value))
        return emailEnabled ? emailStatus : "unavailable"
      },
      notifyAll: async (value) => {
        assert.ok([...records.values()].some((row) => row.kind === "assistant.handoff" && row.id === value.sourceEventId), "handoff receipt precedes notification")
        if (notifyFails) { notifyFails = false; throw new Error("notification unavailable") }
        notifications.set(value.dedupeKey, copy(value))
        return []
      },
      notifyOwnerCellSms: async (value) => {
        assert.ok([...records.values()].some((row) => row.kind === "assistant.handoff" && row.id === value.sourceEventId), "handoff receipt precedes shop phone alert")
        if (!ownerConfigured) return { id: 0, sent: false, reason: "not-for-role" }
        phoneAlerts.set(value.dedupeKey, copy(value))
        return { id: 1, sent: true, reason: "sent" }
      },
    }],
    ["@/lib/shop-contact", { getShopPhone: () => phone }],
    ["./money.ts", { stripAssistantMoney }], ["./contact.ts", contact],
    ["./voice.ts", { voiceSessionId: () => id, voiceCallbackPhone: (value) => /^\+1615555\d{4}$/.test(value) ? value : "" }],
    ["./voice-store.ts", { voiceDependencies: async (callSid, from) => {
      assert.equal(callSid, sid)
      assert.equal(from, callback)
      return { isTest: voiceTest, from, leadId, deps: { fileLead } }
    } }],
    ["@/lib/messages", { sendSmsPersisted: async (value) => { sms.set(value.idempotencyKey, copy(value)) } }],
  ])
  const loaded = { exports: {} }
  const context = vm.createContext({ process: { env } })
  vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context)((name) => {
    if (name.startsWith("node:")) return require(name)
    assert.ok(modules.has(name), `unmocked import ${name}`)
    return modules.get(name)
  }, loaded, loaded.exports)
  return { ...loaded.exports, env, session, records, emails, notifications, phoneAlerts, sms, filed, queries, log,
    setEmailConfigured: (value) => { emailEnabled = value }, lease: () => lease }
}

const request = (overrides = {}) => ({ sessionId: id, turnIndex: 0, message: "I want a person. Call 615-555-0199. Budget $300.",
  reason: "human", isTest: false, ...overrides })

test("each handoff reason journals the complete scrubbed transcript, files partial contact, and dedupes replay", async () => {
  for (const reason of ["human", "unknown", "model-error", "rate-limit", "unavailable"]) {
    const long = "The trailer gate hinge cracked. ".repeat(35)
    const f = fixture({ turns: [{ turn_index: 0, inbound: long, result: { fields: fields({ need: "trailer gate hinge" }), reply: "What number?" }, response: null }] })
    const input = request({ turnIndex: 1, reason })
    assert.equal((await f.deliverAssistantHandoff(input)).leadId, 41)
    await f.deliverAssistantHandoff(input)
    assert.equal(f.emails.size, 1)
    assert.equal(f.notifications.size, 2, "one reason alert plus normal filed-lead crew alert")
    assert.equal(f.filed.length, 1)
    assert.equal(f.filed[0].partial, true)
    assert.equal(f.filed[0].fields.callback_phone, caller)
    const email = [...f.emails.values()][0]
    assert.match(email.transcript, /Customer: The trailer gate hinge/)
    assert.ok(email.transcript.length > 1000, "the email keeps more than notification body's limit")
    assert.match(email.transcript, /I want a person/)
    assert.doesNotMatch(JSON.stringify([...f.records.values(), ...f.filed, ...f.emails.values(), ...f.notifications.values()]), /\$300/)
    assert.deepEqual(f.log, ["assistant.handoff-request", "assistant.handoff", "assistant.handoff-complete"])
  }
})

test("phone-only, email-only, and absent contact preserve honest partial intake", async () => {
  for (const [message, expectedPhone, expectedEmail, leadCount] of [
    ["Call 615-555-0199", caller, undefined, 1],
    ["Use ava@example.com", null, "ava@example.com", 1],
    ["I need a human", null, undefined, 0],
    ["Call the shop at 615-703-3296", null, undefined, 0],
  ]) {
    const f = fixture()
    await f.deliverAssistantHandoff(request({ message }))
    assert.equal(f.filed.length, leadCount)
    assert.equal(f.emails.size, 1, "handoffs without contact still reach the shop")
    if (leadCount) {
      assert.equal(f.filed[0].fields.callback_phone, expectedPhone)
      assert.equal(f.filed[0].fields.email, expectedEmail)
      assert.equal(f.filed[0].fields.name, null, "no invented customer name")
    }
  }
})

test("different reasons send their own transcript snapshot but keep one intake and crew lead alert", async () => {
  const f = fixture()
  await f.deliverAssistantHandoff(request())
  await f.deliverAssistantHandoff(request({ reason: "unknown", message: "Can you finish tomorrow?" }))
  assert.equal(f.emails.size, 2)
  assert.equal(f.filed.length, 1)
  assert.equal(f.notifications.size, 3)
})

test("later contact supplements the original handoff in the inbox and shop phone without changing its receipt", async () => {
  const f = fixture()
  await f.deliverAssistantHandoff(request({ reason: "unknown", message: "Do you weld aluminum boat ladders?" }))
  assert.equal(f.emails.size, 1)
  assert.equal(f.notifications.size, 1)
  assert.equal(f.filed.length, 0)
  const firstEmail = copy([...f.emails.values()][0])
  await f.deliverAssistantHandoff(request({ reason: "unknown", turnIndex: 1, message: "Call 615-555-0199 or ava@example.com" }))
  assert.equal(f.filed.length, 1)
  assert.equal(f.filed[0].fields.callback_phone, caller)
  assert.equal(f.filed[0].fields.email, "ava@example.com")
  assert.equal(f.notifications.size, 3, "later contact adds a supplemental handoff plus the existing assistant-lead alert")
  assert.equal(f.sms.size, 0)
  assert.equal(f.emails.size, 2, "later contact reaches the inbox as a new immutable turn snapshot")
  assert.match([...f.emails.values()][1].transcript, /ava@example.com/)
  assert.equal(f.phoneAlerts.size, 2)
  assert.deepEqual([...f.emails.values()][0], firstEmail, "the original email transcript stays immutable")
})

test("later callback contact is filed while the original transcript keeps its immutable receipt association", async () => {
  const f = fixture({ emailConfigured: false })
  await f.deliverAssistantHandoff(request({ message: "I want a human" }))
  assert.equal(f.filed.length, 0)
  await f.deliverAssistantHandoff(request({ turnIndex: 1, message: "I want a human. Call 615-555-0199" }))
  assert.equal(f.filed.length, 1)
  f.setEmailConfigured(true)
  await f.recoverAssistantHandoffs()
  const sent = [...f.emails.values()][0]
  assert.equal(sent.leadId, null, "email fence refers to the original immutable handoff event")
  assert.match(sent.transcript, /I want a human/)
  assert.equal(f.emails.size, 2)
})

test("qualified leads and every handoff use the existing owner phone SMS path independently of push or email", async () => {
  for (const reason of ["lead", "human", "unknown", "model-error", "rate-limit", "unavailable"]) {
    const f = fixture({ leadId: 41 })
    await f.deliverAssistantHandoff(request({ reason }))
    await f.deliverAssistantHandoff(request({ reason }))
    assert.equal(f.emails.size, 1)
    assert.equal(f.phoneAlerts.size, 1)
    const alert = [...f.phoneAlerts.values()][0]
    assert.equal(alert.capExempt, true)
    assert.equal(alert.quietHoursExempt, true)
    assert.match(alert.url, /\/ops\/leads\/41/)
    assert.doesNotMatch(alert.body, /\$300/)
  }
  const testLead = fixture({ isTest: true })
  await testLead.deliverAssistantHandoff(request({ reason: "lead" }))
  assert.equal(testLead.phoneAlerts.size, 0)
})

test("unavailable, failed and ambiguous transcript email alerts the shop phone with the saved conversation", async () => {
  for (const status of ["unavailable", "failed", "unknown"]) {
    const f = fixture({ emailStatus: status, emailConfigured: status !== "unavailable" })
    await f.deliverAssistantHandoff(request())
    await f.deliverAssistantHandoff(request())
    assert.equal(f.phoneAlerts.size, 2, "normal handoff and one deduped delivery problem alert")
    const alert = f.phoneAlerts.get(`assistant-handoff:${id}:human:email-status`)
    assert.match(alert.body, new RegExp(status))
    assert.match(alert.body, /Sales@musiccityspecialtywelding.com/)
    assert.match(alert.url, /\/ops\/leads\/41/)
  }
})

test("a missing owner phone recipient keeps the handoff outbox incomplete for recovery", async () => {
  const f = fixture({ ownerConfigured: false })
  await assert.rejects(f.deliverAssistantHandoff(request()), /shop phone recipient is not configured/)
  assert.equal(f.emails.size, 1)
  assert.equal(f.records.has(`assistant.handoff-complete:assistant-handoff:${id}:human`), false)
  assert.equal((await f.recoverAssistantHandoffs()).failed, 1)
})

test("input, transcript and sticky session/turn test markers persist test partials without notify or email", async () => {
  for (const setup of [{ isTest: true }, { input: { isTest: true } }, { input: { message: "[INTERNAL TEST] Call 615-555-0199" } },
    { turns: [{ turn_index: 0, inbound: "[INTERNAL TEST] Call 615-555-0199", result: null, response: null }] }]) {
    const f = fixture(setup)
    await f.deliverAssistantHandoff(request(setup.input))
    assert.equal(f.filed.length, 1)
    assert.equal(f.filed[0].isTest, true)
    assert.equal(f.notifications.size, 0)
    assert.equal(f.emails.size, 0)
    assert.equal(f.records.size, 2)
    for (const record of f.records.values()) assert.equal(record.detail.isTest, true)
  }
})

test("targeted idle recovery files only the selected test session and never performs outbound work", async () => {
  const f = fixture({ isTest: true, turns: [{ turn_index: 0, inbound: "[INTERNAL TEST] test@example.com", result: null, response: null }] })
  assert.deepEqual(copy(await f.recoverAssistantHandoffs()), { recovered: 0, idle: 0, failed: 0 })
  assert.deepEqual(copy(await f.recoverAssistantHandoffs(1, "226e8815-0502-4f7d-94a5-0df870ac6b46")), { recovered: 0, idle: 0, failed: 0 })
  assert.deepEqual(copy(await f.recoverAssistantHandoffs(1, id)), { recovered: 0, idle: 1, failed: 0 })
  assert.equal(f.filed.length, 1)
  assert.equal(f.filed[0].fields.email, "test@example.com")
  assert.equal(f.filed[0].isTest, true)
  assert.equal(f.emails.size, 0)
  assert.equal(f.notifications.size, 0)
  assert.equal(f.sms.size, 0)
  assert.equal(f.session.is_test, true)
})

test("a new or inherited test marker cannot relabel or contact an existing real linked lead", async () => {
  for (const setup of [{ input: { isTest: true } }, { turns: [{ turn_index: 0, inbound: "[INTERNAL TEST] Call 615-555-0199", result: null, response: null }] }]) {
    const f = fixture({ leadId: 41, ...setup })
    assert.equal((await f.deliverAssistantHandoff(request(setup.input))).leadId, 41)
    assert.equal(f.session.is_test, false)
    assert.equal(f.records.size, 0)
    assert.equal(f.filed.length, 0)
    assert.equal(f.emails.size, 0)
    assert.equal(f.notifications.size, 0)
    assert.equal(f.sms.size, 0)
  }
})

test("an idle callback phone or email is leased, filed and sent through the same path once", async () => {
  for (const inbound of ["Call 615-555-0199", "ava@example.com"]) {
    const f = fixture({ turns: [{ turn_index: 0, inbound, result: null, response: null }] })
    assert.deepEqual(copy(await f.recoverAssistantHandoffs()), { recovered: 0, idle: 1, failed: 0 })
    assert.equal(f.filed.length, 1)
    assert.equal(f.emails.size, 1)
    assert.ok(f.emails.has(`${id}:idle-1`))
    assert.equal(f.lease(), null)
    assert.deepEqual(copy(await f.recoverAssistantHandoffs()), { recovered: 0, idle: 0, failed: 0 })
    assert.equal(f.filed.length, 1)
  }
})

test("idle recovery skips an active writer, missing contact, and test sessions", async () => {
  for (const options of [{ busy: true }, { isTest: true }, { turns: [{ turn_index: 0, inbound: "Need welding", result: null, response: null }] }]) {
    const f = fixture({ turns: [{ turn_index: 0, inbound: "Call 615-555-0199", result: null, response: null }], ...options })
    const result = await f.recoverAssistantHandoffs()
    assert.equal(result.idle, 0)
    assert.equal(f.filed.length, 0)
    assert.equal(f.emails.size, 0)
    assert.equal(f.lease(), null)
  }
})

test("handoff request survives interrupted intake and later provider configuration", async () => {
  const f = fixture({ failFile: true, emailConfigured: false })
  await assert.rejects(f.deliverAssistantHandoff(request()), /intake unavailable/)
  assert.equal(f.records.size, 1, "request survives before failed intake")
  await f.recoverAssistantHandoffs()
  assert.equal(f.filed.length, 1)
  assert.equal(f.emails.size, 0)
  f.setEmailConfigured(true)
  await f.recoverAssistantHandoffs()
  assert.equal(f.emails.size, 1)
  assert.equal(f.filed.length, 1)
  assert.equal(f.notifications.size, 2)
})

test("flags off skip recovery before any assistant table access", async () => {
  const f = fixture()
  f.env.NEXT_PUBLIC_ASSISTANT_CHAT = "0"
  f.env.ASSISTANT_VOICE = "0"
  assert.deepEqual(copy(await f.recoverAssistantHandoffs()), { recovered: 0, idle: 0, failed: 0 })
  assert.equal(f.queries.length, 0)
})

test("rate-limited traffic only persists an outbox item until bounded recovery", async () => {
  const f = fixture()
  await f.deliverAssistantHandoff(request({ reason: "rate-limit", deferDelivery: true }))
  assert.equal(f.records.size, 1)
  assert.equal(f.filed.length, 0)
  assert.equal(f.emails.size, 0)
  assert.equal(f.notifications.size, 0)
  assert.equal((await f.recoverAssistantHandoffs()).recovered, 1)
  assert.equal(f.emails.size, 1)
  assert.equal(f.filed.length, 1)
})

test("accepted email does not hide failed notification projection from recovery", async () => {
  const f = fixture({ failNotify: true })
  await assert.rejects(f.deliverAssistantHandoff(request()), /notification unavailable/)
  assert.equal(f.emails.size, 1)
  assert.equal(f.records.has(`assistant.handoff-complete:assistant-handoff:${id}:human`), false)
  assert.equal((await f.recoverAssistantHandoffs()).recovered, 1)
  assert.equal(f.emails.size, 1)
  assert.equal(f.notifications.size, 2)
  assert.ok(f.records.has(`assistant.handoff-complete:assistant-handoff:${id}:human`))
})

test("one failed recovery item cannot starve the next customer", async () => {
  const f = fixture({ failFile: true })
  await f.deliverAssistantHandoff(request({ deferDelivery: true }))
  await f.deliverAssistantHandoff(request({ reason: "unknown", deferDelivery: true }))
  const result = await f.recoverAssistantHandoffs()
  assert.equal(result.failed, 1)
  assert.equal(result.recovered, 1)
  assert.ok(f.emails.has(`${id}:unknown`))
})

test("voice no-answer sends full call and assistant transcript and one persisted SMS identity per CallSid", async () => {
  const f = fixture({ leadId: 41, transcript: "Customer: The gate is 48 inches and budget $500.", turns: [
    { turn_index: 0, inbound: "Ava needs gate repair", result: { fields: fields({ name: "Ava", need: "gate repair" }), reply: "What material?" }, response: null },
  ] })
  await f.finishAssistantVoiceHandoff({ callSid: sid, from: caller, isTest: false })
  await f.finishAssistantVoiceHandoff({ callSid: sid, from: caller, isTest: false })
  assert.equal(f.sms.size, 1)
  const sms = f.sms.get(`assistant-no-answer:${sid}`)
  assert.equal(sms.to, caller)
  assert.equal(sms.leadId, 41)
  assert.match(sms.body, /\(615\) 703-3296/)
  assert.match(sms.body, /Sales@musiccityspecialtywelding\.com/)
  assert.equal(f.emails.size, 1)
  assert.match([...f.emails.values()][0].transcript, /Ava needs gate repair/)
  assert.match([...f.emails.values()][0].transcript, /48 inches/)
  assert.doesNotMatch([...f.emails.values()][0].transcript, /\$500/)
})

test("voice no-answer tests and disabled flag never text or email; private caller still reaches shop journal", async () => {
  for (const setup of [{ voiceTest: true }, { isTest: true }, { inputTest: true }, { flag: "0" }, { transcript: "[INTERNAL TEST] repair gate" }]) {
    const f = fixture(setup)
    if (setup.flag) f.env.ASSISTANT_VOICE = setup.flag
    await f.finishAssistantVoiceHandoff({ callSid: sid, from: caller, isTest: setup.inputTest === true })
    assert.equal(f.sms.size, 0)
    assert.equal(f.emails.size, 0)
    assert.equal(f.notifications.size, 0)
  }
  const f = fixture({ callback: "anonymous", transcript: "Please fix the gate" })
  await f.finishAssistantVoiceHandoff({ callSid: sid, from: "anonymous", isTest: false })
  assert.equal(f.sms.size, 0)
  assert.equal(f.emails.size, 1)
})

test("voice human request records exact speech and verified callback without a model", async () => {
  const f = fixture()
  await f.recordAssistantVoiceHandoff({ callSid: sid, from: caller, turnIndex: 0,
    message: "I want a person about my trailer", reason: "human", isTest: false })
  assert.equal(f.filed.length, 1)
  assert.equal(f.filed[0].fields.callback_phone, caller)
  assert.match([...f.emails.values()][0].transcript, /I want a person about my trailer/)
})

test("voice human test handoff journals the reason and keeps intake in the test partition", async () => {
  for (const setup of [{ inputTest: true }, { voiceTest: true }, { message: "[INTERNAL TEST] I want a person" }]) {
    const f = fixture(setup)
    await f.recordAssistantVoiceHandoff({ callSid: sid, from: caller, turnIndex: 0,
      message: setup.message ?? "I want a person", reason: "human", isTest: setup.inputTest === true })
    assert.equal(f.filed.length, 1)
    assert.equal(f.filed[0].isTest, true)
    assert.equal(f.records.get(`assistant.handoff:assistant-handoff:${id}:human`).detail.isTest, true)
    assert.equal(f.emails.size, 0)
    assert.equal(f.notifications.size, 0)
    assert.equal(f.sms.size, 0)
  }
})
