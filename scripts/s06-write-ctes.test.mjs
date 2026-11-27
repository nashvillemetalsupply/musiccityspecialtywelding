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
    Error,
    process: { env },
    require: (specifier) => {
      if (specifier === "node:crypto") return nativeRequire("node:crypto")
      if (moduleFakes.has(specifier)) return moduleFakes.get(specifier)
      throw new Error(`Unexpected import in ${relativePath}: ${specifier}`)
    },
  })
  const loaded = { exports: {} }
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, context.require, loaded)
  return loaded.exports
}

test("replaceJobLineItems deletes and inserts the replacement through one SQL statement", async () => {
  const calls = []
  const moduleFakes = new Map([[
    "@/lib/db",
    { getSql: () => async (strings, ...values) => {
      calls.push({ text: strings.join(" ? "), values })
      return [{ count: 2 }]
    } },
  ]])
  const { replaceJobLineItems } = loadModule("lib/job-line-items.ts", moduleFakes)
  const count = await replaceJobLineItems({
    leadId: 41,
    operatorId: 8,
    isTest: true,
    items: [
      { label: "Steel", note: "14 ga", amountCents: 20_000 },
      { label: "Install", note: "", amountCents: 5_000 },
    ],
  })

  assert.equal(count, 2)
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /WITH deleted_items AS MATERIALIZED/)
  assert.match(calls[0].text, /DELETE FROM job_line_items/)
  assert.match(calls[0].text, /jsonb_to_recordset\(\s*\?\s*::jsonb\)/)
  assert.match(calls[0].text, /INSERT INTO job_line_items/)
  assert.match(calls[0].text, /\?\s*::bigint[\s\S]*?\?\s*::boolean/)
})

test("supersedeClaim inserts the replacement and links the old row in one statement", async () => {
  const calls = []
  const moduleFakes = new Map([[
    "@/lib/db",
    { getSql: () => async (strings, ...values) => {
      calls.push({ text: strings.join(" ? "), values })
      return [{ id: 92 }]
    } },
  ]])
  const { supersedeClaim } = loadModule("lib/claims.ts", moduleFakes)
  const id = await supersedeClaim(14, {
    subjectType: "lead",
    subjectId: 41,
    predicate: "quoted_price_cents",
    value: { cents: 25_000 },
    confidence: 1,
    sourceEventId: 77,
    extractedBy: "operator-confirmed",
  })

  assert.equal(id, 92)
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /WITH claim_input AS MATERIALIZED/)
  assert.match(calls[0].text, /INSERT INTO claims/)
  assert.match(calls[0].text, /UPDATE claims old[\s\S]*?superseded_by = claim_write\.id/)
  assert.match(calls[0].text, /\?\s*::text[\s\S]*?\?\s*::bigint[\s\S]*?\?\s*::jsonb[\s\S]*?\?\s*::real/)
})

test("recordEvent's SQL test double stores internal and normal events in separate partitions", async () => {
  const leadFlags = new Map([[41, true], [42, false]])
  const storedRows = []
  const calls = []
  const moduleFakes = new Map([[
    "@/lib/db",
    { getSql: () => async (strings, ...values) => {
      const text = strings.join(" ? ")
      calls.push({ text, values })
      const leadId = values[4]
      const detail = JSON.parse(values[9])
      const textFields = [values[7], values[8], values[15]].filter(Boolean).join(" ")
      const isTest = Boolean(leadFlags.get(leadId) || detail.isTest === true
        || `${textFields} ${values[14] ?? ""}`.toLowerCase().includes("[internal test]"))
      storedRows.push({ leadId, is_test: isTest })
      return [{ id: storedRows.length }]
    } },
  ], ["@/lib/pagination", { clampPageToTotal: () => 1, normalizePage: () => 1 }], [
    "@/lib/visibility",
    {
      OWNER_ONLY_EVENT_KINDS: [],
      OWNER_ONLY_EVENT_NAMESPACE_PATTERN: "^$",
      OWNER_ONLY_EVENT_SENSITIVITIES: [],
      projectEventForRole: (event) => event,
    },
  ]])
  const { recordEvent } = loadModule("lib/events.ts", moduleFakes)

  await recordEvent({
    kind: "form.quote", leadId: 41, externalId: "test-event", body: "Quote received",
    detail: { isTest: true },
  })
  await recordEvent({
    kind: "form.quote", leadId: 42, externalId: "normal-event", body: "Quote received",
    detail: { isTest: false },
  })

  assert.equal(storedRows[0].is_test, true)
  assert.equal(storedRows[1].is_test, false)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.match(call.text, /detail, is_test/)
    assert.match(call.text, /mcsw_is_test_row/)
  }
})

