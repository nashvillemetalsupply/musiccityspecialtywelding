import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))
const resendRoutePath = resolve(root, "app/api/resend/webhook/route.ts")
const twilioRoutePath = resolve(root, "app/api/twilio/notification-status/route.ts")

function normalizedSql(strings) {
  return strings.join(" ? ").replace(/\s+/g, " ").trim()
}

function loadRoute(path, { fakes, env }) {
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const loadedModule = { exports: {} }
  const require = (specifier) => {
    if (fakes.has(specifier)) return fakes.get(specifier)
    throw new Error(`Unexpected route import: ${specifier}`)
  }
  const context = vm.createContext({
    console,
    process: { env: { ...env } },
    Request,
    Response,
    URL,
    URLSearchParams,
  })
  const factory = vm.runInContext(
    `(function (exports, require, module, __filename, __dirname) { ${output}\n})`,
    context,
    { filename: path },
  )
  factory(loadedModule.exports, require, loadedModule, path, resolve(path, ".."))
  return loadedModule.exports
}

function resendPayload(type, emailId) {
  const data = { email_id: emailId }
  if (type === "email.bounced") data.bounce = { message: "Mailbox rejected the alert." }
  if (type === "email.failed") data.failed = { reason: "Provider rejected the alert." }
  if (type === "email.suppressed") data.suppressed = { message: "Address is suppressed." }
  return { type, data }
}

function resendRequest(payload, signature = "valid") {
  return new Request("https://example.test/api/resend/webhook", {
    method: "POST",
    headers: {
      "svix-id": "test-hook",
      "svix-timestamp": "1788696000",
      "svix-signature": signature,
    },
    body: JSON.stringify(payload),
  })
}

