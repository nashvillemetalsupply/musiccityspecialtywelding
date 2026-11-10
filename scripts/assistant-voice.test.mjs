import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import ts from "typescript"

const root = new URL("../", import.meta.url)
const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true })
const twilioUrl = new URL("lib/twilio.ts", root)
const twilioSource = ts.transpileModule(readFileSync(twilioUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
let dependencyLoads = 0
let routeFixture
globalThis.__assistantVoiceDependencies = async () => {
  dependencyLoads++
  return { deps: routeFixture.deps, isTest: routeFixture.isTest, from: routeFixture.from }
}
globalThis.__assistantVoiceAfter = (fn) => routeFixture.background.push(fn)
globalThis.__assistantVoiceRecordHandoff = async (value) => routeFixture.handoffs.push(copy(value))
globalThis.__assistantVoiceFinishHandoff = async (value) => routeFixture.finishedHandoffs.push(copy(value))
globalThis.__assistantVoiceRecover = async (...values) => routeFixture.recoveries.push(copy(values))
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return stub("export const after = (...args) => globalThis.__assistantVoiceAfter(...args);")
    if (specifier.endsWith("/handoff.ts")) return stub("export const recordAssistantVoiceHandoff = (...args) => globalThis.__assistantVoiceRecordHandoff(...args); export const finishAssistantVoiceHandoff = (...args) => globalThis.__assistantVoiceFinishHandoff(...args); export const recoverAssistantHandoffs = (...args) => globalThis.__assistantVoiceRecover(...args);")
    if (specifier.endsWith("/voice-store.ts")) return stub("export const voiceDependencies = (...args) => globalThis.__assistantVoiceDependencies(...args);")
    if (new URL(specifier, context.parentURL ?? root).href === new URL("lib/ai.ts", root).href) return stub("export const jsonWithClaude = (input) => globalThis.__assistantVoiceModel(input);")
    if (specifier === "@/lib/shop-contact") return stub('export const getShopPhone = () => ({display:"(615) 703-3296",href:"tel:+16157033296"});')
    if (specifier.startsWith("@/lib/assistant/")) return { url: new URL(specifier.slice(2), root).href, shortCircuit: true }
    if (new URL(specifier, context.parentURL ?? root).href === new URL("lib/db.ts", root).href) return stub("export const getSql = () => globalThis.__assistantVoiceSql;")
    if (specifier === "@/lib/twilio" || specifier === "@/lib/twilio.ts" || new URL(specifier, context.parentURL ?? root).href === twilioUrl.href) return stub(twilioSource)
    return nextResolve(specifier, context)
  },
})
const {
  voiceSessionId, voiceCallbackPhone, voiceGather, voiceHandoff, voiceFallback, processVoiceTurn,
} = await import("../lib/assistant/voice.ts")
const { POST } = await import("../app/api/twilio/assist-voice/route.ts")
const { PostgresAssistantStore } = await import("../lib/assistant/store.ts")
const { handleAssistantTurn } = await import("../lib/assistant/turn.ts")

