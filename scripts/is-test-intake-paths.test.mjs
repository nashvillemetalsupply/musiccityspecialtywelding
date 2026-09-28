import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))
const nativeRequire = createRequire(import.meta.url)

function loadModule(relativePath, moduleFakes, env = {}) {
  const path = resolve(root, relativePath)
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const context = vm.createContext({
    console: { error() {}, warn() {}, log() {} },
    process: { env },
    require: (specifier) => {
      if (specifier === "node:crypto") return nativeRequire(specifier)
      if (moduleFakes.has(specifier)) return moduleFakes.get(specifier)
      throw new Error(`Unexpected import in ${relativePath}: ${specifier}`)
    },
  })
  const loaded = { exports: {} }
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, context.require, loaded)
  return loaded.exports
}

function hasInternalTestMarker(value) {
  return typeof value === "string" && value.toLowerCase().includes("[internal test]")
}

function databaseClassifier(sqlText, values, parentIsTest = false) {
  return sqlText.includes("mcsw_is_test_row")
    && (parentIsTest || values.some(hasInternalTestMarker))
}

function loadEventWriter(sql) {
  return loadModule("lib/events.ts", new Map([
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/pagination", { clampPageToTotal: () => 1, normalizePage: () => 1 }],
    ["@/lib/visibility", {
      OWNER_ONLY_EVENT_KINDS: [], OWNER_ONLY_EVENT_NAMESPACE_PATTERN: "^$",
      OWNER_ONLY_EVENT_SENSITIVITIES: [], projectEventForRole: (event) => event,
    }],
  ]))
}

test("public lead intake receipts classify INTERNAL TEST and ordinary leads through existing SQL doubles", async () => {
  const leadFlags = new Map()
  const eventRows = []
  let nextLeadId = 40
  const sql = async (strings, ...values) => {
    const text = strings.join(" ? ")
    if (text.includes("WITH inserted_lead")) {
      const id = ++nextLeadId
      leadFlags.set(id, Boolean(values[20]))
      return [{ id, public_id: `L-${id}` }]
    }
    if (text.includes("SELECT person_id, is_test FROM leads")) {
      return [{ person_id: null, is_test: leadFlags.get(values[0]) === true }]
    }
    if (text.includes("INSERT INTO events")) {
      const isTest = databaseClassifier(text, values, leadFlags.get(values[10]) === true)
      eventRows.push({ is_test: isTest, sql: text })
      return [{ id: eventRows.length }]
    }
    return []
  }
  const fakes = new Map([
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/follow-up-cadence.ts", { getDefaultFollowUpAt: async () => null }],
    ["@/lib/pagination", { clampPageToTotal: () => 1, normalizePage: () => 1 }],
    ["@/lib/visibility", {
      OWNER_ONLY_EVENT_KINDS: [], OWNER_ONLY_EVENT_NAMESPACE_PATTERN: "^$",
      OWNER_ONLY_EVENT_SENSITIVITIES: [], projectEventForRole: (event) => event,
    }],
    ["@/lib/media-safety", { isSafeRasterImage: () => true }],
    ["@/lib/people", {
      attachLeadToPerson: async () => {}, findOrCreatePerson: async () => null,
      isReservedShopPhone: () => false, normalizePhone: (value) => value,
    }],
  ])
  const events = loadModule("lib/events.ts", fakes)
  fakes.set("@/lib/events", events)
  const { createLead } = loadModule("lib/leads.ts", fakes)

  for (const fixture of [
    { isTest: true, message: "[INTERNAL TEST] synthetic quote" },
    { isTest: false, message: "Ordinary quote request" },
  ]) {
    await createLead({
      firstName: fixture.isTest ? "[INTERNAL TEST] Fixture" : "Fixture",
      lastName: "Customer", phone: "+16155550100", email: "owner@example.test",
      service: "gate", message: fixture.message, preferredContact: "phone",
      photoCount: 0, gclid: "", utmSource: "", utmMedium: "", utmCampaign: "",
      utmTerm: "", utmContent: "", landingPage: "", referrer: "", ip: "",
      userAgent: "", isTest: fixture.isTest,
    })
  }

  assert.deepEqual(eventRows.map((row) => row.is_test), [true, false])
  assert.ok(eventRows.every((row) => row.sql.includes("mcsw_is_test_row")))
})

