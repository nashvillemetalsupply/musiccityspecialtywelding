import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { sendEmailWithProviderTruth, isDefinitiveEmailProviderError } from "../lib/email-provider-truth.ts"
import { stripAssistantMoney } from "../lib/assistant/money.ts"

const sessionId = "126e8815-0502-4f7d-94a5-0df870ac6b46"
const baseInput = {
  eventId: 201, sessionId, reason: "human", leadId: 41, isTest: false,
  transcript: "Customer: Gate repair, 48 inches, budget $300. Call 615-555-0199.\nAssistant: What needs repair?\nCustomer: I want a human.",
}

function harness({ env: overrides = {}, sourceTest = false, missingSource = false, provider = "accepted", intentFailure = false, receiptFailure = false } = {}) {
  const env = { RESEND_API_KEY: "synthetic-key", QUOTE_FROM_EMAIL: "Shop <shop@example.test>", ...overrides }
  const events = new Map()
  const sends = []
  const queries = []
  const order = []
  const sql = async (strings, ...values) => {
    values.forEach((_, index) => assert.match(strings[index + 1], /^::(?:uuid|bigint|text)/, "SQL parameters need explicit casts"))
    queries.push({ text: strings.join(" ? "), values })
    if (missingSource) return []
    if (strings.join(" ").includes("SELECT intent.id")) {
      const intents = [...events.values()].filter((event) => event.kind === "email.out"
        && event.detail.sessionId === values[0] && event.detail.reason === values[1])
      const latest = intents.at(-1)
      if (!latest) return []
      const receipts = [...events.values()].filter((event) => event.detail.sourceEventId === latest.id)
      return [{ id: latest.id, attempts: intents.length,
        accepted: receipts.some((event) => event.kind === "email.accepted"),
        failed: receipts.some((event) => event.kind === "email.failed" && event.detail.ambiguous === false) }]
    }
    return [{ lead_id: baseInput.leadId, person_id: 17, is_test: sourceTest }]
  }
  const recordEvent = async (event) => {
    if (intentFailure && event.kind === "email.out") throw new Error("Intent unavailable")
    if (receiptFailure && event.kind !== "email.out") throw new Error("Receipt unavailable")
    const key = `${event.kind}:${event.externalId}`
    if (events.has(key)) return null
    const id = events.size + 1
    events.set(key, { ...event, id })
    order.push(event.kind)
    return id
  }
  class Resend {
    emails = { send: async (payload, options) => {
      assert.equal(order.at(-1), "email.out", "persisted intent must precede provider submission")
      const intent = events.get(`email.out:${options.idempotencyKey}`)
      assert.equal(intent.body, payload.text)
      assert.equal(intent.detail.to, payload.to)
      assert.equal(intent.detail.from, payload.from)
      assert.equal(intent.detail.subject, payload.subject)
      sends.push({ payload, options })
      order.push("provider")
      if (provider === "lost") throw new Error("Response was lost")
      if (provider === "rejected") return { error: { message: "Recipient rejected" } }
      if (provider === "empty") return { data: {} }
      return { data: { id: "resend-assistant-fixture-1" } }
    } }
  }
  const fakes = new Map([
    ["@/lib/db", { getSql: () => sql }], ["resend", { Resend }],
    ["@/lib/events", { recordEvent }], ["./assistant/money.ts", { stripAssistantMoney }],
    ["@/lib/operators", {}], ["@/lib/push", {}], ["@/lib/twilio", {}],
    ["@/lib/email-provider-truth.ts", { sendEmailWithProviderTruth, isDefinitiveEmailProviderError }],
    ["@/lib/shop-brain-invariants.ts", {}], ["@/lib/pagination", {}],
    ["@/lib/visibility", {}], ["@/lib/alert-failure-classifier.mjs", {}],
  ])
  const source = readFileSync(new URL("../lib/notify.ts", import.meta.url), "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  const context = vm.createContext({ process: { env }, console, Error, Date, URL })
  vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, (name) => {
    if (fakes.has(name)) return fakes.get(name)
    throw new Error(`Unexpected assistant email import: ${name}`)
  }, loaded)
  return { events, sends, queries, order, env, setProvider: (value) => { provider = value },
    send: (changes = {}) => loaded.exports.emailAssistantTranscript({ ...baseInput, ...changes }) }
}