test("createLead's lead and optional consent writes share a materialized SQL statement", async () => {
  const calls = []
  const moduleFakes = new Map([
    ["@/lib/db", { getSql: () => async (strings, ...values) => {
      const text = strings.join(" ? ")
      calls.push({ text, values })
      return text.includes("WITH inserted_lead")
        ? [{ id: 12, public_id: "L-20260927-TEST", is_test: false }]
        : [{ person_id: null, is_test: false }]
    } }],
    ["@/lib/follow-up-cadence.ts", { getDefaultFollowUpAt: async () => null }],
    ["@/lib/media-safety", { isSafeRasterImage: () => true }],
    ["@/lib/events", { recordEvent: async () => null }],
    ["@/lib/people", {
      attachLeadToPerson: async () => {},
      findOrCreatePerson: async () => null,
      isReservedShopPhone: () => false,
      normalizePhone: (value) => value,
    }],
  ])
  const { createLead } = loadModule("lib/leads.ts", moduleFakes)
  const lead = await createLead({
    firstName: "Fixture", lastName: "Customer", phone: "+16155550100", email: "owner@example.test",
    service: "gate", message: "test lead", preferredContact: "phone",
    photoCount: 0, gclid: "", utmSource: "", utmMedium: "", utmCampaign: "", utmTerm: "",
    utmContent: "", landingPage: "", referrer: "", ip: "", userAgent: "", isTest: false,
  }, {
    webTextConsent: { phoneE164: "+16155550100", provenance: { test: false } },
  })

  assert.equal(lead.id, 12)
  assert.equal(calls.filter((call) => /INSERT INTO|UPDATE|DELETE FROM/i.test(call.text)).length, 1)
  const leadWrite = calls.find((call) => /WITH inserted_lead AS MATERIALIZED/.test(call.text))
  assert.ok(leadWrite, "lead and consent writes remain in one materialized statement")
  assert.match(leadWrite.text, /captured_consent AS MATERIALIZED \([\s\S]*?INSERT INTO messaging_consents/)
  assert.match(leadWrite.text, /INSERT INTO leads[\s\S]*?::boolean[\s\S]*?::jsonb/)
})

async function quoteRecoveryFixture({ brokenLeadIds = [], discoveryFails = false, emailIntents = [] } = {}) {
  const createdAt = "2026-09-27T12:00:00.000Z"
  const message = "[INTERNAL TEST] Repair the gate"
  const events = []
  const extracted = []
  const downstream = []
  const runs = []
  const repairs = []
  const repairAttempts = new Map()
  const notifications = new Map()
  const fifteenMinutes = 15 * 60 * 1000
  let now = Date.parse(createdAt) + 24 * 60 * 60 * 1000
  let saved = false
  let writeFails = true
  const getSql = () => async (strings, ...values) => {
    const sql = strings.join(" ? ")
    if (sql.includes("WITH inserted_lead")) {
      saved = true
      return [{ id: 12, public_id: "L-20260927-TEST", is_test: true }]
    }
    if (sql.includes("SELECT person_id, is_test FROM leads")) return [{ person_id: 7, is_test: true }]
    if (sql.includes("INSERT INTO automation_leases") || sql.includes("UPDATE automation_leases")) return [{ key: values[0] }]
    if (sql.includes("intake_key LIKE 'website:%'")) {
      if (discoveryFails) throw new Error("missing quote candidate query failed")
      assert.match(sql, /NOT EXISTS[\s\S]*?kind = 'form\.quote'/)
      assert.match(sql, /repair\.updated_at <= now\(\) - interval '15 minutes'/)
      assert.match(sql, /ORDER BY COALESCE\(repair\.updated_at, l\.created_at\), l\.id LIMIT 20/)
      const missing = brokenLeadIds.map((id) => ({ id, source: "direct", message, created_at: "2026-09-27T11:00:00.000Z" }))
      if (saved && !events.some((event) => event.leadId === 12)) missing.push({ id: 12, source: "direct", message, created_at: createdAt })
      return missing.filter((lead) => !repairAttempts.has(lead.id) || repairAttempts.get(lead.id) <= now - fifteenMinutes)
        .sort((a, b) => (repairAttempts.get(a.id) ?? Date.parse(a.created_at)) - (repairAttempts.get(b.id) ?? Date.parse(b.created_at)) || a.id - b.id)
        .slice(0, 20)
    }
    if (sql.includes("INSERT INTO sync_state (key, updated_at)")) {
      assert.match(sql, /WHERE sync_state\.updated_at <= now\(\) - interval '15 minutes'/)
      const id = Number(values[0].split(":")[1])
      assert.ok(!repairAttempts.has(id) || repairAttempts.get(id) <= now - fifteenMinutes)
      repairAttempts.set(id, now)
      repairs.push(id)
      return [{ key: values[0] }]
    }
    if (sql.includes("FROM events intent JOIN leads")) {
      assert.match(sql, /min\(attempt\.occurred_at\)/)
      assert.match(sql, /rejection\.detail->>'attemptEventId' = attempt\.id::text/)
      assert.match(sql, /kind IN \('email\.accepted', 'email\.delivered'\)/)
      assert.match(sql, /intent\.detail->>'frozenPayload' IS NOT NULL THEN intent\.recorded_at/)
      assert.match(sql, /<= now\(\) - interval '23 hours'/)
      assert.match(sql, /'quote-email-review:' \|\| intent\.id::text AS review_key/)
      assert.match(sql, /n\.dedupe_key = CASE WHEN failure\.id IS NOT NULL THEN keys\.failure_key ELSE keys\.review_key END/)
      return emailIntents.filter((intent) => {
        const attempts = intent.receipts.filter(({ kind }) => kind === "email.attempt" || kind === "email.unknown")
        const firstAge = attempts.length > 0 ? Math.max(...attempts.map(({ age }) => age)) : intent.frozenPayload ? 0 : intent.age
        return firstAge >= 23 && !intent.receipts.some(({ kind }) => kind === "email.accepted" || kind === "email.delivered")
          && !notifications.has(`quote-email-review:${intent.id}`)
      }).map((intent) => ({ ...intent, needs_review: true, review_key: "quote-email-review:" + intent.id }))
    }
    if (sql.includes("INSERT INTO sync_state") && sql.includes("last_recovery_attempt_at")) return [{ key: values[0] }]
    if (sql.includes("SELECT id FROM events") && sql.includes("processed_at IS NULL")) {
      return events.filter((event) => !extracted.includes(event.id) && values.flat().includes(event.id))
    }
    if (sql.includes("UPDATE events SET extraction_status = 'processing'")) return [{ id: values[0] }]
    if (sql.includes("INSERT INTO automation_runs")) runs.push(JSON.parse(values[1]))
    return []
  }
  const leads = loadModule("lib/leads.ts", new Map([
    ["@/lib/db", { getSql }],
    ["@/lib/follow-up-cadence.ts", { getDefaultFollowUpAt: async () => null }],
    ["@/lib/media-safety", {}],
    ["@/lib/events", { recordEvent: async (event) => {
      if (brokenLeadIds.includes(event.leadId)) throw new Error("oldest quote event write failed")
      if (writeFails) throw new Error("event write temporarily unavailable")
      events.push({ id: 19, ...event })
      return 19
    } }],
    ["@/lib/people", { findOrCreatePerson: async () => null, isReservedShopPhone: () => false, normalizePhone: (phone) => phone }],
  ]))
  const lead = await leads.createLead({
    firstName: "Fixture", lastName: "Customer", phone: "+16155550100", email: "",
    service: "gate", message, preferredContact: "phone", photoCount: 0, gclid: "", utmSource: "",
    utmMedium: "", utmCampaign: "", utmTerm: "", utmContent: "", landingPage: "", referrer: "", ip: "", userAgent: "", isTest: true,
  }, { intakeKey: "website:fixture", quoteIntake: true })
  const noop = async () => 0
  const { runRecoverySweep } = loadModule("lib/recovery-sweep.ts", new Map([
    ["@/lib/db", { getSql }], ["@/lib/leads", leads],
    ["@/lib/quote-email", { recoverUnattemptedQuoteEmail: async () => assert.fail("expired intents require review") }],
    ["@/lib/notify", { notifyAll: async (notification) => {
      assert.ok(emailIntents.length, "test quote must stay quiet")
      assert.equal(notifications.has(notification.dedupeKey), false, "a saved review should leave the candidate window")
      notifications.set(notification.dedupeKey, notification)
      return [{ id: 1 }]
    }, retryPendingInterrupts: async () => downstream.push("interrupts") }],
    ["@/lib/extract", { EXTRACTABLE_EVENT_KINDS: ["form.quote"], processEvent: async (id) => {
      extracted.push(id)
      return { processed: true }
    } }],
    ["@/lib/attachment-retry", { retryPendingAttachments: async () => downstream.push("attachments") }],
    ["@/lib/call-transcription", { retryCallTranscriptions: async () => downstream.push("call transcripts") }],
    ["@/lib/voice-transcription", { retryVoiceTranscriptions: noop }],
    ["@/lib/messages", { reconcileStaleSmsIntents: async () => downstream.push("SMS") }],
    ["@/lib/ingest", { reconcileRawInboundCalls: noop }],
    ["@/lib/calls", { reconcileStaleOutboundCalls: noop }],
    ["@/lib/commitments", { reconcileStaleCommitmentReschedules: noop }],
    ["@/lib/glass-uploads", { reconcileGlassUploads: noop }],
    ["@/lib/job-intake", { reconcileStaleCallIntakes: noop }],
    ["@/lib/call-summary", { summarizePendingCalls: noop }],
  ]), { VERCEL_ENV: "production" })
  writeFails = false
  return { createdAt, message, lead, events, extracted, downstream, runs, repairs, notifications, runRecoverySweep, advanceMinutes: (minutes) => { now += minutes * 60 * 1000 } }
}

test("recovery extracts a saved quote after its creation event write fails", async () => {
  const { createdAt, message, lead, events, extracted, runRecoverySweep } = await quoteRecoveryFixture()
  assert.equal(lead.id, 12)
  assert.equal(lead.eventId, null)
  assert.equal((await runRecoverySweep({ trigger: "owner-manual" })).ok, true)
  assert.equal((await runRecoverySweep({ trigger: "owner-manual" })).ok, true)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, "form.quote")
  assert.equal(events[0].body, message)
  assert.equal(events[0].leadId, 12)
  assert.equal(events[0].personId, 7)
  assert.equal(events[0].occurredAt, createdAt)
  assert.equal(events[0].detail.isTest, true)
  assert.deepEqual(extracted, [19])
})