test("inbound Twilio call receipts inherit the linked lead test partition", async () => {
  for (const parentIsTest of [true, false]) {
    const callRows = []
    const eventRows = []
    const callbacks = []
    const sql = async (strings, ...values) => {
      const text = strings.join(" ? ").replace(/\s+/g, " ")
      if (text.includes("INSERT INTO calls")) {
        callRows.push({ is_test: databaseClassifier(text, values) })
      } else if (text.includes("UPDATE calls SET")) {
        callRows[0].is_test ||= databaseClassifier(text, values, parentIsTest)
      } else if (text.includes("INSERT INTO events")) {
        eventRows.push({ is_test: databaseClassifier(text, values, parentIsTest) })
        return [{ id: 901 }]
      }
      return []
    }
    const events = loadEventWriter(sql)
    const params = new Map([
      ["CallSid", "CA1234567890abcdef1234567890abcdef"],
      ["From", "+16155550100"], ["To", "+16157033296"],
      ["CallerName", parentIsTest ? "[INTERNAL TEST] Fixture caller" : "Fixture caller"],
    ])
    const fakes = new Map([
      ["next/server", { after: (callback) => callbacks.push(callback) }],
      ["@/lib/db", { getSql: () => sql }],
      ["@/lib/job-intake", {
        inboundCallNotificationDedupeKey: (sid) => `call:${sid}`,
        markInboundCallReconciliationHandled: async () => true,
        persistInboundCallReceipt: async (input) => events.recordEvent({
          kind: "call.in", actorType: "customer", actorId: input.actorId,
          leadId: input.leadId, personId: input.personId, body: input.body,
          crewBody: input.crewBody, detail: input.detail,
        }),
        prepareInboundCallIntake: async () => ({
          kind: "existing", leadId: parentIsTest ? 41 : 42,
          person: { id: 7, is_test: parentIsTest, display_name: "Fixture customer" },
        }),
      }],
      ["@/lib/notify", { notifyAll: async () => [] }],
      ["@/lib/people", { normalizePhone: (value) => value }],
      ["@/lib/twilio", {
        escapeXml: (value) => value, isConfiguredTwilioNumber: () => true,
        readTwilioForm: async () => ({ params, valid: true }),
        twilioCallbackUrl: (path) => `https://example.test${path}`,
        twilioInboundDialTarget: (phone) => phone,
        twilioLiveTranscriptionStart: () => "", twilioVoiceConfigured: () => true,
        twiml: (body, status = 200) => ({ body, status }),
      }],
    ])
    const { POST } = loadModule("app/api/twilio/voice/route.ts", fakes, { OWNER_CELL_PHONE: "+16155550141" })
    const response = await POST({})
    await Promise.all(callbacks.map((callback) => callback()))

    assert.equal(response.status, 200)
    assert.deepEqual(callRows.map((row) => row.is_test), [parentIsTest])
    assert.deepEqual(eventRows.map((row) => row.is_test), [parentIsTest])
  }
})

test("inbound Twilio messages acquire a test lead flag when conversation matching links them", async () => {
  for (const parentIsTest of [true, false]) {
    const messages = []
    const eventRows = []
    const sql = async (strings, ...values) => {
      const text = strings.join(" ? ").replace(/\s+/g, " ")
      if (text.includes("INSERT INTO messages")) {
        messages.push({ is_test: databaseClassifier(text, values) })
        return [{ id: 31, lead_id: null, person_id: null }]
      }
      if (text.includes("UPDATE messages SET lead_id")) {
        assert.ok(text.includes("mcsw_is_test_row"), "the linked lead is reclassified on message projection")
        assert.ok(values.includes(parentIsTest ? 41 : 42), "the matched lead id reaches the classifier")
        messages[0].is_test ||= databaseClassifier(text, values, parentIsTest)
      } else if (text.includes("INSERT INTO events")) {
        eventRows.push({ is_test: databaseClassifier(text, values, parentIsTest) })
        return [{ id: 72 }]
      }
      return []
    }
    const events = loadEventWriter(sql)
    const params = new Map([
      ["MessageSid", "SM123"], ["From", "+16155550100"],
      ["To", "+16157033296"], ["Body", "Please call about a repair."], ["NumMedia", "0"],
    ])
    const fakes = new Map([
      ["next/server", { after() {} }],
      ["@/lib/db", { getSql: () => sql }],
      ["@/lib/events", events],
      ["@/lib/ingest", { resolvePhoneConversation: async () => ({
        person: { id: 8, display_name: "Fixture customer", is_test: parentIsTest },
        leadId: parentIsTest ? 41 : 42, createdLead: false,
      }) }],
      ["@/lib/notify", { notifyAll: async () => [], notifyOwnerCellSms: async () => ({}) }],
      ["@/lib/people", {
        findPersonByPhone: async () => null, findRecentOpenLeadForPerson: async () => null,
        isReservedShopPhone: () => false,
      }],
      ["@/lib/twilio", {
        isConfiguredTwilioNumber: () => true,
        readTwilioForm: async () => ({ params, valid: true }),
        twilioSmsWebhookConfigured: () => true, twilioWebhookBaseUrl: () => "https://example.test",
        twiml: () => ({ status: 200 }),
      }],
      ["@/lib/shop-brain-invariants.ts", { isMetaVerificationSms: () => false, isUsNumericShortCode: () => false }],
      ["@/lib/extract", { processEvent: async () => ({}) }],
      ["@/lib/attachment-retry", { queueIngestAttachment: async () => 1, storeQueuedAttachment: async () => {} }],
      ["@/lib/messaging-consent", { classifyTwilioConsentKeyword: () => null, recordMessagingConsent: async () => {} }],
      ["@/lib/sms-provider-truth.ts", { resumeSmsProjection: () => ({ projected: false, leadId: null, personId: null, createdLead: false }) }],
      ["@/lib/recovery-sweep", { runRecoverySweep: async () => ({ ok: true, skipped: true }) }],
      ["@/lib/gmail-wake", { wakeGmailIngest: async () => ({ ok: true }) }],
      ["@/lib/routing", { reconcileRoutedLeadProjections: async () => null, resolveProjectionLeadId: async (id) => id }],
    ])
    const { POST } = loadModule("app/api/twilio/sms/route.ts", fakes)
    const response = await POST({ url: "https://example.test/api/twilio/sms" })

    assert.equal(response.status, 200)
    assert.deepEqual(messages.map((message) => message.is_test), [parentIsTest])
    assert.deepEqual(eventRows.map((row) => row.is_test), [parentIsTest])
  }
})

