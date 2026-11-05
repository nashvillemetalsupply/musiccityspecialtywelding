import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { shouldSkipGmailMessage } from "../lib/gmail-routing.ts"
import { sendEmailWithProviderTruth, isDefinitiveEmailProviderError } from "../lib/email-provider-truth.ts"
import { pendingGmailMessageIds, settleGmailRun, splitGmailMessageBatch, canAdvanceGmailCheckpoint, shouldNotifyGmailDeadLetter } from "../lib/gmail-ingest-checkpoint.ts"

function load(path, fakes, env) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  const context = vm.createContext({ console: { error() {} }, process: { env }, Date, Error, Request, Response, URL, crypto: { randomUUID: () => "fixture-lease" } })
  vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, (name) => {
    if (fakes.has(name)) return fakes.get(name)
    throw new Error(`Unexpected import: ${name}`)
  }, loaded)
  return loaded.exports
}

const baseInput = {
  source: "email-in", createdLead: true, existingThread: false,
  messageId: "gmail-message-1", threadId: "gmail-thread-1", leadId: 7, personId: 3,
  displayName: "Alex Customer", email: "alex@example.com", subject: "Gate repair", body: "Can you repair my gate?",
  headers: { "message-id": "<customer-message@example.com>" }, categorizedNoise: false, isTest: false,
}

function harness({ env: overrides = {}, ownOperator = false, provider = "accepted", intentFailure = false } = {}) {
  const env = { MCSW_EMAIL_IN_ACK: "1", RESEND_API_KEY: "synthetic-key", QUOTE_FROM_EMAIL: "Shop <shop@shop.example>", ...overrides }
  const events = new Map()
  const effects = { sends: [], order: [], sql: [] }
  const recordEvent = async (event) => {
    if (intentFailure && event.kind === "email.out") throw new Error("intent storage unavailable")
    const key = `${event.kind}:${event.externalId}`
    if (events.has(key)) return null
    const id = events.size + 1
    events.set(key, { ...event, id })
    effects.order.push(event.kind)
    return id
  }
  const sql = async (strings) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    effects.sql.push(query)
    if (query.startsWith("SELECT id FROM operators")) return ownOperator ? [{ id: 2 }] : []
    throw new Error(`Unexpected acknowledgement SQL: ${query}`)
  }
  class Resend {
    emails = { send: async (payload, options) => {
      assert.equal(effects.order.at(-1), "email.out", "durable intent precedes provider handoff")
      const persisted = [...events.values()].find((event) => event.externalId === options.idempotencyKey)
      assert.equal(persisted.body, payload.text)
      assert.equal(persisted.detail.to, payload.to)
      assert.equal(persisted.detail.from, payload.from)
      assert.equal(persisted.detail.subject, payload.subject)
      assert.deepEqual(persisted.detail.headers, payload.headers)
      effects.order.push("provider")
      effects.sends.push({ payload, options })
      if (provider === "lost") throw new Error("provider response lost")
      if (provider === "rejected") return { error: { message: "recipient rejected" } }
      return { data: { id: "resend-fixture-1" } }
    } }
  }
  const fakes = new Map([
    ["resend", { Resend }], ["@/lib/db", { getSql: () => sql }], ["@/lib/events", { recordEvent }],
    ["@/lib/gmail-routing.ts", { shouldSkipGmailMessage }],
    ["@/lib/email-provider-truth.ts", { sendEmailWithProviderTruth, isDefinitiveEmailProviderError }],
    ["@/lib/shop-contact", { getShopPhone: () => ({ display: "(615) 555-0101" }) }],
  ])
  const api = load("lib/email-in-ack.ts", fakes, env)
  return { api, events, effects, recordEvent, env, send: (changes = {}) => api.acknowledgeNewEmailLead({ ...baseInput, ...changes }) }
}

test("new email lead is acknowledged once, with form copy adapted to request a callback number", async () => {
  const h = harness()
  await h.send()
  await h.send()
  assert.equal(h.effects.sends.length, 1)
  const { payload, options } = h.effects.sends[0]
  assert.equal(payload.to, "alex@example.com")
  assert.equal(options.idempotencyKey, "email-in:gmail-thread-1:ack")
  assert.equal(payload.text, "Hey Alex,\n\nYour email request just hit our board. Reply with a phone number so a real person from the shop can call you.\n\nIf it can't wait, call (615) 555-0101.\n\nMusic City Specialty Welding\n533 W Baddour Pkwy, Lebanon, TN 37087")
  assert.equal(payload.subject, "Re: Gate repair")
  assert.equal(payload.headers["In-Reply-To"], "<customer-message@example.com>")
  assert.equal(payload.headers.References, "<customer-message@example.com>")
  assert.equal(payload.headers["Auto-Submitted"], "auto-replied")
  const intent = [...h.events.values()].find((event) => event.kind === "email.out")
  const receipt = [...h.events.values()].find((event) => event.kind === "email.accepted")
  assert.equal(intent.actorType, "system", "form confirmations do not count as human replies")
  assert.equal(intent.detail.audience, "customer")
  assert.equal(intent.detail.automaticAck, true)
  assert.equal(receipt.detail.sourceEventId, intent.id)
  assert.equal(receipt.detail.providerEmailId, "resend-fixture-1")
  assert.ok(h.effects.sql.every((query) => !query.includes("UPDATE")), "matches form receipt accounting without marking a human first response")
})