const testEnv = {
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "assistant-voice-fixture-token",
  TWILIO_PHONE_NUMBER: "+16155550100",
  OWNER_CELL_PHONE: "+16155550141",
  TWILIO_WEBHOOK_BASE_URL: "https://voice.example.test",
  ASSISTANT_VOICE: "1",
}
const previousEnv = Object.fromEntries(Object.keys(testEnv).map((name) => [name, process.env[name]]))
Object.assign(process.env, testEnv)
after(() => {
  hooks.deregister()
  delete globalThis.__assistantVoiceDependencies
  delete globalThis.__assistantVoiceSql
  delete globalThis.__assistantVoiceAfter
  delete globalThis.__assistantVoiceRecordHandoff
  delete globalThis.__assistantVoiceFinishHandoff
  delete globalThis.__assistantVoiceRecover
  delete globalThis.__assistantVoiceModel
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const callSid = `CA${"b".repeat(32)}`
const customer = "+16155550199"
const blankFields = () => ({
  name: null, callback_phone: null, need: "", material_size: null,
  location: null, timing: null, is_job: "unsure",
})
const completeFields = () => ({
  ...blankFields(), name: "Ava", callback_phone: "+16155550888", need: "gate repair", is_job: "yes",
})
const input = (overrides = {}) => ({ callSid, turnIndex: 0, speech: "Need gate repair.", from: customer, isTest: false, ...overrides })
const copy = (value) => structuredClone(value)

class MemoryStore {
  session = { id: voiceSessionId(callSid), next_turn: 0, is_test: false, lead_id: null }
  turns = new Map()
  log = []
  active = false
  token = 0
  async begin(value) {
    const prior = this.turns.get(value.turn_index)
    if (prior && prior.inbound !== value.message) throw new Error("Changed replay")
    if (prior?.response) return copy(prior.response)
    if (this.active || value.turn_index !== this.session.next_turn) throw new Error("Conflicting turn")
    this.session.id = value.session_id
    this.session.is_test ||= value.is_test
    this.active = true
    this.token++
    if (!prior) {
      this.log.push("persist-inbound")
      this.turns.set(value.turn_index, { inbound: value.message, result: null, response: null, lead_captured: false })
    }
    return { session: copy(this.session), turn: copy(this.turns.get(value.turn_index)), token: this.token }
  }
  async history(_id, index) {
    return [...this.turns.entries()].filter(([i]) => i <= index).flatMap(([, turn]) => [
      { role: "user", content: turn.inbound },
      ...(turn.response ? [{ role: "assistant", content: turn.response.reply }] : []),
    ])
  }
  async verifyLease(claim) { assert.ok(this.active && this.token === claim.token) }
  async saveModel(claim, index, value) {
    await this.verifyLease(claim)
    this.log.push("persist-model")
    this.turns.get(index).result = copy(value)
  }
  async saveLead(claim, index, id) {
    await this.verifyLease(claim)
    this.session.lead_id = id
    this.turns.get(index).lead_captured = true
  }
  async finish(claim, index, response) {
    await this.verifyLease(claim)
    this.turns.get(index).response = copy(response)
    this.session.next_turn++
    this.active = false
  }
  async release(claim) { if (this.token === claim.token) this.active = false }
}

function fixture() {
  const store = new MemoryStore()
  const leads = []
  const receipts = []
  const notifications = []
  const models = []
  const deliveries = []
  const background = []
  const handoffs = []
  const finishedHandoffs = []
  const recoveries = []
  const deps = {
    store, phone: { display: "(615) 703-3296", href: "tel:+16157033296" },
    rateLimit: async () => false, fingerprint: (value) => `fixture-${value}`,
    model: async (messages, options) => {
      assert.ok(store.turns.size, "speech is durable before calling the model")
      assert.equal(store.log.at(-1), "persist-inbound")
      models.push({ messages: copy(messages), options })
      return { reply: "What material is it?", fields: completeFields() }
    },
    validPhone: voiceCallbackPhone,
    handoff: async (value) => { deliveries.push(copy(value)); return { leadId: value.leadId } },
    fileLead: async (value) => {
      assert.ok(store.log.includes("persist-model"), "model result precedes lead filing")
      leads.push(copy(value))
      return { leadId: 41, isTest: value.isTest }
    },
    receipt: async (value) => { receipts.push(copy(value)); return 201 },
    notify: async (value) => {
      assert.ok(receipts.length, "immutable receipt precedes notification")
      notifications.push(copy(value))
    },
  }
  return { store, leads, receipts, notifications, models, deliveries, background, handoffs, finishedHandoffs, recoveries, deps, isTest: false, from: customer }
}

async function flushVoiceBackground() {
  while (routeFixture.background.length) await routeFixture.background.shift()()
}

function request(path = "", values = {}, signature = "valid") {
  const url = `${testEnv.TWILIO_WEBHOOK_BASE_URL}/api/twilio/assist-voice${path}`
  const params = new URLSearchParams({ CallSid: callSid, From: customer, To: testEnv.TWILIO_PHONE_NUMBER, ...values })
  let payload = url
  for (const key of [...new Set(params.keys())].sort()) {
    for (const value of params.getAll(key).sort()) payload += `${key}${value}`
  }
  const headers = { "Content-Type": "application/x-www-form-urlencoded" }
  if (signature !== null) headers["x-twilio-signature"] = signature === "valid"
    ? createHmac("sha1", testEnv.TWILIO_AUTH_TOKEN).update(payload).digest("base64") : signature
  return new Request(url, { method: "POST", headers, body: params })
}

// Validate the XML subset emitted by TwiML: complete nesting, quoted attributes,
// escaped text/entities, and the XML character range. No extra parser dependency.
function assertXml(xml) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  const body = xml.replace(/^<\?xml[^?]*\?>/, "")
  assert.doesNotMatch(body, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)
  const stack = []
  let rootCount = 0
  let last = 0
  const text = (value) => {
    assert.doesNotMatch(value, /[<>]/)
    assert.doesNotMatch(value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, ""), /&/)
  }
  for (const match of body.matchAll(/<\/?[A-Za-z][^<>]*>/g)) {
    text(body.slice(last, match.index))
    const tag = match[0]
    const name = tag.match(/^<\/?([A-Za-z][A-Za-z0-9]*)/)[1]
    if (tag.startsWith("</")) {
      assert.equal(tag, `</${name}>`)
      assert.equal(stack.pop(), name)
    } else {
      if (!stack.length) rootCount++
      const attributes = tag.slice(name.length + 1).replace(/\/?\s*>$/, "")
      let consumed = ""
      for (const attribute of attributes.matchAll(/\s+[A-Za-z][A-Za-z0-9]*="([^"<>]*)"/g)) {
        consumed += attribute[0]
        text(attribute[1])
      }
      assert.equal(consumed, attributes)
      if (!tag.endsWith("/>")) stack.push(name)
    }
    last = match.index + tag.length
  }
  text(body.slice(last))
  assert.equal(stack.length, 0)
  assert.equal(rootCount, 1)
  assert.match(body, /^<Response>[\s\S]*<\/Response>$/)
}

