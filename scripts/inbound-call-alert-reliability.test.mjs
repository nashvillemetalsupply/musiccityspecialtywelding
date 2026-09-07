import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))
const nativeRequire = createRequire(import.meta.url)
const voiceStatusSource = readFileSync(resolve(root, "app/api/twilio/voice-status/route.ts"), "utf8").replace(/\r\n/g, "\n")

const owner = {
  id: 41,
  email: "owner@example.test",
  name: "Owner",
  signature_name: "Owner",
  role: "owner",
  cell_phone: "+16155550141",
  active: true,
  last_seen_at: null,
  created_at: "2026-09-06T12:00:00.000Z",
  glass_clean_approvals: 0,
  glass_auto_post: false,
}

async function withEnv(values, run) {
  const prior = new Map(Object.keys(values).map((key) => [key, process.env[key]]))
  const RealDate = globalThis.Date
  const fixedNow = RealDate.parse("2026-09-06T18:00:00.000Z")
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]))
    }

    static now() {
      return fixedNow
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await run()
  } finally {
    globalThis.Date = RealDate
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function modulePath(candidate) {
  if (extname(candidate)) return candidate
  for (const extension of [".ts", ".tsx", ".mjs", ".js"]) {
    try {
      readFileSync(`${candidate}${extension}`)
      return `${candidate}${extension}`
    } catch {}
  }
  return candidate
}

function createNotifyHarness({
  sourceIsTest,
  sourceKind = "call.missed",
  pushSent = 0,
  emailMode = "accepted",
  smsConfigured = false,
  smsSucceeds = false,
  operator = owner,
  retryCandidate = null,
  retryContext = null,
  budgetReserved = true,
  coalescedClaimed = true,
}) {
  const sqlCalls = []
  const pushCalls = []
  const smsCalls = []
  const emailCalls = []
  const timeline = []
  const cache = new Map()

  const sql = async (strings, ...values) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim()
    sqlCalls.push({ text, values })
    timeline.push({ kind: "sql", text })
    if (text.includes("SELECT * FROM operators") && text.includes("ORDER BY CASE")) return [operator]
    if (text.includes("SELECT * FROM operators WHERE id =")) return [operator]
    if (text.includes("SELECT id, operator_id, title") && text.includes("FROM notifications")) return retryCandidate ? [retryCandidate] : []
    if (text.includes("AS recipient_role") && text.includes("FROM notifications n")) return retryContext ? [retryContext] : []
    if (text.includes("AS is_test") && text.includes("FROM events e")) return [{ is_test: sourceIsTest, source_kind: sourceKind }]
    if (text.includes("INSERT INTO notifications")) return [{ id: 901 }]
    if (text.includes("SELECT EXISTS(SELECT 1 FROM claim) AS reserved")) return [{ reserved: budgetReserved }]
    if (text.includes("UPDATE notifications SET coalesced = true")) return coalescedClaimed ? [{ id: 901 }] : []
    if (text.includes("provider_email_status = 'sending'") && text.includes("RETURNING id")) return [{ id: 901 }]
    if (text.includes("delivery_status = 'sending'") && text.includes("RETURNING id")) return [{ id: 901 }]
    return []
  }

  class FakeResend {
    constructor(apiKey) {
      assert.equal(apiKey, "test-resend-key")
      this.emails = {
        send: async (payload, options) => {
          emailCalls.push({ payload, options })
          timeline.push({ kind: "email" })
          if (emailMode === "ambiguous") throw new Error("provider response lost")
          if (emailMode === "rejected") return { data: null, error: { message: "provider rejected" } }
          return { data: { id: "email-accepted-901" }, error: null }
        },
      }
    }
  }

  const fakes = new Map([
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/push", {
      sendPushToOperator: async (operatorId, payload) => {
        pushCalls.push({ operatorId, payload })
        return { sent: pushSent, stale: pushSent ? 0 : 1 }
      },
    }],
    ["@/lib/twilio", {
      isDefinitiveTwilioError: () => true,
      sendSms: async (payload) => {
        smsCalls.push(payload)
        if (smsSucceeds) return { sid: "SM-notification-901", status: "queued" }
        throw new Error("SMS provider rejected the alert")
      },
      twilioCallbackUrl: (path) => `https://example.test${path}`,
      twilioSmsConfigured: () => smsConfigured,
    }],
    ["resend", { Resend: FakeResend, default: FakeResend }],
    ["server-only", {}],
  ])

  function load(file) {
    const absolute = modulePath(resolve(file))
    if (cache.has(absolute)) return cache.get(absolute).exports
    const source = readFileSync(absolute, "utf8")
    const output = ts.transpileModule(source, {
      fileName: "module.ts",
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText
    const loadedModule = { exports: {} }
    cache.set(absolute, loadedModule)
    const localRequire = (specifier) => {
      if (fakes.has(specifier)) return fakes.get(specifier)
      if (specifier.startsWith("@/")) return load(resolve(root, specifier.slice(2)))
      if (specifier.startsWith(".")) return load(resolve(dirname(absolute), specifier))
      if (specifier.startsWith("node:")) return nativeRequire(specifier)
      throw new Error(`Unexpected external module in notification regression: ${specifier}`)
    }
    Function("exports", "require", "module", "__filename", "__dirname", output)(
      loadedModule.exports,
      localRequire,
      loadedModule,
      absolute,
      dirname(absolute),
    )
    return loadedModule.exports
  }

  return {
    notifyAll: load(resolve(root, "lib/notify.ts")).notifyAll,
    retryPendingInterrupts: load(resolve(root, "lib/notify.ts")).retryPendingInterrupts,
    sqlCalls,
    pushCalls,
    smsCalls,
    emailCalls,
    timeline,
  }
}

const missedCallAlert = {
  priority: "interrupt",
  stock: "red",
  title: "Missed shop call",
  body: "Call them back. Their job is ready.",
  url: "/ops/leads/73",
  sourceEventId: 7001,
  capExempt: true,
  quietHoursExempt: true,
}

test("the real missed-call route uses the public notification boundary", () => {
  const start = voiceStatusSource.indexOf('if (call && ["no-answer", "busy", "failed", "canceled"].includes(status))')
  const end = voiceStatusSource.indexOf('\n  return twiml("")', start)
  assert.ok(start >= 0 && end > start, "the inbound missed-call branch must exist")
  const missed = voiceStatusSource.slice(start, end)
  assert.match(missed, /await notifyAll\(\{/)
  assert.match(missed, /priority: "interrupt"/)
  assert.match(missed, /title: "Missed shop call"/)
  assert.match(missed, /sourceEventId: eventId/)
})

test("a real inbound-call interrupt has a durable fallback when push is stale and SMS is unavailable", async () => {
  await withEnv({
    RESEND_API_KEY: "test-resend-key",
    QUOTE_FROM_EMAIL: "Shop Brain <alerts@example.test>",
    NEXT_PUBLIC_SITE_URL: "https://musiccityspecialtywelding.com",
  }, async () => {
    const harness = createNotifyHarness({ sourceIsTest: false })

    const results = await harness.notifyAll(missedCallAlert)

    assert.equal(harness.pushCalls.length, 1, "the stale push channel should be attempted")
    assert.equal(harness.smsCalls.length, 0, "disabled/A2P-unavailable SMS is not an acceptable fallback")
    assert.equal(harness.emailCalls.length, 1, "the operator email must receive the fallback alert")
    assert.equal(harness.emailCalls[0].payload.to, owner.email)
    assert.match(harness.emailCalls[0].payload.text, /https:\/\/musiccityspecialtywelding\.com\/ops\/leads\/73/)
    assert.equal(results[0]?.sent, true, "provider acceptance must be reported honestly")
    const marker = harness.timeline.findIndex((item) => item.kind === "sql" && item.text.includes("provider_email_status = 'sending'"))
    const provider = harness.timeline.findIndex((item) => item.kind === "email")
    assert.ok(marker >= 0 && marker < provider, "the durable sending marker must precede the Resend handoff")
    assert.ok(harness.sqlCalls.some(({ text }) => text.includes("provider_email_status") && text.includes("'accepted'")))
    assert.ok(
      harness.sqlCalls.some(({ text }) => text.includes("delivery_status") && text.includes("'accepted'")),
      "the durable notification intent must record fallback provider acceptance",
    )
  })
})

test("an internal-test inbound call never crosses a production alert provider", async () => {
  await withEnv({}, async () => {
    const harness = createNotifyHarness({ sourceIsTest: true })

    const results = await harness.notifyAll(missedCallAlert)

    assert.equal(results[0]?.reason, "internal-test")
    assert.equal(harness.pushCalls.length, 0)
    assert.equal(harness.smsCalls.length, 0)
    assert.equal(harness.emailCalls.length, 0)
    assert.equal(harness.sqlCalls.filter(({ text }) => text.includes("INSERT INTO notifications")).length, 0)
  })
})

test("a retry of a persisted inbound-call interrupt uses the same email fallback", async () => {
  await withEnv({ RESEND_API_KEY: "test-resend-key", QUOTE_FROM_EMAIL: "Shop Brain <alerts@example.test>" }, async () => {
    const harness = createNotifyHarness({
    sourceIsTest: false,
    retryCandidate: {
      id: 901,
      operator_id: owner.id,
      title: missedCallAlert.title,
      body: missedCallAlert.body,
      url: missedCallAlert.url,
      budget_exempt: true,
      quiet_hours_exempt: true,
      sms_fallback: false,
      sms_only: false,
    },
    retryContext: {
      operator_id: owner.id,
      email: owner.email,
      recipient_role: "owner",
      owner_only: false,
      source_kind: "call.missed",
      is_test: false,
    },
  })

    const result = await harness.retryPendingInterrupts()

    assert.equal(harness.emailCalls.length, 1)
    assert.equal(harness.emailCalls[0].options.idempotencyKey, "notification-alert:901")
    assert.equal(result.sent, 1)
  })
})

test("a bounced email retry skips Resend and falls through to SMS", async () => {
  await withEnv({ RESEND_API_KEY: "test-resend-key", QUOTE_FROM_EMAIL: "Shop Brain <alerts@example.test>" }, async () => {
    const harness = createNotifyHarness({
      sourceIsTest: false,
      smsConfigured: true,
      smsSucceeds: true,
      retryCandidate: {
        id: 901,
        operator_id: owner.id,
        title: missedCallAlert.title,
        body: missedCallAlert.body,
        url: missedCallAlert.url,
        budget_exempt: true,
        quiet_hours_exempt: true,
        sms_fallback: true,
        sms_only: false,
        provider_email_id: "email-accepted-901",
        provider_email_status: "email.bounced",
      },
      retryContext: {
        operator_id: owner.id,
        email: owner.email,
        recipient_role: "owner",
        owner_only: false,
        source_kind: "call.missed",
        is_test: false,
      },
    })

    const result = await harness.retryPendingInterrupts()

    assert.equal(harness.emailCalls.length, 0)
    assert.equal(harness.smsCalls.length, 1)
    assert.equal(result.sent, 1)
  })
})

test("an interrupted email handoff is replayed with the same idempotency key", async () => {
  await withEnv({ RESEND_API_KEY: "test-resend-key", QUOTE_FROM_EMAIL: "Shop Brain <alerts@example.test>" }, async () => {
    const harness = createNotifyHarness({
      sourceIsTest: false,
      retryCandidate: {
        id: 901,
        operator_id: owner.id,
        title: missedCallAlert.title,
        body: missedCallAlert.body,
        url: missedCallAlert.url,
        budget_exempt: true,
        quiet_hours_exempt: true,
        sms_fallback: true,
        sms_only: false,
        provider_email_id: null,
        provider_email_status: "sending",
      },
      retryContext: {
        operator_id: owner.id,
        email: owner.email,
        recipient_role: "owner",
        owner_only: false,
        source_kind: "call.missed",
        is_test: false,
      },
    })

    const result = await harness.retryPendingInterrupts()

    assert.equal(harness.emailCalls.length, 1)
    assert.equal(harness.emailCalls[0].options.idempotencyKey, "notification-alert:901")
    assert.equal(result.sent, 1)
    assert.ok(harness.sqlCalls.some(({ text }) => text.includes("replaying the same idempotent request")))
  })
})

test("healthy push skips email, while ambiguous email is replayed idempotently before SMS", async () => {
  await withEnv({ RESEND_API_KEY: "test-resend-key", QUOTE_FROM_EMAIL: "Shop Brain <alerts@example.test>" }, async () => {
    const healthy = createNotifyHarness({ sourceIsTest: false, pushSent: 1 })
    const healthyResult = await healthy.notifyAll(missedCallAlert)
    assert.equal(healthyResult[0]?.sent, true)
    assert.equal(healthy.emailCalls.length, 0)

    const ambiguous = createNotifyHarness({ sourceIsTest: false, emailMode: "ambiguous", smsConfigured: true, smsSucceeds: true })
    const ambiguousResult = await ambiguous.notifyAll({ ...missedCallAlert, smsFallback: true })
    assert.equal(ambiguousResult[0]?.reason, "delivery-unknown")
    assert.equal(ambiguous.smsCalls.length, 0)
    assert.ok(ambiguous.sqlCalls.some(({ text }) => text.includes("delivery_status = 'retry'")))
  })
})

test("definitive email rejection can use SMS, and cap coalescing uses the same email fallback", async () => {
  await withEnv({ RESEND_API_KEY: "test-resend-key", QUOTE_FROM_EMAIL: "Shop Brain <alerts@example.test>" }, async () => {
    const rejected = createNotifyHarness({ sourceIsTest: false, emailMode: "rejected", smsConfigured: true, smsSucceeds: true })
    const rejectedResult = await rejected.notifyAll({ ...missedCallAlert, smsFallback: true })
    assert.equal(rejected.emailCalls.length, 1)
    assert.equal(rejected.smsCalls.length, 1)
    assert.equal(rejectedResult[0]?.sent, true)

    const coalesced = createNotifyHarness({ sourceIsTest: false, budgetReserved: false })
    const coalescedResult = await coalesced.notifyAll({ ...missedCallAlert, capExempt: false })
    assert.equal(coalescedResult[0]?.reason, "daily-cap")
    assert.equal(coalesced.emailCalls.length, 1)
    assert.ok(coalesced.sqlCalls.some(({ text }) => text.includes("provider_email_id")))
  })
})

test("retry revalidates internal-test and owner-role gates before any provider", async () => {
  await withEnv({}, async () => {
    const candidate = {
    id: 901,
    operator_id: owner.id,
    title: missedCallAlert.title,
    body: missedCallAlert.body,
    url: missedCallAlert.url,
    budget_exempt: true,
    quiet_hours_exempt: true,
    sms_fallback: false,
    sms_only: false,
  }
    for (const retryContext of [
      { operator_id: owner.id, email: owner.email, recipient_role: "owner", owner_only: false, source_kind: "call.missed", is_test: true },
      { operator_id: owner.id, email: owner.email, recipient_role: "crew", owner_only: true, source_kind: "call.missed", is_test: false },
    ]) {
      const harness = createNotifyHarness({ sourceIsTest: false, retryCandidate: candidate, retryContext })
      await harness.retryPendingInterrupts()
      assert.equal(harness.pushCalls.length, 0)
      assert.equal(harness.smsCalls.length, 0)
      assert.equal(harness.emailCalls.length, 0)
    }
  })
})