test("a failed quote event repair is recorded and leaves the rest of recovery running", async () => {
  const { downstream, extracted, runs, runRecoverySweep } = await quoteRecoveryFixture({ brokenLeadIds: [11] })
  const result = await runRecoverySweep({ trigger: "owner-manual" })

  assert.deepEqual(extracted, [19], "the quote after the failing one reaches extraction")
  assert.deepEqual(downstream, ["attachments", "call transcripts", "SMS", "interrupts"])
  assert.equal(result.ok, true)
  assert.deepEqual(runs[0].quoteEventRepairFailures, [{ leadId: 11, error: "oldest quote event write failed" }])
})

test("missing quote candidate query failure is reported and downstream recovery continues", async () => {
  const { downstream, runs, runRecoverySweep } = await quoteRecoveryFixture({ discoveryFails: true })
  assert.equal((await runRecoverySweep({ trigger: "owner-manual" })).ok, true)
  assert.equal(runs[0].quoteEventDiscoveryError, "missing quote candidate query failed")
  assert.deepEqual(downstream, ["attachments", "call transcripts", "SMS", "interrupts"])
})

test("20 failed quote repairs leave the next recovery window open to a newer quote", async () => {
  const brokenLeadIds = Array.from({ length: 20 }, (_, index) => 100 + index)
  const { extracted, repairs, advanceMinutes, runRecoverySweep } = await quoteRecoveryFixture({ brokenLeadIds })
  assert.equal((await runRecoverySweep({ trigger: "owner-manual" })).ok, true)
  assert.deepEqual(repairs, brokenLeadIds)
  assert.deepEqual(extracted, [])
  advanceMinutes(14)
  assert.equal((await runRecoverySweep({ trigger: "owner-manual" })).ok, true)
  assert.deepEqual(repairs, [...brokenLeadIds, 12])
  assert.deepEqual(extracted, [19])
  advanceMinutes(1)
  assert.equal((await runRecoverySweep({ trigger: "owner-manual" })).ok, true)
  assert.deepEqual(repairs, [...brokenLeadIds, 12, ...brokenLeadIds])
})