test("handoff transcript goes to Sales once per session and reason, after a durable intent", async () => {
  const h = harness()
  await h.send()
  await h.send()
  assert.equal(h.sends.length, 1)
  const { payload, options } = h.sends[0]
  assert.equal(payload.to, "Sales@musiccityspecialtywelding.com")
  assert.equal(options.idempotencyKey, `assistant-transcript:${sessionId}:human`)
  assert.doesNotMatch(payload.text, /\$300/)
  assert.match(payload.text, /48 inches/)
  assert.match(payload.text, /615-555-0199/)
  assert.match(payload.text, /Customer: I want a human/)
  assert.match(payload.text, /\nAssistant:/)
  assert.deepEqual(h.order, ["email.out", "provider", "email.accepted"])
  const intent = [...h.events.values()].find((event) => event.kind === "email.out")
  const receipt = [...h.events.values()].find((event) => event.kind === "email.accepted")
  assert.equal(intent.detail.handoffEventId, baseInput.eventId)
  assert.equal(intent.detail.audience, "assistant-shop", "transcript delivery must not overwrite the quote owner-email status")
  assert.equal(receipt.detail.sourceEventId, intent.id)
  assert.equal(receipt.detail.providerEmailId, "resend-assistant-fixture-1")
})

test("different handoff reasons have independent claims, while concurrent replay has one send", async () => {
  const h = harness()
  await Promise.all([h.send(), h.send()])
  await h.send({ reason: "model-error" })
  assert.equal(h.sends.length, 2)
  assert.deepEqual(h.sends.map((send) => send.options.idempotencyKey), [
    `assistant-transcript:${sessionId}:human`, `assistant-transcript:${sessionId}:model-error`,
  ])
})

test("full transcript is not truncated to the bounded operator notification body", async () => {
  const h = harness()
  const transcript = `Customer: ${"48 inch gate. ".repeat(200)}\nCustomer: End of transcript.`
  await h.send({ transcript })
  assert.ok(h.sends[0].payload.text.length > 2500)
  assert.ok(h.sends[0].payload.text.endsWith("Customer: End of transcript."))
})

for (const [name, options, input] of [
  ["explicit is_test", {}, { isTest: true }],
  ["transcript marker", {}, { transcript: "[INTERNAL TEST] customer request" }],
  ["source session/event/lead/person test", { sourceTest: true }, {}],
  ["missing source receipt", { missingSource: true }, {}],
  ["missing API key", { env: { RESEND_API_KEY: "" } }, {}],
  ["missing sender", { env: { QUOTE_FROM_EMAIL: "" } }, {}],
]) test(`${name} never claims or sends transcript email`, async () => {
  const h = harness(options)
  await h.send(input)
  assert.equal(h.sends.length, 0)
  assert.equal(h.events.size, 0)
})

test("missing configuration preserves recovery eligibility instead of consuming the email claim", async () => {
  const h = harness({ env: { RESEND_API_KEY: "" } })
  await h.send()
  h.env.RESEND_API_KEY = "synthetic-key"
  await h.send()
  await h.send()
  assert.equal(h.sends.length, 1)
})

for (const [provider, kind] of [["lost", "email.unknown"], ["empty", "email.unknown"]]) {
  test(`${provider} provider outcome records truth and replay never resends`, async () => {
    const h = harness({ provider })
    await h.send()
    await h.send()
    assert.equal(h.sends.length, 1)
    const receipt = [...h.events.values()].find((event) => event.kind === kind)
    assert.equal(receipt.detail.sourceEventId, 1)
    assert.equal(receipt.detail.ambiguous, kind === "email.unknown")
  })
}

test("definitive rejection retries through at most three immutable intents and can recover after provider repair", async () => {
  const failed = harness({ provider: "rejected" })
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(await failed.send(), "failed")
  assert.equal(failed.sends.length, 3)
  assert.deepEqual(failed.sends.map((send) => send.options.idempotencyKey), [
    `assistant-transcript:${sessionId}:human`,
    `assistant-transcript:${sessionId}:human:retry-1`,
    `assistant-transcript:${sessionId}:human:retry-2`,
  ])
  const recovered = harness({ provider: "rejected" })
  assert.equal(await recovered.send(), "failed")
  recovered.setProvider("accepted")
  assert.equal(await recovered.send(), "accepted")
  assert.equal(await recovered.send(), "accepted")
  assert.equal(recovered.sends.length, 2)
  const uncertainRetry = harness({ provider: "rejected" })
  assert.equal(await uncertainRetry.send(), "failed")
  uncertainRetry.setProvider("lost")
  assert.equal(await uncertainRetry.send(), "unknown")
  assert.equal(await uncertainRetry.send(), "unknown")
  assert.equal(uncertainRetry.sends.length, 2, "an earlier definitive rejection cannot reopen a later ambiguous attempt")
})

test("unavailable or ambiguous email returns an explicit status for the independent shop phone alert", async () => {
  assert.equal(await harness({ env: { RESEND_API_KEY: "" } }).send(), "unavailable")
  const ambiguous = harness({ provider: "lost" })
  assert.equal(await ambiguous.send(), "unknown")
  assert.equal(await ambiguous.send(), "unknown")
  assert.equal(ambiguous.sends.length, 1)
})

