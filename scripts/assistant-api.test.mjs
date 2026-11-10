import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { validateAssistantInput, readAssistantInput } from "../lib/assistant/input.ts"
import { processAssistantTurn } from "../lib/assistant/service.ts"
import { assistantContactReply } from "../lib/assistant/contact.ts"

const sessionId = "126e8815-0502-4f7d-94a5-0df870ac6b46"
const root = new URL("../", import.meta.url)
const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true })
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/lib/assistant/")) return { url: new URL(specifier.slice(2), root).href, shortCircuit: true }
    if (specifier === "@/lib/db" || new URL(specifier, context.parentURL ?? root).href === new URL("lib/db.ts", root).href) return stub("export const getSql = () => globalThis.__assistantSql;")
    if (new URL(specifier, context.parentURL ?? root).href === new URL("lib/ai.ts", root).href) return stub("export const jsonWithClaude = (input) => globalThis.__assistantApiModel(input);")
    if (specifier === "@/lib/shop-contact") return stub('export const getShopPhone = () => ({display:"(615) 703-3296",href:"tel:+16157033296"});')
    if (specifier === "@/lib/call-artifacts") return stub("export const attachRecoveredCallArtifacts = async () => {};")
    if (specifier === "@/lib/build-sheets") return stub("export const ingestCallSketchBuildFacts = async () => {};")
    if (specifier === "@/lib/events") return stub("export const recordEvent = (...args) => globalThis.__assistantRecordEvent(...args);")
    if (specifier === "@/lib/leads") return stub("export const createLead = (...args) => globalThis.__assistantCreateLead(...args);")
    if (specifier === "@/lib/people") return stub(`
      export const normalizePhone = (v) => { const n = v.replace(/\\D/g, "").replace(/^1(?=\\d{10}$)/, ""); return /^[2-9]\\d{2}[2-9]\\d{6}$/.test(n) ? "+1" + n : ""; };
      export const findOrCreatePerson = async () => null;
      export const findOpenLeadResolutionForPerson = async () => ({leadId:null});
      export const isReservedShopPhone = () => false;
    `)
    return nextResolve(specifier, context)
  },
})
const { handleAssistantTurn } = await import("../lib/assistant/turn.ts")
const { PostgresAssistantStore } = await import("../lib/assistant/store.ts")
const { fileAssistantLead } = await import("../lib/job-intake.ts")
hooks.deregister()

const emptyFields = () => ({ name: null, callback_phone: null, need: "gate repair", material_size: null, location: null, timing: null, callback_window: null, is_job: "yes" })
const completeFields = () => ({ ...emptyFields(), name: "Ava", callback_phone: "+16155550199", material_size: "Steel 48 inches", location: "Lebanon", timing: "Next week" })
const completeMessage = "Ava. Call 615-555-0199. Need gate repair. Steel 48 inches. Lebanon. Next week. Budget $300."
const input = (overrides = {}) => validateAssistantInput({ session_id: sessionId, turn_index: 0, message: "Need gate repair.", ...overrides })
const copy = (value) => structuredClone(value)

class MemoryStore {
  session = { id: sessionId, next_turn: 0, is_test: false, lead_id: null }
  turns = new Map()
  active = false
  token = 0
  log = []
  async begin(value) {
    this.log.push("begin")
    const prior = this.turns.get(value.turn_index)
    if (prior && prior.inbound !== value.message) throw Object.assign(new Error("Changed replay"), { status: 409 })
    if (prior?.response) return copy(prior.response)
    if (this.active || value.turn_index !== this.session.next_turn || (this.session.lead_id && value.is_test && !this.session.is_test)) throw Object.assign(new Error("Conflict"), { status: 409 })
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
      { role: "user", content: turn.inbound }, ...(turn.response ? [{ role: "assistant", content: turn.response.reply }] : []),
    ])
  }
  async verifyLease(claim) {
    if (!this.active || this.token !== claim.token) throw Object.assign(new Error("Stale lease"), { status: 409 })
  }
  async saveModel(claim, index, result) { await this.verifyLease(claim); this.log.push("persist-model"); this.turns.get(index).result = copy(result) }
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
  const leads = new Map()
  const receipts = new Map()
  const notifications = new Map()
  let leadCalls = 0
  let modelCalls = 0
  globalThis.__assistantApiModel = async ({ prompt }) => {
    modelCalls++
    assert.ok(store.log.indexOf("persist-inbound") < store.log.indexOf("model"))
    assert.ok(store.turns.size > 0)
    const full = prompt.includes("Ava")
    return { reply: "What material is it?", fields: full ? completeFields() : emptyFields() }
  }
  globalThis.__assistantCreateLead = async (value, options) => {
    leadCalls++
    assert.ok(store.log.includes("persist-model"), "model output is durable before lead creation")
    const existing = leads.get(options.intakeKey)
    if (existing) return { id: existing.id, reused: true, eventId: null }
    const lead = { id: 41, is_test: value.isTest, value: copy(value), options: copy(options) }
    leads.set(options.intakeKey, lead)
    return { id: lead.id, reused: false, eventId: 101 }
  }
  globalThis.__assistantSql = async (strings, ...values) => {
    const query = strings.join(" ? ")
    if (query.includes("SELECT id, is_test FROM leads WHERE intake_key")) {
      const prior = leads.get(values[0])
      return prior ? [{ id: prior.id, is_test: prior.is_test }] : []
    }
    if (query.includes("SELECT id, is_test FROM leads WHERE id")) {
      const lead = [...leads.values()].find((row) => row.id === values[0])
      return lead ? [{ id: lead.id, is_test: lead.is_test }] : []
    }
    throw new Error(`Unexpected fixture SQL: ${query}`)
  }
  const deps = {
    store,
    phone: { display: "(615) 703-3296", href: "tel:+16157033296" },
    rateLimit: async () => false,
    fingerprint: (value) => `hashed-${value}`,
    model: async (...args) => { store.log.push("model"); return handleAssistantTurn(...args) },
    validPhone: (value) => /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(value) && !value.endsWith("6157033296") ? value : "",
    fileLead: fileAssistantLead,
    receipt: async (receipt) => { receipts.set(`${receipt.sessionId}:${receipt.turnIndex}`, copy(receipt)); return 201 },
    notify: async (notification) => {
      assert.ok(receipts.size > 0, "lead event precedes notifications")
      notifications.set(notification.sessionId, copy(notification))
    },
  }
  return { store, leads, receipts, notifications, deps, counts: () => ({ modelCalls, leadCalls }) }
}

