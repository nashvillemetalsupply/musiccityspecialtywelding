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

function loadModule(relativePath, moduleFakes) {
  const path = resolve(root, relativePath)
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const context = vm.createContext({
    console: { error() {}, warn() {}, log() {} },
    process: { env: {} },
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
        ? [{ id: 12, public_id: "L-20260927-TEST" }]
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
