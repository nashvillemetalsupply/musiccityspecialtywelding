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

async function withEnv(values, run, fixedTime = "2026-09-06T18:00:00.000Z") {
  const configuredValues = { VERCEL_ENV: "production", ...values }
  const prior = new Map(Object.keys(configuredValues).map((key) => [key, process.env[key]]))
  const RealDate = globalThis.Date
  const fixedNow = RealDate.parse(fixedTime)
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]))
    }

    static now() {
      return fixedNow
    }
  }
  for (const [key, value] of Object.entries(configuredValues)) {
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

async function loadStandaloneTs(relativePath) {
  const absolute = resolve(root, relativePath)
  const source = readFileSync(absolute, "utf8")
  const output = ts.transpileModule(source, {
    fileName: absolute,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const loadedModule = { exports: {} }
  const aiUsage = await import("../lib/ai-usage.mjs")
  const localRequire = (specifier) => {
    if (specifier === "@/lib/db") return { getSql: () => async () => [] }
    if (specifier === "@/lib/ai-usage.mjs") return aiUsage
    return nativeRequire(specifier)
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

async function withFakeProviderFetch(run) {
  const originalFetch = globalThis.fetch
  const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
  const durations = []
  const calls = []
  const signal = new AbortController().signal
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    writable: true,
    value: (milliseconds) => {
      durations.push(milliseconds)
      return signal
    },
  })
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({
      sid: "SM-test-123",
      status: "queued",
      choices: [{ message: { content: "{\"ok\":true}" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  try {
    return await run({ durations, calls, signal })
  } finally {
    globalThis.fetch = originalFetch
    if (timeoutDescriptor) Object.defineProperty(AbortSignal, "timeout", timeoutDescriptor)
  }
}

function createNotifyHarness({
  sourceIsTest,
  sourceKind = "call.missed",
  pushSent = 0,
  emailMode = "accepted",
  smsConfigured = false,
  smsSucceeds = false,
  smsOutcomes = null,
  smsDefinitive = true,
  smsErrorPayload = { code: 30003, message: "Unreachable test destination" },
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

  class FakeTwilioProviderError extends Error {
    constructor(message, definitive, providerPayload = null) {
      super(message)
      this.name = "TwilioProviderError"
      this.definitive = definitive
      this.providerPayload = providerPayload
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
      TwilioProviderError: FakeTwilioProviderError,
      isDefinitiveTwilioError: (error) => error instanceof FakeTwilioProviderError && error.definitive,
      sendSms: async (payload) => {
        smsCalls.push(payload)
        timeline.push({ kind: "sms" })
        const outcome = smsOutcomes?.[smsCalls.length - 1] ?? (smsSucceeds ? "accepted" : "failed")
        if (outcome === "accepted") return { sid: `SM-notification-${smsCalls.length}`, status: "queued" }
        throw new FakeTwilioProviderError("SMS provider rejected the alert", smsDefinitive, smsErrorPayload)
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

async function withFastSmsRetry(run) {
  const realSetTimeout = globalThis.setTimeout
  const delays = []
  globalThis.setTimeout = (callback, delay, ...args) => {
    delays.push(delay)
    return realSetTimeout(callback, 0, ...args)
  }
  try {
    return await run(delays)
  } finally {
    globalThis.setTimeout = realSetTimeout
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

test("production notify honors an explicit test flag without a source event", async () => {
  await withEnv({}, async () => {
    const harness = createNotifyHarness({ sourceIsTest: false })
    const results = await harness.notifyAll({ ...missedCallAlert, sourceEventId: null, isTest: true })

    assert.equal(results[0]?.reason, "internal-test")
    assert.equal(harness.sqlCalls.filter(({ text }) => text.includes("INSERT INTO notifications")).length, 0)
    assert.equal(harness.pushCalls.length, 0)
    assert.equal(harness.smsCalls.length, 0)
    assert.equal(harness.emailCalls.length, 0)
  })
})

test("preview notify persists isTest and stops before any real alert provider", async () => {
  await withEnv({ VERCEL_ENV: "preview" }, async () => {
    const harness = createNotifyHarness({ sourceIsTest: false, smsConfigured: true, pushSent: 1 })
    const results = await harness.notifyAll({ ...missedCallAlert, sourceEventId: null, smsOnly: true })
    const insert = harness.sqlCalls.find(({ text }) => text.includes("INSERT INTO notifications"))
    const detail = JSON.parse(insert.values[10])

    assert.equal(results[0]?.reason, "internal-test")
    assert.equal(detail.isTest, true)
    assert.match(insert.values[3], /^\[INTERNAL TEST\]/)
    assert.match(insert.values[4], /^\[INTERNAL TEST\]/)
    assert.equal(insert.values[12], "filed")
    assert.equal(harness.pushCalls.length, 0)
    assert.equal(harness.smsCalls.length, 0)
    assert.equal(harness.emailCalls.length, 0)
  })
})

test("MCSW_TEST_SMS_FAIL runs only fake inline attempts on a preview", async () => {
  await withEnv({ VERCEL_ENV: "preview", MCSW_TEST_SMS_FAIL: "1" }, async () => withFastSmsRetry(async (delays) => {
    const harness = createNotifyHarness({ sourceIsTest: false, smsConfigured: false })
    const results = await harness.notifyAll({
      ...missedCallAlert,
      sourceEventId: null,
      smsOnly: true,
      ownerOnly: true,
      capExempt: true,
      quietHoursExempt: true,
    })
    const insert = harness.sqlCalls.find(({ text }) => text.includes("INSERT INTO notifications"))

    assert.equal(JSON.parse(insert.values[10]).isTest, true)
    assert.equal(insert.values[12], "pending")
    assert.equal(harness.smsCalls.length, 2)
    assert.deepEqual(delays, [2_000])
    assert.equal(harness.pushCalls.length, 0)
    assert.equal(harness.emailCalls.length, 0)
    assert.equal(results[0]?.sent, false)
    assert.ok(harness.sqlCalls.some(({ text, values }) =>
      text.includes("delivery_next_attempt_at = CASE") && values.includes(true)),
    "the simulated failure must be due immediately for recovery")
  }))
})

test("Gmail dead-letter events carry their test partition into notification checks", () => {
  const gmail = readFileSync(resolve(root, "app/api/ingest/gmail/route.ts"), "utf8")
  assert.match(gmail, /let isTest = false[\s\S]*?isTest = `\$\{subject\}\\n\$\{body\}`\.includes\("\[INTERNAL TEST\]"\)/)
  const deadLetter = gmail.slice(gmail.indexOf('kind: "email.ingest-dead-letter"'))
  assert.match(deadLetter, /\$\{isTest \? "\[INTERNAL TEST\] " : ""\}/)
  assert.match(deadLetter, /detail: \{ messageId: id, error: message, isTest \}/)
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

test("a definitive owner-cell SMS failure retries once after two seconds and parks for the next sweep", async () => {
  await withEnv({ VERCEL_ENV: "production" }, async () => withFastSmsRetry(async (delays) => {
    const harness = createNotifyHarness({ sourceIsTest: false, smsConfigured: true, smsSucceeds: false })
    const result = await harness.notifyAll({ ...missedCallAlert, smsOnly: true })

    assert.equal(harness.smsCalls.length, 2)
    assert.deepEqual(delays, [2_000])
    assert.equal(result[0]?.sent, false)
    assert.ok(harness.sqlCalls.some(({ text, values }) =>
      text.includes("delivery_next_attempt_at = CASE") && values.includes(true)),
    "a definitive SMS rejection must be due immediately for the next recovery pass")
  }))
})

test("sms_only sends email only after both definitive SMS attempts fail", async () => {
  await withEnv({
    RESEND_API_KEY: "test-resend-key",
    QUOTE_FROM_EMAIL: "Shop Brain <alerts@example.test>",
  }, async () => withFastSmsRetry(async (delays) => {
    const harness = createNotifyHarness({
      sourceIsTest: false,
      sourceKind: "sms.inbound",
      smsConfigured: true,
      smsOutcomes: ["failed", "failed"],
    })
    const result = await harness.notifyAll({ ...missedCallAlert, smsOnly: true })
    const providerOrder = harness.timeline.filter(({ kind }) => kind === "sms" || kind === "email").map(({ kind }) => kind)

    assert.deepEqual(providerOrder, ["sms", "sms", "email"])
    assert.deepEqual(delays, [2_000])
    assert.equal(harness.pushCalls.length, 0)
    assert.equal(harness.emailCalls[0].options.idempotencyKey, "notification-alert:901")
    assert.equal(result[0]?.sent, true)
    assert.ok(harness.sqlCalls.some(({ text }) => text.includes("provider_email_status") && text.includes("'accepted'")))
  }))
})

test("sms_only does not email or retry another channel after an ambiguous SMS result", async () => {
  await withEnv({
    RESEND_API_KEY: "test-resend-key",
    QUOTE_FROM_EMAIL: "Shop Brain <alerts@example.test>",
  }, async () => {
    const harness = createNotifyHarness({ sourceIsTest: false, smsConfigured: true, smsDefinitive: false })
    const result = await harness.notifyAll({ ...missedCallAlert, smsOnly: true })

    assert.equal(result[0]?.reason, "delivery-unknown")
    assert.equal(harness.smsCalls.length, 1)
    assert.equal(harness.emailCalls.length, 0)
    assert.equal(harness.pushCalls.length, 0)
  })
})

test("sms_only retries replay an uncertain email handoff before sending SMS", async () => {
  await withEnv({
    RESEND_API_KEY: "test-resend-key",
    QUOTE_FROM_EMAIL: "Shop Brain <alerts@example.test>",
  }, async () => {
    const harness = createNotifyHarness({
      sourceIsTest: false,
      smsConfigured: true,
      smsSucceeds: true,
      emailMode: "ambiguous",
      retryCandidate: {
        id: 901,
        operator_id: owner.id,
        title: missedCallAlert.title,
        body: missedCallAlert.body,
        url: missedCallAlert.url,
        budget_exempt: true,
        quiet_hours_exempt: true,
        sms_fallback: false,
        sms_only: true,
        provider_email_id: null,
        provider_email_status: "sending",
      },
      retryContext: {
        operator_id: owner.id,
        email: owner.email,
        recipient_role: "owner",
        owner_only: true,
        source_kind: "sms.inbound",
        is_test: false,
      },
    })
    const result = await harness.retryPendingInterrupts()

    assert.equal(result.sent, 0)
    assert.equal(harness.emailCalls.length, 1)
    assert.equal(harness.emailCalls[0].options.idempotencyKey, "notification-alert:901")
    assert.equal(harness.smsCalls.length, 0)
  })
})

test("quiet-hours interrupts persist for the next 06:30 Central window", async () => {
  for (const fixedTime of ["2026-09-06T08:00:00.000Z", "2026-09-07T02:00:00.000Z"]) {
    await withEnv({}, async () => {
      const harness = createNotifyHarness({ sourceIsTest: false })
      const result = await harness.notifyAll({ ...missedCallAlert, quietHoursExempt: false })
      const schedule = harness.sqlCalls.find(({ text }) => text.includes("delivery_status = 'retry'")
        && text.includes("delivery_next_attempt_at = (") )

      assert.equal(result[0]?.reason, "quiet-hours")
      assert.match(schedule.text, /timezone\('America\/Chicago', now\(\)\)::time < time '06:30'/)
      assert.match(schedule.text, /ELSE interval '1 day 6 hours 30 minutes'/)
      assert.equal(harness.pushCalls.length, 0)
      assert.equal(harness.smsCalls.length, 0)
      assert.equal(harness.emailCalls.length, 0)
    }, fixedTime)
  }
})

test("the recovery sweep sends due quiet-hours interrupts when Central time opens", async () => {
  const quietCandidate = {
    id: 901,
    operator_id: owner.id,
    title: missedCallAlert.title,
    body: missedCallAlert.body,
    url: missedCallAlert.url,
    budget_exempt: true,
    quiet_hours_exempt: false,
    sms_fallback: false,
    sms_only: false,
    provider_email_id: null,
    provider_email_status: null,
  }
  const quietContext = {
    operator_id: owner.id,
    email: owner.email,
    recipient_role: "owner",
    owner_only: false,
    source_kind: "call.missed",
    is_test: false,
  }
  const beforeOpen = createNotifyHarness({
    sourceIsTest: false,
    pushSent: 1,
    retryCandidate: quietCandidate,
    retryContext: quietContext,
  })
  await withEnv({}, () => beforeOpen.retryPendingInterrupts(), "2026-09-06T11:29:00.000Z")
  assert.equal(beforeOpen.pushCalls.length, 0, "the sweep must hold alerts until 06:30 Central")
  assert.equal(beforeOpen.sqlCalls.some(({ text }) => text.includes("delivery_attempts = delivery_attempts + 1")), false)

  const atOpen = createNotifyHarness({
    sourceIsTest: false,
    pushSent: 1,
    retryCandidate: quietCandidate,
    retryContext: quietContext,
  })
  const result = await withEnv({}, () => atOpen.retryPendingInterrupts(), "2026-09-06T11:30:00.000Z")
  assert.equal(atOpen.pushCalls.length, 1)
  assert.equal(result.sent, 1)
  const recovery = readFileSync(resolve(root, "lib/recovery-sweep.ts"), "utf8")
  assert.match(recovery, /detail\.interruptDeliveryRetries = await retryPendingInterrupts\(\)/)
})

test("an ambiguous Twilio result is quarantined without an inline repeat", async () => {
  await withEnv({ VERCEL_ENV: "production" }, async () => withFastSmsRetry(async (delays) => {
    const harness = createNotifyHarness({ sourceIsTest: false, smsConfigured: true, smsDefinitive: false })
    const result = await harness.notifyAll({ ...missedCallAlert, smsOnly: true })

    assert.equal(harness.smsCalls.length, 1)
    assert.deepEqual(delays, [])
    assert.equal(result[0]?.reason, "delivery-unknown")
    assert.ok(harness.sqlCalls.some(({ text }) => text.includes("delivery_status = 'unknown'")))
  }))
})

test("SMS retry history appends the rejected Twilio payload and the accepted receipt", async () => {
  await withEnv({ VERCEL_ENV: "production" }, async () => withFastSmsRetry(async () => {
    const harness = createNotifyHarness({
      sourceIsTest: false,
      smsConfigured: true,
      smsOutcomes: ["failed", "accepted"],
      retryCandidate: {
        id: 901,
        operator_id: owner.id,
        title: missedCallAlert.title,
        body: missedCallAlert.body,
        url: missedCallAlert.url,
        budget_exempt: true,
        quiet_hours_exempt: true,
        sms_fallback: false,
        sms_only: true,
        provider_email_id: null,
        provider_email_status: null,
      },
      retryContext: {
        operator_id: owner.id,
        email: owner.email,
        recipient_role: "owner",
        owner_only: true,
        source_kind: "call.missed",
        is_test: false,
      },
    })

    const result = await harness.retryPendingInterrupts()
    const historyWrites = harness.sqlCalls.filter(({ text }) => text.includes("delivery_history = COALESCE"))
    const history = historyWrites.map(({ text, values }) => {
      assert.match(text, /COALESCE\(delivery_history, '\[\]'::jsonb\) \|\|/)
      const encoded = values.find((value) => typeof value === "string" && value.startsWith("[{\"provider\""))
      return JSON.parse(encoded)[0]
    })

    assert.equal(result.sent, 1)
    assert.equal(harness.smsCalls.length, 2)
    assert.equal(history.length, 2)
    assert.equal(history[0].outcome, "failed")
    assert.match(history[0].error, /SMS provider rejected the alert/)
    assert.deepEqual(history[0].payload, { code: 30003, message: "Unreachable test destination" })
    assert.equal(history[1].outcome, "accepted")
    assert.deepEqual(history[1].payload, { sid: "SM-notification-2", status: "queued" })
    assert.ok(harness.sqlCalls.some(({ text }) => text.includes("provider_message_sid = COALESCE")))
    const claim = harness.sqlCalls.find(({ text }) => text.includes("delivery_status = 'sending'") && text.includes("delivery_attempts = delivery_attempts + 1"))
    assert.doesNotMatch(claim.text, /delivery_error\s*=\s*''/)

    const migration = readFileSync(resolve(root, "scripts/migrate.mjs"), "utf8")
    assert.match(migration, /ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_history JSONB NOT NULL DEFAULT '\[\]'::jsonb/)
  }))
})

test("a Twilio-triggered recovery pass bypasses only the ten-minute cooldown", () => {
  const voiceStatus = readFileSync(resolve(root, "app/api/twilio/voice-status/route.ts"), "utf8")
  const smsRoute = readFileSync(resolve(root, "app/api/twilio/sms/route.ts"), "utf8")
  const recovery = readFileSync(resolve(root, "lib/recovery-sweep.ts"), "utf8")
  assert.match(voiceStatus, /runRecoverySweep\(\{ trigger: "twilio-call", force: true \}\)/)
  assert.match(smsRoute, /runRecoverySweep\(\{ trigger: "twilio-sms", force: true \}\)/)
  assert.match(recovery, /WHERE automation_leases\.lease_expires_at <= now\(\)/)
  assert.match(recovery, /\$\{force\}::boolean OR automation_leases\.last_finished_at/)
})

test("Twilio, DeepSeek, and weather fetches use bounded abort signals", async () => {
  await withEnv({
    TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
    TWILIO_AUTH_TOKEN: "fake-auth-token",
    TWILIO_MESSAGING_SERVICE_SID: `MG${"b".repeat(32)}`,
    TWILIO_PHONE_NUMBER: "+16155550100",
    TWILIO_SMS_ENABLED: "true",
    TWILIO_WEBHOOK_BASE_URL: "https://example.test",
    DEEPSEEK_API_KEY: "fake-deepseek-key",
  }, async () => withFakeProviderFetch(async ({ durations, calls, signal }) => {
    const twilio = await loadStandaloneTs("lib/twilio.ts")
    const ai = await loadStandaloneTs("lib/ai.ts")

    await withEnv({ VERCEL_ENV: "preview", MCSW_TEST_SMS_FAIL: "1" }, () =>
      assert.rejects(
        twilio.sendSms({ to: "+16155550141", body: "[INTERNAL TEST] fake failure" }),
        (error) => twilio.isDefinitiveTwilioError(error) && /Simulated preview SMS failure/.test(error.message),
      ))
    assert.equal(calls.length, 0, "the preview failure switch must not contact Twilio")

    await twilio.sendSms({ to: "+16155550141", body: "[INTERNAL TEST] timeout fixture" })
    await ai.draftWithDeepSeek({ system: "fixture", prompt: "fixture" })
    await ai.jsonWithDeepSeek({ system: "fixture", prompt: "fixture" })

    assert.deepEqual(durations, [8_000, 30_000, 30_000])
    assert.equal(calls.length, 3)
    assert.ok(calls.every(({ options }) => options.signal === signal))

    const brief = readFileSync(resolve(root, "app/api/ops/brief/route.ts"), "utf8")
    assert.match(brief, /const signal = AbortSignal\.timeout\(8_000\)/)
    assert.equal((brief.match(/\{ headers, cache: "no-store", signal \}/g) ?? []).length, 2)
  }))
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