test("ladder then Lebanon gate clears persisted model uncertainty and resumes the answer", async () => {
  const f = fixture(), handoffs = []
  f.deps.handoff = async (value) => { handoffs.push(copy(value)); return { leadId: null } }
  const ladder = "[INTERNAL TEST] Do you weld aluminum boat ladders?"
  const gate = "[INTERNAL TEST] My steel gate hinge broke off the post in Lebanon. Can you fix it?"
  const gateReply = "We repair metal gate hinges and posts. Did the hinge break, or did it tear metal out of the post?"
  globalThis.__assistantApiModel = async ({ prompt }) => {
    const conversation = JSON.parse(prompt).conversation
    const users = conversation.filter((message) => message.role === "user")
    if (users.length === 2) {
      assert.deepEqual(users.map((message) => message.content), [ladder, gate])
      assert.equal(conversation[1].content, f.store.turns.get(0).response.reply)
      assert.match(conversation[1].content, /A person at the shop will confirm that job\./)
    }
    // The model answers the new job but carries the earlier unknown metadata.
    return { reply: users.length === 1 ? "The shop must confirm whether we weld aluminum boat ladders. What name should the shop use?" : gateReply,
      handoff_reason: "unknown", fields: { ...emptyFields(), need: "aluminum boat ladders", material_size: "aluminum", is_job: "unsure" } }
  }
  const first = await processAssistantTurn(input({ message: ladder, is_test: true }), "ip", f.deps)
  assert.equal(first.handoff_reason, "unknown")
  assert.equal(first.continue_intake, true)
  assert.equal(f.store.turns.get(0).result.branch, "unknown-capability-intake")
  const second = await processAssistantTurn(input({ message: gate, turn_index: 1, is_test: true }), "ip", f.deps)
  assert.equal(second.reply, gateReply)
  assert.equal(second.handoff_reason, undefined)
  assert.equal(second.continue_intake, undefined)
  assert.equal(f.store.turns.get(1).result.branch, "model-answer")
  assert.equal(f.store.turns.get(1).result.handoff_reason, undefined)
  assert.equal(f.store.turns.get(1).response.reply, gateReply)
  assert.equal(f.store.session.next_turn, 2)
  assert.equal(handoffs.length, 1)
  assert.equal(f.notifications.size, 0)
})

test("service preserves finalized routing instead of inferring handoff again from answer wording", async () => {
  const f = fixture()
  const reply = "The shop needs to review the damage. What name should the shop use?"
  f.deps.model = async () => ({ reply, fields: emptyFields(), branch: "model-answer" })
  f.deps.handoff = async () => assert.fail("finalized model answer must not acquire a service handoff")
  const result = await processAssistantTurn(input(), "ip", f.deps)
  assert.match(result.reply, /The shop needs to review the damage\./)
  assert.equal(result.handoff_reason, undefined)
  assert.equal(f.store.turns.get(0).result.branch, "model-answer")
})