function createResendHarness({ providerEmailId = "email-alert-901", deliveryStatus = "accepted", deliveryAttempts = 1, smsFallback = true } = {}) {
  const notification = providerEmailId
    ? {
        id: 901,
        provider_email_id: providerEmailId,
        provider_email_status: deliveryStatus === "delivered" ? "email.delivered" : deliveryStatus === "dead" ? "email.bounced" : null,
        provider_message_sid: null,
        sms_fallback: smsFallback,
        sms_only: false,
        delivery_status: deliveryStatus,
        delivery_attempts: deliveryAttempts,
        sent_at: null,
        interrupt_reserved_at: "2026-09-06T12:00:00.000Z",
        delivery_next_attempt_at: "2026-09-06T12:10:00.000Z",
      }
    : null
  const sqlCalls = []
  let providerType = ""
  let customerCalls = 0
  let matchedNotification = false

  const sql = async (strings, ...values) => {
    const text = normalizedSql(strings)
    sqlCalls.push({ text, values })

    if (text.includes("FROM notifications") && text.includes("provider_email_id")) {
      const receipt = values.find((value) => typeof value === "string" && value.startsWith("email-"))
      matchedNotification = Boolean(notification && receipt === notification.provider_email_id)
      return matchedNotification ? [{ ...notification }] : []
    }

    if (text.startsWith("UPDATE notifications SET")) {
      const receiptGuarded = text.includes("provider_email_id") && values.includes(notification?.provider_email_id)
      const idGuarded = matchedNotification && values.includes(notification?.id)
      if (!notification || (!receiptGuarded && !idGuarded)) return []

      if (text.includes("delivery_status = 'retry'")) {
        if (notification.provider_message_sid || notification.provider_email_status === providerType
          || ["dead", "delivered"].includes(notification.delivery_status)) return []
        assert.match(text, /sent_at\s*=\s*NULL/, "a failed email must reopen the notification for SMS")
        assert.match(text, /delivery_attempts\s*=\s*LEAST\(delivery_attempts, 4\)/, "the SMS phase must retain one bounded attempt")
        assert.match(text, /delivery_next_attempt_at\s*=\s*now\(\)/, "SMS fallback must be scheduled immediately")
        notification.delivery_status = "retry"
        notification.delivery_attempts = Math.min(notification.delivery_attempts, 4)
        notification.provider_email_status = providerType
        notification.sent_at = null
        notification.interrupt_reserved_at = null
        notification.delivery_next_attempt_at = "2026-09-06T12:01:00.000Z"
        return [{ id: notification.id, delivery_status: notification.delivery_status }]
      }

      const terminalSetGuard = /delivery_status\s*=\s*CASE[\s\S]*delivery_status IN \('delivered','dead'\)[\s\S]*THEN delivery_status/.test(text)
      const separateTerminalGuards = /WHEN delivery_status = 'dead' THEN 'dead'/.test(text)
        && /WHEN delivery_status = 'delivered' THEN 'delivered'/.test(text)
      assert.ok(terminalSetGuard || separateTerminalGuards, "email callback updates must preserve both terminal notification states")
      assert.match(text, /sent_at\s*=\s*COALESCE\(sent_at, now\(\)\)/, "a signed provider receipt must finalize sent_at")
      assert.match(text, /interrupt_reserved_at\s*=\s*NULL/, "a signed provider receipt must release the interrupt reservation")
      assert.match(text, /delivery_next_attempt_at\s*=\s*NULL/, "a signed provider receipt must cancel retry scheduling")
      const expectedLiteral = providerType === "email.delivery_delayed"
        ? "'accepted'"
        : ["email.bounced", "email.failed", "email.suppressed"].includes(providerType)
          ? "'dead'"
          : "'delivered'"
      assert.ok(text.includes(expectedLiteral), `email callback SQL must contain ${expectedLiteral}`)

      if (!["delivered", "dead"].includes(notification.delivery_status)) {
        notification.delivery_status = expectedLiteral.slice(1, -1)
        notification.provider_email_status = providerType
      }
      notification.sent_at ??= "2026-09-06T12:01:00.000Z"
      notification.interrupt_reserved_at = null
      notification.delivery_next_attempt_at = null
      return [{ id: notification.id, delivery_status: notification.delivery_status }]
    }

    if (text.includes("FROM events accepted_event")) return []
    if (text.includes("SELECT id FROM events")) return []
    return []
  }

  class FakeResend {
    constructor(apiKey) {
      assert.equal(apiKey, "synthetic-resend-key")
      this.webhooks = {
        verify: ({ payload, headers, webhookSecret }) => {
          assert.equal(webhookSecret, "synthetic-webhook-secret")
          if (headers.id !== "test-hook" || headers.signature !== "valid") throw new Error("Invalid signature")
          const parsed = JSON.parse(payload)
          providerType = parsed.type
          return parsed
        },
      }
    }
  }

  const route = loadRoute(resendRoutePath, {
    env: {
      RESEND_API_KEY: "synthetic-resend-key",
      RESEND_WEBHOOK_SECRET: "synthetic-webhook-secret",
    },
    fakes: new Map([
      ["resend", { Resend: FakeResend }],
      ["@/lib/db", { getSql: () => sql }],
      ["@/lib/events", { recordEvent: async () => { customerCalls += 1; throw new Error("notification receipt reached customer journal") } }],
      ["@/lib/notify", { notifyAll: async () => { customerCalls += 1; throw new Error("notification receipt fanned out another alert") } }],
    ]),
  })

  return { POST: route.POST, notification, sqlCalls, customerCalls: () => customerCalls }
}

test("a signed Resend receipt marks the matching operator alert delivered without customer fan-out", async () => {
  const harness = createResendHarness()
  const response = await harness.POST(resendRequest(resendPayload("email.delivered", "email-alert-901")))

  assert.equal(response.status, 200, JSON.stringify(harness.sqlCalls))
  assert.equal(harness.notification.delivery_status, "delivered")
  assert.equal(harness.notification.sent_at, "2026-09-06T12:01:00.000Z")
  assert.equal(harness.notification.interrupt_reserved_at, null)
  assert.equal(harness.notification.delivery_next_attempt_at, null)
  assert.equal(harness.customerCalls(), 0)
  assert.ok(
    harness.sqlCalls.some(({ text, values }) => text.includes("provider_email_id") && values.includes("email-alert-901")),
    "the durable update must be scoped to the exact Resend receipt",
  )
})