test("an unavailable intent prevents provider submission and an unavailable receipt never causes a replay", async () => {
  const failedIntent = harness({ intentFailure: true })
  await assert.rejects(failedIntent.send(), /Intent unavailable/)
  assert.equal(failedIntent.sends.length, 0)
  const failedReceipt = harness({ receiptFailure: true })
  await assert.rejects(failedReceipt.send(), /Receipt unavailable/)
  await failedReceipt.send()
  assert.equal(failedReceipt.sends.length, 1)
})

test("source validation includes every sticky test partition and receipt/session association", async () => {
  const h = harness()
  await h.send()
  const query = h.queries[0]
  for (const marker of ["e.is_test", "s.is_test", "el.is_test", "ep.is_test", "elp.is_test", "sl.is_test", "slp.is_test", "t.is_test", "t.inbound", "t.result::text", "e.detail->>'isTest'", "e.detail->>'sessionId'", "e.lead_id IS NOT DISTINCT FROM"]) {
    assert.ok(query.text.includes(marker), marker)
  }
  assert.deepEqual(query.values, [sessionId, baseInput.eventId, sessionId, baseInput.leadId])
})

test("signed assistant inbox bounces and delays alert the shop phone even without a customer lead", async () => {
  for (const [leadId, isTest, ownerConfigured = true] of [[null, false], [41, false], [null, true], [41, true], [null, false, false]]) {
    for (const type of ["email.bounced", "email.delivery_delayed", "email.delivered"]) {
      const alerts = new Map()
      const events = new Map()
      const queries = []
      const sql = async (strings, ...values) => {
        values.forEach((_, index) => assert.match(strings[index + 1], /^::\w+/))
        const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
        queries.push(query)
        if (query.includes("FROM notifications")) return []
        if (query.includes("FROM events accepted_event")) return [{ lead_id: leadId, person_id: 17,
          detail: { sourceEventId: 201 }, audience: "assistant-shop", is_test: isTest }]
        if (query.startsWith("SELECT id FROM events")) return [{ id: 301 }]
        if (query.startsWith("SELECT is_test FROM leads")) return [{ is_test: isTest }]
        throw new Error(`Unexpected webhook SQL: ${query}`)
      }
      const fakes = new Map([
        ["resend", { Resend: class { webhooks = { verify: ({ payload, headers }) => {
          if (headers.signature !== "valid") throw new Error("Invalid signature")
          return JSON.parse(payload)
        } } } }],
        ["@/lib/db", { getSql: () => sql }],
        ["@/lib/events", { recordEvent: async (value) => {
          const key = `${value.kind}:${value.externalId}`
          if (events.has(key)) return null
          events.set(key, value); return 301
        } }],
        ["@/lib/notify", { notifyAll: async () => {}, notifyOwnerCellSms: async (value) => {
          if (!ownerConfigured) return { id: 0, sent: false, reason: "not-for-role" }
          alerts.set(value.dedupeKey, value)
          return { id: 1, sent: true, reason: "sent" }
        } }],
      ])
      const source = readFileSync(new URL("../app/api/resend/webhook/route.ts", import.meta.url), "utf8")
      const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
      const loaded = { exports: {} }
      const context = vm.createContext({ process: { env: { RESEND_WEBHOOK_SECRET: "synthetic" } }, Response })
      vm.runInContext(`(function(exports,require,module){${output}\n})`, context)(loaded.exports, (name) => fakes.get(name), loaded)
      const request = (signature = "valid") => new Request("https://example.test/api/resend/webhook", { method: "POST",
        headers: { "svix-signature": signature }, body: JSON.stringify({ type, data: { email_id: "email-fixture", bounce: { message: "rejected" } } }) })
      assert.equal((await loaded.exports.POST(request("invalid"))).status, 403)
      assert.equal(queries.length, 0)
      const expectedStatus = !ownerConfigured && type !== "email.delivered" ? 503 : 200
      assert.equal((await loaded.exports.POST(request())).status, expectedStatus)
      assert.equal((await loaded.exports.POST(request())).status, expectedStatus)
      const shouldAlert = ownerConfigured && !isTest && type !== "email.delivered"
      assert.equal(alerts.size, shouldAlert ? 1 : 0)
      if (shouldAlert) {
        const alert = [...alerts.values()][0]
        assert.equal(alert.capExempt, true)
        assert.equal(alert.quietHoursExempt, true)
        assert.match(alert.url, leadId ? /\/ops\/leads\/41/ : /receipt=201/)
      }
    }
  }
})