for (const [name, input] of [
  ["existing lead", { createdLead: false }],
  ["existing thread even with a newly recovered person", { existingThread: true }],
  ["email-out", { source: "email-out" }],
  ["no-reply sender", { email: "no-reply@example.com" }],
  ["tagged no-reply sender", { email: "no-reply+receipt@example.com" }],
  ["mailer-daemon sender", { email: "mailer-daemon@example.com" }],
  ["shop domain", { email: "sales@musiccityspecialtywelding.com" }],
  ["configured shop sender", { email: "shop@shop.example" }],
  ["spam", { categorizedNoise: true }],
  ["automated message", { headers: { "auto-submitted": "auto-replied" } }],
  ["bulk mail", { headers: { precedence: "bulk" } }],
  ["orphan reply", { headers: { "in-reply-to": "<old@example.com>" } }],
  ["orphan referenced thread", { headers: { references: "<old@example.com>" } }],
  ["test person", { isTest: true }],
  ["test marker", { body: "[INTERNAL TEST] fixture request" }],
]) test(`${name} is never acknowledged`, async () => {
  const h = harness()
  await h.send(input)
  assert.equal(h.effects.sends.length, 0)
  assert.equal(h.events.size, 0)
})

test("shop operator addresses, including inactive operators, are never acknowledged", async () => {
  const h = harness({ ownOperator: true })
  await h.send()
  assert.equal(h.effects.sends.length, 0)
  assert.doesNotMatch(h.effects.sql[0], /active\s*=/, "inactive operator addresses remain shop addresses")
})

for (const [setting, value] of [
  ["QUOTE_TO_EMAIL", "Other <other@shop.example>, Quote Inbox <alex@example.com>"],
  ["OPS_LOGIN_EMAIL", "Owner <Alex@Example.com>"],
]) test(`configured ${setting} alias is never acknowledged`, async () => {
  const h = harness({ env: { [setting]: value } })
  await h.send()
  assert.equal(h.effects.sends.length, 0)
  assert.equal(h.events.size, 0)
})

for (const flag of [undefined, "0", "true"]) test(`kill switch ${String(flag)} leaves email acknowledgements off`, async () => {
  const h = harness({ env: { MCSW_EMAIL_IN_ACK: flag } })
  await h.send()
  assert.equal(h.events.size, 0)
})

for (const missing of ["RESEND_API_KEY", "QUOTE_FROM_EMAIL"]) test(`missing ${missing} never hands off to the provider`, async () => {
  const h = harness({ env: { [missing]: "" } })
  await h.send()
  assert.equal(h.events.size, 0)
})

for (const [provider, kind] of [["lost", "email.unknown"], ["rejected", "email.failed"]]) test(`${provider} provider result records truth and cannot resend on replay`, async () => {
  const h = harness({ provider })
  await h.send()
  await h.send()
  assert.equal(h.effects.sends.length, 1)
  const receipt = [...h.events.values()].find((event) => event.kind === kind)
  assert.equal(receipt.detail.sourceEventId, 1)
  assert.equal(receipt.detail.ambiguous, provider === "lost")
})

test("failed intent persistence prevents a provider call", async () => {
  const h = harness({ intentFailure: true })
  await assert.rejects(h.send(), /intent storage unavailable/)
  assert.equal(h.effects.sends.length, 0)
})

test("thread ID is stable across concurrent first messages in the same conversation", async () => {
  const h = harness()
  await Promise.all([
    h.send({ messageId: "concurrent-message-1" }),
    h.send({ messageId: "concurrent-message-2" }),
  ])
  assert.equal(h.effects.sends.length, 1)
  assert.equal(h.effects.sends[0].options.idempotencyKey, "email-in:gmail-thread-1:ack")
})