test("a signed Resend terminal failure schedules the configured SMS fallback", async () => {
  const harness = createResendHarness()
  const response = await harness.POST(resendRequest(resendPayload("email.bounced", "email-alert-901")))

  assert.equal(response.status, 200)
  assert.equal(harness.notification.delivery_status, "retry")
  assert.equal(harness.notification.sent_at, null)
  assert.equal(harness.notification.provider_email_status, "email.bounced")
  assert.equal(harness.customerCalls(), 0)
})

test("an email failure on attempt five still reserves one SMS fallback attempt", async () => {
  const harness = createResendHarness({ deliveryAttempts: 5 })
  const response = await harness.POST(resendRequest(resendPayload("email.bounced", "email-alert-901")))

  assert.equal(response.status, 200)
  assert.equal(harness.notification.delivery_status, "retry")
  assert.equal(harness.notification.delivery_attempts, 4)
})

test("a duplicate email failure cannot reopen a replacement SMS", async () => {
  const harness = createResendHarness()
  const request = () => resendRequest(resendPayload("email.bounced", "email-alert-901"))

  assert.equal((await harness.POST(request())).status, 200)
  harness.notification.delivery_status = "accepted"
  harness.notification.provider_message_sid = "SM-replacement-901"
  assert.equal((await harness.POST(request())).status, 200)

  assert.equal(harness.notification.delivery_status, "accepted")
  assert.equal(harness.notification.provider_message_sid, "SM-replacement-901")
})

test("a failed operator email without SMS fallback remains terminal", async () => {
  const harness = createResendHarness({ smsFallback: false })
  const response = await harness.POST(resendRequest(resendPayload("email.bounced", "email-alert-901")))

  assert.equal(response.status, 200)
  assert.equal(harness.notification.delivery_status, "dead")
  assert.equal(harness.customerCalls(), 0)
})

test("a signed Resend delay is recorded without claiming the operator alert was delivered", async () => {
  const harness = createResendHarness()
  const response = await harness.POST(resendRequest(resendPayload("email.delivery_delayed", "email-alert-901")))

  assert.equal(response.status, 200)
  assert.equal(harness.notification.delivery_status, "accepted")
  assert.equal(harness.notification.provider_email_status, "email.delivery_delayed")
  assert.equal(harness.customerCalls(), 0)
})

test("a delayed Resend receipt cannot regress a delivered or dead operator alert", async () => {
  for (const terminal of ["delivered", "dead"]) {
    const harness = createResendHarness({ deliveryStatus: terminal })
    const response = await harness.POST(resendRequest(resendPayload("email.delivery_delayed", "email-alert-901")))

    assert.equal(response.status, 200)
    assert.equal(harness.notification.delivery_status, terminal)
    assert.equal(harness.customerCalls(), 0)
  }
})

test("an early Resend callback retries when neither alert nor customer acceptance is durable yet", async () => {
  const harness = createResendHarness({ providerEmailId: null })
  const response = await harness.POST(resendRequest(resendPayload("email.delivered", "email-not-recorded")))
  const body = await response.json()

  assert.equal(response.status, 503)
  assert.equal(body.retry, true)
  assert.equal(harness.customerCalls(), 0)
  assert.ok(harness.sqlCalls.some(({ text }) => text.includes("FROM events accepted_event")))
})

test("an invalid Resend signature performs no database work", async () => {
  const harness = createResendHarness()
  const response = await harness.POST(resendRequest(resendPayload("email.delivered", "email-alert-901"), "invalid"))

  assert.equal(response.status, 403)
  assert.equal(harness.sqlCalls.length, 0)
  assert.equal(harness.customerCalls(), 0)
})