test("unknown capability intake survives service normalization and still hands off before later contact", async () => {
  const f = fixture(), handoffs = []
  f.deps.handoff = async (value) => { handoffs.push(copy(value)); return { leadId: null } }
  globalThis.__assistantApiModel = async ({ prompt }) => {
    const hasContact = prompt.includes("Ava")
    return {
      reply: hasContact ? "Where is the job?" : "Yes, we can do it.",
      fields: { ...emptyFields(), need: "aluminum boat ladders", ...(hasContact ? { name: "Ava", callback_phone: "+16155550199" } : {}) },
    }
  }
  const firstInput = input({ message: "Do you weld aluminum boat ladders?" })
  const first = await processAssistantTurn(firstInput, "1.2.3.4", f.deps)
  assert.match(first.reply, /A person at the shop will confirm that job\. What name should the shop use\?/)
  assert.match(first.reply, /tel:\+16157033296/)
  assert.match(first.reply, /mailto:Sales@musiccityspecialtywelding.com/)
  assert.doesNotMatch(first.reply, /\byes\b|we can|we'll|booked|scheduled|guarantee|available/i)
  assert.equal(first.continue_intake, true)
  assert.equal(f.store.turns.get(0).result.continue_intake, true)
  assert.equal(handoffs.length, 1)
  assert.equal(handoffs[0].reason, "unknown")
  assert.equal(handoffs[0].reply, first.reply)
  assert.equal(handoffs[0].leadId, null)
  assert.deepEqual(await processAssistantTurn(firstInput, "1.2.3.4", f.deps), first)
  assert.equal(handoffs.length, 1, "replay must not duplicate the existing handoff")
  const second = await processAssistantTurn(input({ turn_index: 1, message: "Ava. Call 615-555-0199." }), "1.2.3.4", f.deps)
  assert.equal(second.lead_saved, true)
  assert.match(second.reply, /Where is the job\?/)
  assert.equal(f.leads.size, 1)
  assert.equal(f.notifications.size, 1, "later contact still uses the existing lead alert")
})

test("model promise guard intake survives service normalization with its unknown handoff", async () => {
  const f = fixture(), handoffs = []
  f.deps.handoff = async (value) => { handoffs.push(copy(value)); return { leadId: null } }
  globalThis.__assistantApiModel = async () => ({ reply: "Booked. We will come tomorrow.", fields: emptyFields() })
  const result = await processAssistantTurn(input(), "1.2.3.4", f.deps)
  assert.match(result.reply, /A person at the shop will confirm that job\. What name should the shop use\?/)
  assert.doesNotMatch(result.reply, /booked|we will|tomorrow|we'll/i)
  assert.equal(result.continue_intake, true)
  assert.equal(handoffs.length, 1)
  assert.equal(handoffs[0].reason, "unknown")
})

test("input and streaming body caps reject malformed and excessive chat requests", async () => {
  for (const value of [null, {}, { ...input(), session_id: "guessable" }, { ...input(), turn_index: -1 }, { ...input(), turn_index: 30 }, { ...input(), message: " " }, { ...input(), is_test: "true" }]) assert.throws(() => validateAssistantInput(value))
  assert.throws(() => input({ message: "x".repeat(2001) }), { status: 413 })
  assert.equal(input({ message: "x".repeat(2000) }).message.length, 2000)
  const request = (body) => new Request("http://localhost/api/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body })
  await assert.rejects(readAssistantInput(request(" ".repeat(12_001))), { status: 413 })
  await assert.rejects(readAssistantInput(request("{")), { status: 400 })
  await assert.rejects(readAssistantInput(new Request("http://localhost", { method: "POST", body: "hi" })), { status: 415 })
  assert.equal((await readAssistantInput(request(JSON.stringify(input())))).message, "Need gate repair.")
})

test("IP and session throttles reject before model or inbound persistence, including unknown IP", async () => {
  for (const scope of ["ip", "session"]) {
    const f = fixture()
    const keys = []
    f.deps.rateLimit = async (key, window, maximum) => { keys.push({ key, window, maximum }); return key.startsWith(`assist:${scope}:`) }
    await assert.rejects(processAssistantTurn(input(), "", f.deps), { status: 429 })
    assert.equal(f.store.turns.size, 0)
    assert.deepEqual(f.counts(), { modelCalls: 0, leadCalls: 0 })
    assert.equal(keys[0].key, "assist:ip:hashed-unknown")
    assert.equal(keys.at(-1).maximum, scope === "ip" ? 60 : 40)
  }
})

test("money expansion is rejected before persistence rather than truncated", async () => {
  const f = fixture()
  await assert.rejects(processAssistantTurn(input({ message: "$1 ".repeat(600) }), "ip", f.deps), { status: 413 })
  assert.equal(f.store.turns.size, 0)
})

test("failed inbound persistence prevents both model and intake side effects", async () => {
  const f = fixture()
  f.store.begin = async () => { throw new Error("Storage unavailable") }
  await assert.rejects(processAssistantTurn(input({ message: completeMessage }), "ip", f.deps), /Storage unavailable/)
  assert.deepEqual(f.counts(), { modelCalls: 0, leadCalls: 0 })
  assert.equal(f.receipts.size, 0)
  assert.equal(f.notifications.size, 0)
})

test("non-jobs, uncertain jobs and routing callback numbers never file or notify", async () => {
  for (const fields of [
    { ...completeFields(), is_job: "no" },
    { ...completeFields(), is_job: "unsure" },
    { ...completeFields(), callback_phone: "+16157033296" },
  ]) {
    const f = fixture()
    f.deps.model = async () => ({ reply: "Please call the shop to confirm.", fields })
    const response = await processAssistantTurn(input({ message: completeMessage }), "ip", f.deps)
    assert.equal(response.lead_saved, false)
    assert.equal(f.leads.size, 0)
    assert.equal(f.notifications.size, 0)
  }
})

test("real brain with mocked lib/ai persists every inbound before AI, files through real job-intake once, and replays without work", async () => {
  const f = fixture()
  const first = await processAssistantTurn(input(), "ip", f.deps)
  assert.equal(first.lead_saved, false)
  const secondInput = input({ turn_index: 1, message: completeMessage })
  const second = await processAssistantTurn(secondInput, "ip", f.deps)
  assert.equal(second.lead_saved, true)
  assert.equal(f.leads.size, 1)
  assert.equal(f.notifications.size, 1)
  assert.deepEqual(f.counts(), { modelCalls: 2, leadCalls: 1 })
  assert.equal(f.leads.get(`assistant:${sessionId}`).value.preferredContact, "Call")
  assert.equal(f.leads.get(`assistant:${sessionId}`).options.sourceOverride, "website-chat")
  const stored = JSON.stringify({ turns: [...f.store.turns.values()], leads: [...f.leads.values()], receipts: [...f.receipts.values()], notifications: [...f.notifications.values()] })
  assert.doesNotMatch(stored, /\$300|300 dollars/)
  assert.match(stored, /owner-only money/)
  assert.deepEqual(await processAssistantTurn(secondInput, "ip", f.deps), second)
  assert.deepEqual(f.counts(), { modelCalls: 2, leadCalls: 1 })
  await assert.rejects(processAssistantTurn(input({ turn_index: 1, message: "Changed request" }), "ip", f.deps), { status: 409 })
  await processAssistantTurn(input({ turn_index: 2, message: "The gate is in Lebanon." }), "ip", f.deps)
  assert.equal(f.leads.size, 1)
  assert.equal(f.receipts.size, 2, "later details stay on the same lead journal")
  assert.equal(f.notifications.size, 1)
})

test("flag and INTERNAL TEST marker remain sticky through real job intake and events and never notify", async () => {
  for (const testInput of [{ is_test: true, message: completeMessage }, { message: `[INTERNAL TEST] ${completeMessage}` }]) {
    const f = fixture()
    const response = await processAssistantTurn(input(testInput), "ip", f.deps)
    assert.equal(response.lead_saved, true)
    const lead = [...f.leads.values()][0]
    assert.equal(lead.is_test, true)
    assert.match(lead.value.message, /\[INTERNAL TEST\]/)
    assert.equal([...f.receipts.values()][0].isTest, true)
    assert.equal(f.notifications.size, 0)
    await processAssistantTurn(input({ turn_index: 1, message: "Please call Ava." }), "ip", f.deps)
    assert.equal([...f.receipts.values()].at(-1).isTest, true)
    assert.equal(f.notifications.size, 0)
  }
})

test("chat intake stores the callback window separately from requested work timing with money removed", async () => {
  const f = fixture()
  f.deps.model = async () => ({ reply: "What material is it?", fields: { ...completeFields(), callback_window: "after 3; budget $400" } })
  await processAssistantTurn(input({ message: `${completeMessage} Call after 3.` }), "ip", f.deps)
  const message = [...f.leads.values()][0].value.message
  assert.match(message, /Requested timing: Next week/)
  assert.match(message, /Callback requested: after 3/)
  assert.doesNotMatch(message, /\$400/)
})

test("retry after notification failure uses stored model and existing lead checkpoint", async () => {
  const f = fixture()
  const value = input({ message: completeMessage })
  const notify = f.deps.notify
  f.deps.notify = async () => { throw new Error("Notification storage unavailable") }
  await assert.rejects(processAssistantTurn(value, "ip", f.deps), /Notification storage/)
  assert.equal(f.store.turns.get(0).result.fields.name, "Ava")
  assert.equal(f.store.session.lead_id, 41)
  f.deps.notify = notify
  assert.equal((await processAssistantTurn(value, "ip", f.deps)).lead_saved, true)
  assert.deepEqual(f.counts(), { modelCalls: 1, leadCalls: 1 })
  assert.equal(f.notifications.size, 1)
})

test("an intake-key race with a different test partition cannot link or notify", async () => {
  const f = fixture()
  globalThis.__assistantCreateLead = async () => {
    f.leads.set(`assistant:${sessionId}`, { id: 41, is_test: false })
    return { id: 41, reused: true, eventId: null }
  }
  await assert.rejects(processAssistantTurn(input({ is_test: true, message: completeMessage }), "ip", f.deps), /partition changed/)
  assert.equal(f.store.session.lead_id, null)
  assert.equal(f.receipts.size, 0)
  assert.equal(f.notifications.size, 0)
})

test("concurrent replay cannot run another model; stale writer cannot file a lead", async () => {
  const f = fixture()
  let resume
  const waiting = new Promise((resolve) => { resume = resolve })
  f.deps.model = async () => { await waiting; return { reply: "What material?", fields: completeFields() } }
  const value = input({ message: completeMessage })
  const pending = processAssistantTurn(value, "ip", f.deps)
  while (!f.store.active) await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(processAssistantTurn(value, "ip", f.deps), { status: 409 })
  f.store.token++
  resume()
  await assert.rejects(pending, { status: 409 })
  assert.equal(f.leads.size, 0)
})

test("Postgres checkpoints reject missing inbound insert and every stale lease update", async () => {
  const queries = []
  globalThis.__assistantSql = async (strings, ...values) => {
    const query = strings.join(" ? ")
    queries.push(query)
    if (query.includes("SELECT id, next_turn")) return [{ id: sessionId, next_turn: 0, is_test: false, lead_id: null }]
    if (query.includes("SELECT inbound, result")) return []
    if (query.includes("SET lease_token =")) return [{ id: sessionId, next_turn: 0, is_test: false, lead_id: null }]
    assert.ok(values.every((value) => typeof value !== "string" || !value.includes("$300")))
    return []
  }
  const store = new PostgresAssistantStore()
  await assert.rejects(store.begin(input()), { status: 409 })
  assert.ok(queries.some((query) => query.includes("INSERT INTO assistant_turns") && query.includes("RETURNING inbound")))
  const claim = { session: { id: sessionId }, token: "stale" }
  await assert.rejects(store.verifyLease(claim), { status: 409 })
  await assert.rejects(store.saveModel(claim, 0, { reply: "Hi", fields: emptyFields() }), { status: 409 })
  await assert.rejects(store.saveLead(claim, 0, 41), { status: 409 })
  await assert.rejects(store.finish(claim, 0, { ok: true, reply: "Hi" }), { status: 409 })
  for (const query of queries.filter((query) => /SET result|SET lead_id|SET response/.test(query))) {
    assert.match(query, /lease_token/)
    assert.match(query, /lease_until > now\(\)/)
  }
})

test("migration is additive, idempotent and a named step; route is gated off with safe errors", () => {
  const migration = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8")
  const assistant = migration.slice(migration.indexOf("const assistantChatStatement"), migration.indexOf("export async function runMigrations"))
  assert.match(assistant, /CREATE TABLE IF NOT EXISTS assistant_sessions/)
  assert.match(assistant, /CREATE TABLE IF NOT EXISTS assistant_turns/)
  assert.match(assistant, /PRIMARY KEY \(session_id, turn_index\)/)
  assert.doesNotMatch(assistant, /DROP|ALTER TABLE|roof_leads/)
  assert.match(migration, /name: "assistant-chat-a1-2026-11-10", query: assistantChatStatement/)
  const route = readFileSync(new URL("../app/api/assist/route.ts", import.meta.url), "utf8")
  assert.ok(route.indexOf('NEXT_PUBLIC_ASSISTANT_CHAT !== "1"') < route.indexOf("await readAssistantInput"))
  assert.match(route, /"Cache-Control": "no-store"/)
  assert.doesNotMatch(route, /request\.json\(|error\.message.*status: 503|roof_leads/)
})

test("chat and voice deployment bundles both include the repo knowledge sources", () => {
  const compiled = ts.transpileModule(readFileSync(new URL("../next.config.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { process })
    (() => ({ CSP_REPORTING_ENDPOINTS: "", CSP_REPORT_ONLY_POLICY: "" }), loaded, loaded.exports)
  for (const route of ["/api/assist", "/api/twilio/assist-voice"]) {
    const files = loaded.exports.default.outputFileTracingIncludes[route] ?? []
    assert.ok(files.includes("./BRAND-BRIEF.md"), `${route} must package the brand source`)
    assert.ok(files.includes("./app/service-areas/page.tsx"), `${route} must package service areas`)
  }
})

test("ordinary qualified chat leads use the durable transcript handoff instead of an alert alone", async () => {
  const { AssistantRequestError } = await import("../lib/assistant/input.ts")
  const compiled = ts.transpileModule(readFileSync(new URL("../app/api/assist/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const handoffs = [], alerts = []
  const fields = completeFields()
  const modules = new Map([
    ["@/lib/assistant/input.ts", { readAssistantInput, AssistantRequestError }],
    ["@/lib/assistant/contact.ts", { assistantContactReply }],
    ["@/lib/assistant/service.ts", { processAssistantTurn: async (_input, _ip, deps) => {
      await deps.notify({ sessionId, turnIndex: 2, leadId: 41, eventId: 201, fields })
      return { ok: true, reply: "What material is it?", fields, lead_saved: true }
    } }],
    ["@/lib/assistant/store.ts", { PostgresAssistantStore: class {} }],
    ["@/lib/assistant/turn.ts", { handleAssistantTurn() {} }],
    ["@/lib/assistant/money.ts", { stripAssistantMoney: (value) => value }],
    ["@/lib/assistant/handoff.ts", { deliverAssistantHandoff: async (value) => { handoffs.push(copy(value)); return { leadId: 41 } } }],
    ["@/lib/db", { getSql() { assert.fail("route assembly fixture must not access the database") } }],
    ["@/lib/events", { recordEvent() {} }],
    ["@/lib/job-intake", { fileAssistantLead() {} }],
    ["@/lib/people", { normalizePhone() {}, isReservedShopPhone() {} }],
    ["@/lib/notify", { notifyAll: async (value) => { alerts.push(value) } }],
    ["@/lib/rate-limit", { consumeStrictRateLimit() {}, rateLimitFingerprint() {} }],
    ["@/lib/shop-contact", { getShopPhone: () => ({ display: "(615) 703-3296", href: "tel:+16157033296" }) }],
  ])
  const loaded = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Response, console, process: { env: { NEXT_PUBLIC_ASSISTANT_CHAT: "1" } } })
    ((name) => { assert.ok(modules.has(name), name); return modules.get(name) }, loaded, loaded.exports)
  const response = await loaded.exports.POST(new Request("http://localhost/api/assist", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input()),
  }))
  assert.equal(response.status, 200)
  assert.equal(alerts.length, 0, "shared durable handoff owns notification delivery")
  assert.equal(handoffs.length, 1)
  assert.deepEqual(handoffs[0], { sessionId, turnIndex: 2, leadId: 41, fields, message: "", reason: "lead", isTest: false })
})

test("actual route assembly stays off without a flag and accepts an idempotent chat when enabled in isolation", async () => {
  const f = fixture()
  const eventRows = new Map()
  const followUps = []
  const handoffs = []
  const originalModel = globalThis.__assistantApiModel
  globalThis.__assistantApiModel = async (value) => { f.store.log.push("model"); return originalModel(value) }
  const routePath = new URL("../app/api/assist/route.ts", import.meta.url)
  const compiled = ts.transpileModule(readFileSync(routePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const modules = new Map([
    ["@/lib/assistant/input.ts", { readAssistantInput }],
    ["@/lib/assistant/contact.ts", { assistantContactReply }],
    ["@/lib/assistant/handoff.ts", { deliverAssistantHandoff: async (value) => { handoffs.push(copy(value)); return { leadId: value.leadId ?? null } } }],
    ["@/lib/assistant/service.ts", { processAssistantTurn }],
    ["@/lib/assistant/store.ts", { PostgresAssistantStore: class { constructor() { return f.store } } }],
    ["@/lib/assistant/turn.ts", { handleAssistantTurn }],
    ["@/lib/assistant/money.ts", { stripAssistantMoney: (value) => value.replace(/\$\d+/g, "[owner-only money]") }],
    ["@/lib/assistant/followup.ts", { followUpAssistantLead: async (value) => { followUps.push(copy(value)) } }],
    ["@/lib/db", { getSql: () => globalThis.__assistantSql }],
    ["@/lib/events", { recordEvent: async (value) => {
      if (eventRows.has(value.externalId)) return null
      eventRows.set(value.externalId, copy(value)); return 201
    } }],
    ["@/lib/job-intake", { fileAssistantLead }],
    ["@/lib/people", { normalizePhone: (value) => value, isReservedShopPhone: () => false }],
    ["@/lib/notify", { notifyAll: async (value) => { f.notifications.set(value.dedupeKey, value) } }],
    ["@/lib/rate-limit", { consumeStrictRateLimit: async () => false, rateLimitFingerprint: (value) => value }],
    ["@/lib/shop-contact", { getShopPhone: () => f.deps.phone }],
  ])
  const { AssistantRequestError } = await import("../lib/assistant/input.ts")
  modules.get("@/lib/assistant/input.ts").AssistantRequestError = AssistantRequestError
  const load = (env) => {
    const loaded = { exports: {} }
    const context = vm.createContext({ Response, console: { error() {}, info() {} }, process: { env } })
    const run = vm.runInContext(`(function(require, module, exports) { ${compiled}\n})`, context)
    run((name) => {
      assert.ok(modules.has(name), `unmocked route import ${name}`)
      return modules.get(name)
    }, loaded, loaded.exports)
    return loaded.exports.POST
  }
  const request = () => new Request("http://localhost/api/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input({ message: completeMessage })) })
  assert.equal((await load({})(request())).status, 404)
  assert.equal(f.store.turns.size, 0)
  assert.equal(followUps.length, 0)
  const enabled = load({ NEXT_PUBLIC_ASSISTANT_CHAT: "1" })
  const response = await enabled(request())
  assert.equal(response.status, 200)
  assert.equal((await response.json()).lead_saved, true)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal((await enabled(request())).status, 200)
  assert.deepEqual(f.counts(), { modelCalls: 1, leadCalls: 1 })
  assert.equal(eventRows.size, 1)
  assert.equal(f.notifications.size, 0, "the shared handoff owns delivery")
  assert.equal(handoffs.length, 1, "the first saved lead reaches the transcript outbox")
  assert.equal(handoffs[0].leadId, 41)
  assert.equal(followUps.length, 1, "chat route wires the shared lead followup once")
  assert.equal(followUps[0].leadId, 41)
  assert.equal(followUps[0].eventId, 201)
})

test("model errors and timeouts persist a contact fallback, retain customer contact, and hand off once on replay", async () => {
  for (const name of ["Error", "TimeoutError", "AbortError"]) {
    const f = fixture()
    let modelCalls = 0
    const handoffs = []
    f.deps.model = async () => { modelCalls++; throw Object.assign(new Error("private provider failure"), { name }) }
    f.deps.handoff = async (value) => {
      assert.equal(f.store.turns.get(0).result.handoff_reason, "model-error", "fallback is durable before handoff")
      handoffs.push(copy(value))
      return { leadId: null }
    }
    const value = input({ message: "Call 615-555-0199 or ava@example.com. My budget is $300." })
    const result = await processAssistantTurn(value, "ip", f.deps)
    assert.equal(result.handoff_reason, "model-error")
    assert.equal(result.fields.callback_phone, "+16155550199")
    assert.equal(result.fields.email, "ava@example.com")
    assert.match(result.reply, /tel:\+16157033296/)
    assert.match(result.reply, /mailto:Sales@musiccityspecialtywelding\.com/)
    assert.match(result.reply, /What name should the shop use\?/i)
    assert.doesNotMatch(JSON.stringify({ result, handoffs }), /private provider failure|\$300/)
    assert.equal(handoffs.length, 1)
    assert.deepEqual(await processAssistantTurn(value, "ip", f.deps), result)
    assert.equal(modelCalls, 1)
    assert.equal(handoffs.length, 1)
  }
})

test("real route 429, 409 and 503 replies always carry contact options and preserve the rejected inbound for handoff", async () => {
  const { AssistantRequestError } = await import("../lib/assistant/input.ts")
  const compiled = ts.transpileModule(readFileSync(new URL("../app/api/assist/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const status of [429, 409, 503]) {
    for (const isTest of [false, true]) {
      const handoffs = []
      const logs = []
      const phone = { display: "(615) 703-3296", href: "tel:+16157033296" }
      const failure = status === 503 ? new Error("private provider transport details") : new AssistantRequestError("private internal details", status)
      const modules = new Map([
        ["@/lib/assistant/input.ts", { readAssistantInput, AssistantRequestError }],
        ["@/lib/assistant/contact.ts", { assistantContactReply }],
        ["@/lib/assistant/service.ts", { processAssistantTurn: async () => { throw failure } }],
        ["@/lib/assistant/store.ts", { PostgresAssistantStore: class {} }],
        ["@/lib/assistant/turn.ts", { handleAssistantTurn() {} }],
        ["@/lib/assistant/money.ts", { stripAssistantMoney: (value) => value }],
        ["@/lib/assistant/handoff.ts", { deliverAssistantHandoff: async (value) => { handoffs.push(copy(value)); return { leadId: null } } }],
        ["@/lib/db", { getSql() { assert.fail("route error fixtures do not access the database") } }],
        ["@/lib/events", { recordEvent() {} }],
        ["@/lib/job-intake", { fileAssistantLead() {} }],
        ["@/lib/people", { normalizePhone() {}, isReservedShopPhone() {} }],
        ["@/lib/notify", { notifyAll() {} }],
        ["@/lib/rate-limit", { consumeStrictRateLimit() {}, rateLimitFingerprint() {} }],
        ["@/lib/shop-contact", { getShopPhone: () => phone }],
      ])
      const loaded = { exports: {} }
      const context = vm.createContext({ Response, console: { error: (value) => logs.push(value), info: (...values) => logs.push(values) }, process: { env: { NEXT_PUBLIC_ASSISTANT_CHAT: "1" } } })
      vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context)((name) => {
        assert.ok(modules.has(name), `unmocked route import ${name}`)
        return modules.get(name)
      }, loaded, loaded.exports)
      const value = input({ message: "Please call me at 615-555-0199 about my gate", is_test: isTest })
      const response = await loaded.exports.POST(new Request("http://localhost/api/assist", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
      }))
      assert.equal(response.status, status)
      assert.equal(response.headers.get("Cache-Control"), "no-store")
      assert.equal(response.headers.get("Retry-After"), status === 429 ? "600" : status === 409 ? "5" : "15")
      const result = await response.json()
      assert.equal(result.ok, false)
      assert.match(result.error, /tel:\+16157033296/)
      assert.match(result.error, /mailto:Sales@musiccityspecialtywelding\.com/)
      assert.match(result.error, /What callback number should the shop use\?/i)
      assert.doesNotMatch(JSON.stringify({ result, logs }), /private internal|private provider/)
      assert.equal(handoffs.length, 1)
      assert.deepEqual(handoffs[0], {
        sessionId, turnIndex: 0, message: value.message, isTest,
        deferDelivery: status === 429,
        reason: status === 429 ? "rate-limit" : "unavailable",
      })
    }
  }
})

test("human and cannot-answer turns use deterministic contact options even when the model omits a handoff flag", async () => {
  for (const [message, reply] of [
    ["I want a human", "What material is it?"],
    ["How much will it cost?", "What is your name?"],
    ["Can you finish tomorrow?", "The shop needs to confirm that."],
    ["Can you weld this specialty alloy?", "I don't know that capability."],
  ]) {
    const f = fixture()
    const handoffs = []
    f.deps.model = async () => ({ reply, fields: emptyFields() })
    f.deps.handoff = async (value) => { handoffs.push(copy(value)); return { leadId: null } }
    const result = await processAssistantTurn(input({ message }), "ip", f.deps)
    assert.match(result.reply, /^I'm an automated assistant/)
    assert.match(result.reply, /tel:\+16157033296/)
    assert.match(result.reply, /mailto:Sales@musiccityspecialtywelding\.com/)
    assert.match(result.reply, /What callback number should the shop use\?/i)
    assert.equal(handoffs.length, 1)
  }
})

test("partial phone and email handoffs file through existing intake and checkpoint the lead", async () => {
  for (const [message, expectedPhone, expectedEmail] of [
    ["A human please. Call 615-555-0199", "+16155550199", ""],
    ["A human please. ava@example.com", "", "ava@example.com"],
  ]) {
    const f = fixture()
    f.deps.model = async () => { throw new Error("model unavailable") }
    f.deps.handoff = async (value) => fileAssistantLead({
      sessionId: value.sessionId, fields: value.fields, isTest: value.isTest,
      partial: true, transcript: `${value.message}; $400 budget`,
    })
    const result = await processAssistantTurn(input({ message }), "ip", f.deps)
    assert.equal(result.lead_saved, true)
    assert.equal(f.store.session.lead_id, 41)
    const lead = [...f.leads.values()][0]
    assert.equal(lead.options.intakeKey, `assistant:${sessionId}`)
    assert.equal(lead.options.sourceOverride, "website-chat")
    assert.equal(lead.value.phone, expectedPhone)
    assert.equal(lead.value.email, expectedEmail)
    assert.equal(lead.value.preferredContact, expectedPhone ? "Call" : "Email")
    assert.equal(lead.value.firstName, "Assistant callback (partial)")
    assert.match(lead.value.message, /Partial assistant request/)
    assert.match(lead.value.message, /Missing: name/)
    assert.match(lead.value.message, /Conversation:/)
    assert.doesNotMatch(lead.value.message, /\$400/)
  }
})

test("partial intake refuses missing contact and shop routing phones without inventing contact", async () => {
  const f = fixture()
  for (const fields of [
    emptyFields(),
    { ...emptyFields(), callback_phone: "+16157033296" },
    { ...emptyFields(), email: "not-an-email" },
    { ...emptyFields(), email: "ava@example.com\nBcc:other@example.com" },
  ]) {
    await assert.rejects(fileAssistantLead({ sessionId, fields, isTest: false, partial: true }), /intake needs/)
  }
  assert.equal(f.leads.size, 0)
  assert.equal(f.counts().leadCalls, 0)
})

test("partial intake retains test markers beyond the bounded lead message", async () => {
  const f = fixture()
  f.store.log.push("persist-model")
  const filed = await fileAssistantLead({
    sessionId, fields: { ...emptyFields(), callback_phone: "+16155550199" },
    isTest: false, partial: true, transcript: `${"welding details ".repeat(200)}[INTERNAL TEST]`,
  })
  assert.equal(filed.isTest, true)
  assert.equal([...f.leads.values()][0].value.isTest, true)
  assert.match([...f.leads.values()][0].value.message, /^\[INTERNAL TEST\]/)
})

test("test model failures retain disclosure and pass their test partition to durable handoff intake", async () => {
  for (const value of [
    input({ message: "Human please. 615-555-0199", is_test: true }),
    input({ message: "[INTERNAL TEST] Human please. ava@example.com" }),
  ]) {
    const f = fixture()
    let handoffs = 0
    f.deps.model = async () => { throw new Error("model unavailable") }
    f.deps.handoff = async (handoff) => { handoffs++; assert.equal(handoff.isTest, true); return { leadId: 41 } }
    const result = await processAssistantTurn(value, "ip", f.deps)
    assert.equal(result.handoff_reason, "model-error")
    assert.match(result.reply, /^I'm an automated assistant/)
    assert.equal(result.lead_saved, true)
    assert.equal(handoffs, 1)
    assert.equal(f.leads.size, 0)
    assert.equal(f.notifications.size, 0)
  }
})

test("first test human reply discloses automation once and replay never repeats the durable handoff", async () => {
  const f = fixture()
  const handoffs = []
  f.deps.model = async () => ({ reply: "I'm an automated assistant for Music City Specialty Welding. Please call.", fields: emptyFields(), handoff_reason: "human" })
  f.deps.handoff = async (value) => { handoffs.push(copy(value)); return { leadId: null } }
  const value = input({ message: "[INTERNAL TEST] I want to talk to a person" })
  const response = await processAssistantTurn(value, "ip", f.deps)
  assert.equal(response.reply.match(/automated assistant/g).length, 1)
  assert.match(response.reply, /^I'm an automated assistant/)
  assert.equal(response.handoff_reason, "human")
  assert.equal(handoffs.length, 1)
  assert.equal(handoffs[0].isTest, true)
  assert.deepEqual(await processAssistantTurn(value, "ip", f.deps), response)
  assert.equal(handoffs.length, 1)
  assert.equal(f.notifications.size, 0)
})

test("service persists safe internal branch and model diagnostics without exposing them publicly", async () => {
  const f = fixture()
  f.deps.model = async () => ({
    reply: "What material is it?", fields: emptyFields(), branch: "model-answer",
    model_diagnostics: { stop_reason: "end_turn", content_block_types: ["text", "private fixture-secret-key"], usage: { input_tokens: 3, output_tokens: 8, private: "fixture-secret-key" }, private: "fixture-secret-key" },
  })
  const response = await processAssistantTurn(input(), "ip", f.deps)
  assert.equal(f.store.turns.get(0).result.branch, "model-answer")
  assert.deepEqual(f.store.turns.get(0).result.model_diagnostics, { stop_reason: "end_turn", content_block_types: ["text", "unknown"], usage: { input_tokens: 3, output_tokens: 8 } })
  assert.equal(Object.hasOwn(response, "model_diagnostics"), false)
  assert.equal(Object.hasOwn(response, "branch"), false)
  assert.doesNotMatch(JSON.stringify([...f.store.turns.values()]), /private|fixture-secret-key/)
})

test("service model exceptions persist a model-error branch with sanitized metadata only", async () => {
  const f = fixture()
  f.deps.model = async () => { throw Object.assign(new Error("private fixture-secret-key"), {
    modelDiagnostics: { stop_reason: "private fixture-secret-key", content_block_types: ["text", "fixture-secret-key"], usage: { input_tokens: -5, output_tokens: 8, private: "fixture-secret-key" }, private: "fixture-secret-key" },
  }) }
  const response = await processAssistantTurn(input(), "ip", f.deps)
  assert.equal(response.handoff_reason, "model-error")
  assert.equal(f.store.turns.get(0).result.branch, "model-error")
  assert.deepEqual(f.store.turns.get(0).result.model_diagnostics, { stop_reason: null, content_block_types: ["text", "unknown"], usage: { output_tokens: 8 } })
  assert.doesNotMatch(JSON.stringify([...f.store.turns.values()]), /private|fixture-secret-key/)
})