test("sweep files one owner review after 23 hours using the first attempt and respecting acceptance", async () => {
  const emailIntents = [
    { id: 41, lead_id: 7, audience: "shop", frozenPayload: true, receipts: [{ kind: "email.attempt", age: 23 }, { kind: "email.unknown", age: 0.5 }] },
    { id: 42, lead_id: 7, audience: "customer", frozenPayload: true, receipts: [{ kind: "email.attempt", age: 22.9 }] },
    { id: 43, lead_id: 8, audience: "shop", frozenPayload: true, receipts: [{ kind: "email.attempt", age: 26 }, { kind: "email.accepted" }, { kind: "email.failed" }] },
  ]
  const { notifications, runRecoverySweep } = await quoteRecoveryFixture({ emailIntents })
  assert.equal((await runRecoverySweep({ trigger: "owner-manual" })).ok, true)
  assert.equal((await runRecoverySweep({ trigger: "owner-manual" })).ok, true)
  assert.equal(notifications.size, 1)
  const review = notifications.get("quote-email-review:41")
  assert.equal(review.title, "Quote saved, owner email unconfirmed")
  assert.equal(review.ownerOnly, true)
  assert.equal(review.url, "/ops/leads/7#spike")
})

test("sweep also reviews an expired legacy quote intent with both outcome writes missing", async () => {
  const emailIntents = [
    { id: 51, lead_id: 9, audience: "shop", age: 25, receipts: [] },
    { id: 52, lead_id: 10, audience: "shop", age: 25, receipts: [{ kind: "email.unknown", age: 22 }] },
  ]
  const { notifications, runRecoverySweep } = await quoteRecoveryFixture({ emailIntents })
  assert.equal((await runRecoverySweep({ trigger: "owner-manual" })).ok, true)
  assert.equal(notifications.size, 1)
  assert.equal(notifications.get("quote-email-review:51").sourceEventId, 51)
})