test("message ID is a stable fallback key and malformed reply headers cannot inject headers", async () => {
  const h = harness()
  await h.send({ threadId: "", subject: "repair\r\nBcc: other@example.com", headers: { "message-id": "<ok@example.com>\r\nBcc: other@example.com" } })
  const sent = h.effects.sends[0]
  assert.equal(sent.options.idempotencyKey, "email-in:gmail-message-1:ack")
  assert.equal(sent.payload.headers["In-Reply-To"], undefined)
  assert.doesNotMatch(sent.payload.subject, /[\r\n]/)
})

function gmailHarness({ existingThread = false, sent = false, email = baseInput.email } = {}) {
  const h = harness()
  const state = { mapped: existingThread, created: existingThread, inboundIds: new Map() }
  const headers = { from: sent ? "shop@shop.example" : email, to: sent ? email : "shop@shop.example", subject: baseInput.subject, ...baseInput.headers }
  const person = { id: 3, display_name: baseInput.displayName, is_test: false }
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (query.startsWith("INSERT INTO sync_state") && query.includes("gmail-ingest-lease")) return [{ key: "gmail-ingest-lease" }]
    if (query.startsWith("SELECT value FROM sync_state")) return [{ value: { pendingIds: [baseInput.messageId], historyId: "1" } }]
    if (query.startsWith("SELECT et.lead_id")) return state.mapped ? [{ lead_id: 7, person_id: 3 }] : []
    if (query.startsWith("INSERT INTO external_threads")) { state.mapped = true; return [] }
    if (query.startsWith("SELECT id FROM operators")) return [{ id: 2 }]
    if (query.startsWith("SELECT id FROM events")) return [{ id: state.inboundIds.get(values[1]) }]
    if (query.startsWith("INSERT INTO sync_state") || query.startsWith("UPDATE sync_state") || query.startsWith("DELETE FROM sync_state") || query.startsWith("INSERT INTO automation_runs")) return []
    throw new Error(`Unexpected Gmail SQL: ${query}`)
  }
  const fakes = new Map([
    ["next/server", { after() {} }], ["@/lib/db", { getSql: () => sql }],
    ["@/lib/events", { recordEvent: async (event) => {
      if (state.inboundIds.has(event.externalId)) return null
      const id = state.inboundIds.size + 100
      state.inboundIds.set(event.externalId, id)
      return id
    } }],
    ["@/lib/extract", { processEvent: async () => {} }],
    ["@/lib/gmail", {
      gmailConfigured: () => true, gmailAccessToken: async () => "synthetic-token",
      getGmailMessage: async () => ({ id: baseInput.messageId, threadId: baseInput.threadId, internalDate: "1793880000000", labelIds: sent ? ["SENT"] : [] }),
      gmailHeaders: () => headers, gmailHeaderValues: () => [], gmailPlaintext: () => baseInput.body,
      emailAddress: (value) => value, emailName: () => baseInput.displayName, gmailAttachmentDescriptors: () => [],
    }],
    ["@/lib/ingest", { resolveEmailConversation: async () => {
      const createdLead = !state.created
      state.created = true
      return { person, leadId: 7, createdLead }
    } }],
    ["@/lib/email-in-ack", h.api], ["@/lib/notify", { notifyAll: async () => {} }],
    ["@/lib/ops-auth", { isAuthorizedCron: () => true }],
    ["@/lib/gmail-routing.ts", { shouldSkipGmailMessage, isAuthenticatedIntuitPayment: () => false, looksLikeIntuitPaymentEnvelope: () => false, sentMessageMayStartWork: () => true }],
    ["@/lib/people", { getPerson: async () => person, findPersonByEmail: async () => person }],
    ["@/lib/attachment-retry", {}], ["@/lib/shop-brain-invariants.ts", { isGmailMessageGone: () => false }],
    ["@/lib/payment-ledger", {}],
    ["@/lib/gmail-ingest-checkpoint.ts", { GMAIL_MESSAGE_CAP: 50, pendingGmailMessageIds, settleGmailRun, splitGmailMessageBatch, canAdvanceGmailCheckpoint, shouldNotifyGmailDeadLetter }],
  ])
  const route = load("app/api/ingest/gmail/route.ts", fakes, h.env)
  return { ...h, run: () => route.GET(new Request("https://fixture.example/api/ingest/gmail")) }
}

test("Gmail route acknowledges a new email lead once across re-ingestion", async () => {
  const h = gmailHarness()
  assert.equal((await h.run()).status, 200)
  assert.equal((await h.run()).status, 200)
  assert.equal(h.effects.sends.length, 1)
})

for (const [name, options] of [
  ["reply in an existing thread", { existingThread: true }],
  ["email-out", { sent: true }],
  ["no-reply sender", { email: "no-reply@example.com" }],
]) test(`Gmail route never acknowledges ${name}`, async () => {
  const h = gmailHarness(options)
  assert.equal((await h.run()).status, 200)
  assert.equal(h.effects.sends.length, 0)
})