test("Customer Page upload message and event inherit the linked lead test partition", async () => {
  for (const parentIsTest of [true, false]) {
    const uploadId = "upload-test-0001"
    const upload = {
      id: uploadId, token_hash: "token-hash", lead_id: parentIsTest ? 41 : 42, person_id: 8,
      batch_id: "batch-1", pathname: "private/plan.pdf", filename: "plan.pdf",
      content_type: "application/pdf", size_bytes: 123, status: "uploaded", error: "",
      blob_url: "", etag: "", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
      projected_at: null, expired_at: null, revoked_at: null, expires_at: null,
      lead_status: "new", first_name: "Fixture", is_test: parentIsTest, event_id: 91,
    }
    const writtenRows = []
    const sql = async (strings, ...values) => {
      const text = strings.join(" ? ").replace(/\s+/g, " ")
      if (text.includes("SELECT u.*, g.revoked_at")) return [upload]
      if (text.includes("INSERT INTO messages")) {
        const classifierCalls = (text.match(/mcsw_is_test_row/g) ?? []).length
        assert.equal(classifierCalls, 2, "message and event projections both use the classifier")
        assert.match(text, /mcsw_is_test_row\(c\.lead_id, c\.person_id/)
        writtenRows.push({ table: "messages", is_test: databaseClassifier(text, values, parentIsTest) })
        writtenRows.push({ table: "events", is_test: databaseClassifier(text, values, parentIsTest) })
        return [{ ...upload, status: "stored", is_test: parentIsTest }]
      }
      if (text.includes("UPDATE glass_uploads u SET status = 'uploaded'")) return [{ ...upload, status: "uploaded" }]
      if (text.includes("SELECT 1 AS allowed")) return [{ allowed: 1 }]
      return []
    }
    const fakes = new Map([
      ["@vercel/blob", { get: async () => null, head: async (pathname) => ({ pathname, size: 123, url: "https://blob.example/plan.pdf", etag: "etag-1" }) }],
      ["@/lib/db", { getSql: () => sql }],
      ["@/lib/glass", { extendGlassLinkExpiry: async () => {}, getGlassJob: async () => null, getGlassJobByLinkId: async () => null, hashGlassToken: () => "token-hash" }],
      ["@/lib/notify", { notifyAll: async () => [] }],
      ["@/lib/public-quote.ts", { imageTypeMatches: () => true }],
      ["@/lib/shop-brain-invariants.ts", { GLASS_UPLOAD_PENDING_EXPIRY_MS: 120000, validateCustomerUploadMetadata: () => "" }],
    ])
    const { finalizeGlassUpload } = loadModule("lib/glass-uploads.ts", fakes)

    const result = await finalizeGlassUpload({ uploadId })

    assert.equal(result.status, "stored")
    assert.deepEqual(writtenRows.map((row) => row.is_test), [parentIsTest, parentIsTest])
  }
})