function createTwilioHarness({
  valid = true,
  providerEmailId = "email-alert-901",
  providerEmailStatus = "email.accepted",
} = {}) {
  const notification = {
    id: 901,
    provider_email_id: providerEmailId,
    provider_email_status: providerEmailStatus,
    provider_message_sid: "SM-old-alert",
    provider_status: "queued",
    delivery_status: "accepted",
  }
  const sqlCalls = []
  const sql = async (strings, ...values) => {
    const text = normalizedSql(strings)
    sqlCalls.push({ text, values })
    if (!text.startsWith("UPDATE notifications SET")) return []

    const receiptMatches = values.includes(notification.provider_message_sid)
    const protectsEmailReceipt = /provider_email_id\s+IS\s+NULL/i.test(text)
    const protectsSendingEmail = text.includes("provider_email_status") && text.includes("'sending'")
    const failedEmailReleasesAggregate = ["rejected", "email.bounced", "email.failed", "email.suppressed"].includes(notification.provider_email_status)
      && text.includes("'email.bounced'")
    const emailOwnsAggregate = Boolean(
      (notification.provider_email_id && protectsEmailReceipt && !failedEmailReleasesAggregate)
      || (notification.provider_email_status === "sending" && protectsSendingEmail),
    )
    if (receiptMatches && !emailOwnsAggregate) {
      notification.provider_status = "undelivered"
      notification.delivery_status = "dead"
    }
    return []
  }
  const route = loadRoute(twilioRoutePath, {
    env: {},
    fakes: new Map([
      ["@/lib/db", { getSql: () => sql }],
      ["@/lib/twilio", {
        readTwilioForm: async () => ({
          valid,
          params: new URLSearchParams({ MessageSid: "SM-old-alert", MessageStatus: "undelivered" }),
        }),
        twilioSmsWebhookConfigured: () => true,
        twiml: (body, status = 200) => new Response(body, { status }),
      }],
    ]),
  })
  return { POST: route.POST, notification, sqlCalls }
}

test("a late Twilio failure cannot overwrite an alert that has an email receipt", async () => {
  const harness = createTwilioHarness()
  const response = await harness.POST(new Request("https://example.test/api/twilio/notification-status?notification=901", { method: "POST" }))

  assert.equal(response.status, 200)
  assert.equal(harness.notification.provider_status, "queued")
  assert.equal(harness.notification.delivery_status, "accepted")
  const update = harness.sqlCalls.find(({ text }) => text.startsWith("UPDATE notifications SET"))
  assert.ok(update, "the signed receipt should reach the guarded database update")
  assert.match(update.text, /provider_email_id\s+IS\s+NULL/i)
})

test("an old SMS failure cannot win while the replacement email attempt is durably sending", async () => {
  const harness = createTwilioHarness({ providerEmailId: null, providerEmailStatus: "sending" })
  const response = await harness.POST(new Request("https://example.test/api/twilio/notification-status?notification=901", { method: "POST" }))

  assert.equal(response.status, 200)
  assert.equal(harness.notification.provider_status, "queued")
  assert.equal(harness.notification.delivery_status, "accepted")
  const update = harness.sqlCalls.find(({ text }) => text.startsWith("UPDATE notifications SET"))
  assert.ok(update, "the signed receipt should reach the guarded database update")
  assert.ok(update.text.includes("provider_email_status") && update.text.includes("'sending'"))
})

test("a replacement SMS receipt can settle an alert after email failure", async () => {
  const harness = createTwilioHarness({ providerEmailStatus: "email.bounced" })
  const response = await harness.POST(new Request("https://example.test/api/twilio/notification-status?notification=901", { method: "POST" }))

  assert.equal(response.status, 200)
  assert.equal(harness.notification.provider_status, "undelivered")
  assert.equal(harness.notification.delivery_status, "dead")
})

test("an invalid Twilio signature performs no database work", async () => {
  const harness = createTwilioHarness({ valid: false })
  const response = await harness.POST(new Request("https://example.test/api/twilio/notification-status?notification=901", { method: "POST" }))

  assert.equal(response.status, 403)
  assert.equal(harness.sqlCalls.length, 0)
})