test("CallSid maps durably to a separate UUID namespace and caller callbacks exclude routing numbers", () => {
  const id = voiceSessionId(callSid)
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[58][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(voiceSessionId(callSid), id)
  assert.notEqual(voiceSessionId(`CA${"c".repeat(32)}`), id)
  assert.equal(voiceCallbackPhone("(615) 555-0199"), customer)
  for (const number of ["anonymous", "restricted", "+442071234567", "+11111111111", "+16157033296", "+16158104910", testEnv.TWILIO_PHONE_NUMBER, testEnv.OWNER_CELL_PHONE]) {
    assert.equal(voiceCallbackPhone(number), "", number)
  }
  for (const name of ["NEXT_PUBLIC_TWILIO_PHONE_NUMBER_GOOGLE", "NEXT_PUBLIC_TWILIO_PHONE_NUMBER_FACEBOOK", "TWILIO_PHONE_NUMBER_LD2R", "TWILIO_PHONE_NUMBER_GREASE", "TWILIO_PHONE_NUMBER_RAILING"]) {
    const prior = process.env[name]
    try {
      process.env[name] = "+16155550888"
      assert.equal(voiceCallbackPhone("615-555-0888"), "", name)
    } finally {
      if (prior === undefined) delete process.env[name]
      else process.env[name] = prior
    }
  }
})

test("voice store fences test upgrades against the shared call intake key before persisting a changed partition", async () => {
  const queries = []
  const sessionId = voiceSessionId(callSid)
  globalThis.__assistantVoiceSql = async (strings, ...values) => {
    const sql = strings.join(" ? ").replace(/\s+/g, " ").trim()
    queries.push({ sql, values })
    for (let i = 1; i < strings.length; i++) assert.match(strings[i], /^::\w+/, "every SQL interpolation has a Postgres cast")
    if (sql.startsWith("INSERT INTO assistant_sessions")) return []
    if (sql.startsWith("SELECT id, next_turn, is_test, lead_id")) return [{ id: sessionId, next_turn: 0, is_test: false, lead_id: null }]
    if (sql.startsWith("SELECT inbound, result, response, lead_captured")) return []
    if (sql.startsWith("UPDATE assistant_sessions SET lease_token")) {
      assert.ok(values.includes(`call:${callSid}`), "real lead guard uses the voice/operator shared key")
      assert.ok(!values.includes(`assistant:${sessionId}`))
      assert.match(sql, /OR id = assistant_sessions\.lead_id/)
      assert.match(sql, /AND is_test = false/)
      return [] // Existing real call-key lead denies changing the test partition.
    }
    throw new Error(`Unexpected query: ${sql}`)
  }
  await assert.rejects(new PostgresAssistantStore(`call:${callSid}`).begin({
    session_id: sessionId, turn_index: 0, message: "[INTERNAL TEST] Need gate repair", is_test: true,
  }), { status: 409 })
  assert.ok(!queries.some(({ sql }) => sql.startsWith("INSERT INTO assistant_turns")))
})

test("voice endpoint rejects missing, invalid, or URL-tampered Twilio signatures before work", async () => {
  routeFixture = fixture()
  const before = dependencyLoads
  for (const signature of [null, "invalid"]) assert.equal((await POST(request("?turn=0", { SpeechResult: "Need welding" }, signature))).status, 403)
  const signed = request("?turn=0", { SpeechResult: "Need welding" })
  const tampered = new Request(`${signed.url}&turn=1`, { method: "POST", headers: signed.headers, body: await signed.text() })
  assert.equal((await POST(tampered)).status, 403)
  assert.equal(dependencyLoads, before)
  assert.equal(routeFixture.models.length, 0)
})

test("flag-off voice endpoint hands off to existing fallback without loading model or store", async () => {
  routeFixture = fixture()
  const before = dependencyLoads
  try {
    for (const value of [undefined, "0", "true"]) {
      if (value === undefined) delete process.env.ASSISTANT_VOICE
      else process.env.ASSISTANT_VOICE = value
      const response = await POST(request("?turn=0", { SpeechResult: "Ava needs gate repair" }))
      assert.equal(response.status, 200)
      const xml = await response.text()
      assert.match(xml, /<Redirect[^>]*>https:\/\/voice\.example\.test\/api\/twilio\/fallback<\/Redirect>/)
      assertXml(xml)
    }
  } finally { process.env.ASSISTANT_VOICE = "1" }
  assert.equal(dependencyLoads, before)
  assert.equal(routeFixture.models.length, 0)
  assert.equal(routeFixture.background.length, 0)
})

test("first Gather discloses automation and saved answers without claiming an audio recording", async () => {
  const response = await POST(request())
  const xml = await response.text()
  assertXml(xml)
  assert.match(xml, /automated assistant.*Music City Specialty Welding/i)
  assert.match(xml, /answers.*(?:saved|save)|(?:saved|save).*answers/i)
  assert.doesNotMatch(xml, /call is (?:being )?recorded|<Record\b|record="/i)
  assert.match(xml, /<Gather[^>]*input="speech dtmf"/)
  assert.match(xml, /numDigits="1"/)
  assert.match(xml, /(?:say|Say) (?:person|&apos;person&apos;)|person/)
  assert.match(xml, /What needs welding|What.*(?:weld|repair)/i)
})

test("person, human, operator and zero immediately Dial the same shop target at any turn", async () => {
  routeFixture = fixture()
  const before = dependencyLoads
  for (const values of [{ SpeechResult: "I want a person" }, { SpeechResult: "Human please" }, { SpeechResult: "Operator" }, { Digits: "0" }]) {
    const response = await POST(request("?turn=12", values))
    const xml = await response.text()
    assertXml(xml)
    assert.match(xml, /<Dial\b/)
    assert.match(xml, /\+16155550141/)
    assert.match(xml, /assist-voice\?handoff=1/)
    assert.doesNotMatch(xml, /<Gather/)
    assert.equal(routeFixture.handoffs.length, 0, "Dial returns before background persistence")
    assert.equal(routeFixture.background.length, 1)
    await flushVoiceBackground()
    const saved = routeFixture.handoffs.pop()
    assert.deepEqual(saved, {
      callSid, from: customer, turnIndex: 12, reason: "human", isTest: false,
      message: values.SpeechResult ?? "Pressed zero to reach a person.",
    })
  }
  assert.equal(dependencyLoads, before)
  assert.equal(routeFixture.models.length, 0)
})

test("immediate signed human handoffs preserve test metadata without loading the model", async () => {
  routeFixture = fixture()
  const before = dependencyLoads
  const response = await POST(request("?turn=2", { SpeechResult: "Person please", CallerName: "[INTERNAL TEST] Ava" }))
  assert.match(await response.text(), /<Dial/)
  assert.equal(routeFixture.handoffs.length, 0)
  await flushVoiceBackground()
  assert.equal(routeFixture.handoffs[0].isTest, true)
  assert.equal(routeFixture.handoffs[0].message, "Person please")
  assert.equal(dependencyLoads, before)
})

test("synthetic call IDs require a signed marked internal test and retain the human handoff reason", async () => {
  const synthetic = `CA_INTERNAL_TEST_${"c".repeat(32)}`
  for (const marker of [{ CallerName: "[INTERNAL TEST]" }, { SpeechResult: "[INTERNAL TEST] I want a person" }]) {
    routeFixture = fixture()
    const response = await POST(request("?turn=0", { CallSid: synthetic, SpeechResult: "I want a person", ...marker }))
    assert.equal(response.status, 200)
    assert.match(await response.text(), /<Dial/)
    await flushVoiceBackground()
    assert.equal(routeFixture.handoffs[0].callSid, synthetic)
    assert.equal(routeFixture.handoffs[0].isTest, true)
    assert.equal(routeFixture.handoffs[0].reason, "human")
    assert.equal(routeFixture.models.length, 0)
  }
  for (const [values, signature, status] of [
    [{ CallSid: synthetic, SpeechResult: "person" }, "valid", 400],
    [{ CallSid: "CA_INTERNAL_TEST_bad", CallerName: "[INTERNAL TEST]" }, "valid", 400],
    [{ CallSid: synthetic, CallerName: "[INTERNAL TEST]" }, "invalid", 403],
  ]) {
    routeFixture = fixture()
    assert.equal((await POST(request("?turn=0", values, signature))).status, status)
    assert.equal(routeFixture.background.length, 0)
  }
})

test("handoff preserves the optional whisper and missed handoffs use fallback without assistant recursion", async () => {
  routeFixture = fixture()
  const previous = process.env.TWILIO_INBOUND_WHISPER_URL
  try {
    process.env.TWILIO_INBOUND_WHISPER_URL = `https://handler.twilio.com/twiml/EH${"d".repeat(32)}`
    assert.match(await voiceHandoff().text(), /<Number method="GET" url="https:\/\/handler\.twilio\.com\/twiml\/EHd+">\+16155550141<\/Number>/)
  } finally {
    if (previous === undefined) delete process.env.TWILIO_INBOUND_WHISPER_URL
    else process.env.TWILIO_INBOUND_WHISPER_URL = previous
  }
  for (const status of ["no-answer", "busy", "failed", "canceled"]) {
    const xml = await (await POST(request("?handoff=1", { DialCallStatus: status }))).text()
    assert.match(xml, /\/api\/twilio\/fallback/)
    assert.doesNotMatch(xml, /<Gather|<Dial/)
    assert.equal(routeFixture.background.length, 1)
    assert.equal(routeFixture.finishedHandoffs.length, 0)
    await flushVoiceBackground()
    assert.deepEqual(routeFixture.finishedHandoffs.pop(), { callSid, from: customer, isTest: false })
  }
  for (const status of ["answered", "completed"]) {
    const xml = await (await POST(request("?handoff=1", { DialCallStatus: status }))).text()
    assert.doesNotMatch(xml, /<Gather|<Dial|<Redirect/)
    assert.equal(routeFixture.background.length, 1, "answered inline Dial still preserves the assistant transcript")
    await flushVoiceBackground()
    assert.equal(routeFixture.handoffs.at(-1).reason, "unknown")
    assert.equal(routeFixture.handoffs.at(-1).turnIndex, 30)
  }
})

test("Spanish requests for a person Dial immediately without invoking the model", async () => {
  routeFixture = fixture()
  for (const speech of ["Quiero hablar con una persona", "Necesito hablar con alguien de la tienda", "Un humano por favor"]) {
    const response = await POST(request("?turn=0", { SpeechResult: speech }))
    assert.match(await response.text(), /<Dial\b/)
    await flushVoiceBackground()
    assert.equal(routeFixture.handoffs.at(-1).reason, "human")
  }
  assert.equal(routeFixture.models.length, 0)
})

test("voice provider delivery and photo followup run after TwiML from a durable receipt", async () => {
  routeFixture = fixture()
  let photoCalls = 0
  routeFixture.deps.followUpLead = async () => {
    assert.equal(routeFixture.receipts.length, 1)
    photoCalls++
  }
  const response = await POST(request("?turn=0", { SpeechResult: "Need gate repair" }))
  assert.equal(response.status, 200)
  assert.match(await response.text(), /<Gather\b/)
  assert.equal(photoCalls, 0)
  assert.equal(routeFixture.recoveries.length, 0)
  assert.equal(routeFixture.background.length, 2)
  await flushVoiceBackground()
  assert.equal(photoCalls, 1)
  assert.deepEqual(routeFixture.recoveries, [[5, voiceSessionId(callSid)]])
})

test("missed handoff callback passes test context; flag-off and invalid signatures schedule nothing", async () => {
  routeFixture = fixture()
  await POST(request("?handoff=1", { DialCallStatus: "no-answer", CallerName: "[INTERNAL TEST]" }))
  await flushVoiceBackground()
  assert.equal(routeFixture.finishedHandoffs[0].isTest, true)
  for (const signature of [null, "invalid"]) {
    const response = await POST(request("?handoff=1", { DialCallStatus: "no-answer" }, signature))
    assert.equal(response.status, 403)
    assert.equal(routeFixture.background.length, 0)
  }
  try {
    for (const flag of [undefined, "0", "true"]) {
      if (flag === undefined) delete process.env.ASSISTANT_VOICE
      else process.env.ASSISTANT_VOICE = flag
      const response = await POST(request("?handoff=1", { DialCallStatus: "no-answer" }))
      assert.match(await response.text(), /\/api\/twilio\/fallback/)
      assert.equal(routeFixture.background.length, 0)
    }
  } finally { process.env.ASSISTANT_VOICE = "1" }
})

test("speech is persisted before model and verified From overrides every model callback", async () => {
  const f = fixture()
  const response = await processVoiceTurn(input(), f.deps)
  assert.equal(response.lead_saved, true)
  assert.equal(f.models.length, 1)
  assert.equal(f.models[0].options.voice.callbackPhone, customer)
  assert.ok(f.models[0].options.signal instanceof AbortSignal)
  assert.equal(f.store.turns.get(0).result.fields.callback_phone, customer)
  assert.equal(f.leads[0].fields.callback_phone, customer)
  assert.ok(f.store.log.indexOf("persist-inbound") < f.store.log.indexOf("persist-model"))
})

test("reserved, private and invalid From never become customer callbacks even when model supplies a number", async () => {
  for (const from of ["anonymous", testEnv.OWNER_CELL_PHONE, testEnv.TWILIO_PHONE_NUMBER, "+16157033296"]) {
    const f = fixture()
    const response = await processVoiceTurn(input({ from }), f.deps)
    assert.equal(response.fields.callback_phone, null)
    assert.equal(response.lead_saved, false)
    assert.equal(f.leads.length, 0)
    assert.equal(f.notifications.length, 0)
  }
})

test("signed unknown capability and blocked model promises keep gathering and preserve handoff delivery", async () => {
  for (const [speech, modelReply] of [["Do you weld aluminum boat ladders?", "Yes, we can do it."], ["Need gate repair", "Booked. We will come tomorrow."]]) {
    routeFixture = fixture()
    routeFixture.deps.model = handleAssistantTurn
    globalThis.__assistantVoiceModel = async ({ prompt }) => ({
      reply: prompt.includes("Ava") ? "What time works for a callback?" : modelReply,
      fields: { ...blankFields(), need: speech.includes("ladders") ? "aluminum boat ladders" : "gate repair", is_job: "yes", ...(prompt.includes("Ava") ? { name: "Ava" } : {}) },
    })
    const xml = await (await POST(request("?turn=0", { SpeechResult: speech }))).text()
    assert.match(xml, /^<\?xml[^>]*><Response><Gather\b/)
    assert.match(xml, /A person at the shop will confirm that job\. What name should the shop use\? Say person or press zero/)
    assert.doesNotMatch(xml, /\byes\b|we can|we will|we'll|booked|scheduled|guarantee|available|mailto:|Sales@/i)
    assert.equal(routeFixture.deliveries.length, 1)
    assert.equal(routeFixture.deliveries[0].reason, "unknown")
    assert.equal(routeFixture.deliveries[0].fields.callback_phone, customer)
    assert.equal(routeFixture.store.turns.get(0).response.continue_intake, true)
    assert.equal(await (await POST(request("?turn=0", { SpeechResult: speech }))).text(), xml)
    assert.equal(routeFixture.deliveries.length, 1, "Twilio replay must not duplicate the handoff")
    const nextXml = await (await POST(request("?turn=1", { SpeechResult: "Ava" }))).text()
    assert.match(nextXml, /<Gather\b/)
    assert.equal(routeFixture.leads.length, 1)
    assert.equal(routeFixture.leads[0].fields.callback_phone, customer)
  }
})

test("a complete scripted phone call files exactly one lead and a Twilio retry does no new work", async () => {
  routeFixture = fixture()
  routeFixture.deps.model = async (messages, options) => {
    assert.ok(routeFixture.store.turns.size)
    routeFixture.models.push({ messages, options })
    const latest = messages.at(-1).content
    return { reply: "Where is the job?", fields: latest.includes("Ava") ? completeFields() : { ...blankFields(), need: "gate repair", is_job: "yes" } }
  }
  const first = await POST(request("?turn=0", { SpeechResult: "Need gate repair" }))
  assert.match(await first.text(), /<Gather/)
  assert.equal(routeFixture.leads.length, 0, "the assistant must still collect a name")
  const second = await POST(request("?turn=1", { SpeechResult: "Ava" }))
  const secondXml = await second.text()
  assertXml(secondXml)
  assert.equal(routeFixture.leads.length, 1)
  assert.equal(routeFixture.notifications.length, 1)
  const replay = await POST(request("?turn=1", { SpeechResult: "Ava" }))
  assert.equal(await replay.text(), secondXml)
  assert.equal(routeFixture.models.length, 2)
  assert.equal(routeFixture.leads.length, 1)
  assert.equal(routeFixture.notifications.length, 1)
  await POST(request("?turn=2", { SpeechResult: "Ava in Lebanon" }))
  assert.equal(routeFixture.leads.length, 1)
  assert.equal(routeFixture.receipts.length, 2, "later details remain on the same lead")
})

test("test metadata and spoken INTERNAL TEST markers remain sticky and never notify", async () => {
  for (const options of [{ isTest: true }, { speech: "[INTERNAL TEST] Need gate repair" }]) {
    const f = fixture()
    await processVoiceTurn(input(options), f.deps)
    assert.equal(f.leads[0].isTest, true)
    assert.equal(f.receipts[0].isTest, true)
    assert.equal(f.models[0].options.isTest, true)
    assert.equal(f.notifications.length, 0)
    await processVoiceTurn(input({ turnIndex: 1, speech: "It is in Lebanon" }), f.deps)
    assert.equal(f.receipts.at(-1).isTest, true)
    assert.equal(f.notifications.length, 0)
  }
})

test("model errors and persistence errors speak a short line and Dial instead of throwing", async () => {
  for (const failed of ["model", "store"]) {
    routeFixture = fixture()
    if (failed === "model") routeFixture.deps.model = async () => { throw new Error("Provider secret body") }
    else routeFixture.store.begin = async () => { throw new Error("Database secret body") }
    const response = await POST(request("?turn=0", { SpeechResult: "Need welding" }))
    assert.equal(response.status, 200)
    const xml = await response.text()
    assertXml(xml)
    assert.match(xml, /<Say[^>]*>[^<]+<\/Say>/)
    assert.match(xml, /<Dial/)
    assert.doesNotMatch(xml, /secret body/)
    assert.equal(routeFixture.leads.length, 0)
    if (failed === "model") {
      assert.equal(routeFixture.store.turns.get(0).result.handoff_reason, "model-error")
      assert.equal(routeFixture.deliveries.length, 1)
      assert.equal(routeFixture.deliveries[0].reason, "model-error")
      assert.doesNotMatch(xml, /mailto:|Sales@|tel:/, "chat fallback is intercepted before speech")
    } else {
      assert.equal(routeFixture.background.length, 1)
      await flushVoiceBackground()
      assert.equal(routeFixture.handoffs[0].reason, "model-error")
      assert.equal(routeFixture.handoffs[0].message, "Need welding")
    }
  }
})

test("eight-second model deadline aborts and hands off; a late model result cannot file a lead", async () => {
  routeFixture = fixture()
  let resolveModel
  let signal
  routeFixture.deps.model = (_messages, options) => {
    signal = options.signal
    return new Promise((resolve) => { resolveModel = resolve })
  }
  const started = performance.now()
  const response = await POST(request("?turn=0", { SpeechResult: "Need welding" }))
  const elapsed = performance.now() - started
  assert.ok(elapsed >= 7_500 && elapsed < 11_000, `model budget was ${elapsed}ms`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /<Say[^>]*>[^<]+<\/Say>[\s\S]*<Dial/)
  assert.equal(signal.aborted, true)
  resolveModel({ reply: "What material?", fields: completeFields() })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(routeFixture.leads.length, 0)
  assert.equal(routeFixture.notifications.length, 0)
  assert.equal(routeFixture.store.turns.get(0).result.handoff_reason, "model-error")
  assert.equal(routeFixture.deliveries.length, 1)
  assert.equal(routeFixture.deliveries[0].reason, "model-error")
})

test("TwiML escapes spoken model text, rejects XML controls, and never speaks prices or money placeholders", async () => {
  for (const reply of ['Ava & Jo said "steel" < gate > pipe. What size?', "Repair costs $1,250.50 or five hundred dollars.", "x\u0000 & y"]) {
    const xml = await voiceGather(reply, 2).text()
    assertXml(xml)
    assert.doesNotMatch(xml, /\$1,250|five hundred dollars|owner-only money|\u0000/)
    assert.match(xml, /<Gather/)
    if (reply.startsWith("Ava")) assert.match(xml, /&amp;.*&quot;steel&quot;.*&lt; gate &gt;/)
  }
  assertXml(await voiceFallback().text())
})
