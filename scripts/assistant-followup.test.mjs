import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { processAssistantTurn } from "../lib/assistant/service.ts"
import { stripAssistantMoney } from "../lib/assistant/money.ts"
import { isReservedCustomerPhone, normalizeUsPhone, validateCustomerUploadMetadata, GLASS_UPLOAD_PENDING_EXPIRY_MS } from "../lib/shop-brain-invariants.ts"
import { SmsNotSentError } from "../lib/sms-provider-truth.ts"

const nativeRequire = createRequire(import.meta.url)
const compiled = new Map()
function load(path, env, modules) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)
  const loaded = { exports: {} }
  const context = vm.createContext({ process: { env }, Buffer, Response, Request, URL, console: { error() {} } })
  vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, context)((name) => {
    if (name.startsWith("node:")) return nativeRequire(name)
    assert.ok(modules.has(name), `Unmocked ${path} import ${name}`)
    return modules.get(name)
  }, loaded, loaded.exports)
  return loaded.exports
}

function fixture(options = {}) {
  const env = { GLASS_TOKEN_SECRET: "synthetic-secret-for-local-tests-only-123456", TWILIO_PHONE_NUMBER: "+16155550100", NEXT_PUBLIC_SITE_URL: "https://shop.example.test" }
  if (options.noSecret) delete env.GLASS_TOKEN_SECRET
  const lead = { phone: "+16155550199", person_id: 9, is_test: false, person_is_test: false,
    first_name: "Ava", email: "", phone_is_placeholder: false, message: "gate repair", source: "website-chat",
    intake_key: "assistant:local-session", receipt_fields: options.receiptFields ?? null,
    notes: "Owner note $900", crew_notes: "Crew note", ...options.lead }
  const links = new Map()
  const messages = new Map()
  const queries = []
  const provider = []
  const events = []
  let allowed = options.allowed !== false
  const sql = async (strings, ...values) => {
    for (let i = 0; i < values.length; i++) assert.match(strings[i + 1], /^::[a-z]+/, "SQL parameters need explicit casts")
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim()
    queries.push({ text, values })
    if (text.startsWith("SELECT l.phone")) return options.missingReceipt ? [] : [{ ...lead,
      assistant_partial: ["website-chat", "phone-assistant"].includes(lead.source)
        && /^(?:assistant:|call:)/.test(lead.intake_key)
        && /^(?:\[INTERNAL TEST\] )?Partial assistant request\./.test(lead.message),
    }]
    if (text.startsWith("UPDATE leads SET first_name")) {
      const [name, phone, , email] = values
      if (!lead.first_name.trim() || lead.first_name === "Assistant callback (partial)") lead.first_name = name || lead.first_name
      if (!lead.phone.trim() || lead.phone_is_placeholder) {
        lead.phone = phone || lead.phone
        if (phone) lead.phone_is_placeholder = false
      }
      if (!lead.email.trim()) lead.email = email || lead.email
      return [{ phone: lead.phone }]
    }
    if (text.startsWith("UPDATE leads SET notes")) {
      const replace = (value, note) => [value.replace(/(^|\n)Assistant callback requested: [^\n]*/g, "").trim(), note].filter(Boolean).join("\n")
      lead.notes = replace(lead.notes, values[0])
      lead.crew_notes = replace(lead.crew_notes, values[1])
      return []
    }
    if (text.startsWith("SELECT token_hash, token_nonce FROM glass_links")) return [...links.values()].filter((row) => !row.revoked_at && Date.parse(row.expires_at) > Date.now())
    if (text.startsWith("INSERT INTO glass_links")) {
      const [hash, nonce, id] = values
      assert.equal(id, 41)
      assert.match(text, /NULL::bigint, now\(\) \+ interval '180 days'/)
      assert.doesNotMatch(text, /UPDATE|revoked_at =/)
      if (!links.has(hash)) links.set(hash, { token_hash: hash, token_nonce: nonce, lead_id: id,
        expires_at: new Date(Date.now() + 180 * 86400_000).toISOString(), revoked_at: null })
      return []
    }
    if (text.startsWith("SELECT g.token_hash")) {
      const link = links.get(values[0])
      return link && !link.revoked_at ? [{ ...link, status: "new", is_test: lead.is_test }] : []
    }
    if (text.startsWith("INSERT INTO messages")) {
      if (options.smsDbFailure) throw new Error("synthetic SMS intent storage failure")
      const [sid, from, to, body, status, leadId, personId, operatorId, , key, sendAfter, quiet] = values
      if (messages.has(key)) return []
      const row = { id: messages.size + 1, twilio_sid: sid, from_phone: from, to_phone: to, body, status,
        lead_id: leadId, person_id: personId, operator_id: operatorId, idempotency_key: key,
        send_after: sendAfter, quiet_hours_exempt: quiet, is_test: lead.is_test || lead.person_is_test }
      messages.set(key, row)
      return [{ ...row }]
    }
    if (text.startsWith("SELECT id, twilio_sid")) return [{ ...messages.get(values[0]) }]
    if (text.startsWith("SELECT to_phone, status FROM messages") || text.startsWith("SELECT status FROM messages")) {
      const row = messages.get(values[0])
      return row && row.lead_id === values[1] ? [{ status: row.status, to_phone: row.to_phone }] : []
    }
    if (text.startsWith("SELECT twilio_sid, status FROM messages")) return [...messages.values()].filter((row) => row.id === values[0])
    if (text.startsWith("UPDATE messages SET status = 'sending'")) {
      if (options.claimDbFailure) throw new Error("synthetic SMS claim storage failure")
      const row = [...messages.values()].find((item) => item.id === values[1])
      if (row?.status !== "persisted") return []
      row.status = "sending"
      return [{ ...row }]
    }
    if (text.startsWith("UPDATE messages SET twilio_sid")) {
      const row = [...messages.values()].find((item) => item.id === values[2])
      row.twilio_sid = values[0]; row.status = values[1]
      return []
    }
    if (text.startsWith("UPDATE messages SET status =")) {
      const row = [...messages.values()].find((item) => item.id === values[values.length - 2])
      if (row) row.status = values[0]
      return []
    }
    throw new Error(`Unexpected SQL: ${text}`)
  }
  const twilio = {
    twilioSmsConfigured: () => options.configured !== false,
    twilioCallbackUrl: (path) => `https://provider.example.test${path}`,
    isDefinitiveTwilioError: () => options.failure === "failed",
    sendSms: async (input) => {
      assert.equal([...messages.values()][0]?.status, "sending", "durable intent must precede provider")
      assert.ok(events.some((event) => event.kind === "sms.out"), "journal precedes provider")
      provider.push(input)
      if (options.failure) throw new Error("synthetic provider failure")
      return { sid: "SMsynthetic", status: "accepted" }
    },
  }
  let consentChecks = 0
  const consent = { customerSmsAllowed: async () => { consentChecks++; return allowed && !(options.revokeAtSend && consentChecks > 1) } }
  const notify = { notify: async () => {}, notifyAll: async () => {} }
  const common = new Map([
    ["@/lib/db", { getSql: () => sql }], ["../db.ts", { getSql: () => sql }],
    ["@/lib/events", { recordEvent: async (event) => { events.push(event); return 201 } }],
    ["@/lib/notify", notify], ["@/lib/twilio", twilio], ["../twilio.ts", twilio],
    ["@/lib/messaging-consent", consent], ["../messaging-consent.ts", consent],
    ["@/lib/shop-phone-shared", { FALLBACK_SHOP_PHONE_E164: "+16157033296" }],
    ["@/lib/shop-brain-invariants.ts", { normalizeUsPhone, isReservedCustomerPhone: () => false }],
    ["../shop-brain-invariants.ts", { normalizeUsPhone, isReservedCustomerPhone }],
    ["@/lib/sms-quiet-hours.ts", { isCentralQuietHours: () => false, getDeferredSmsSendAt: () => null }],
    ["@/lib/deferred-sms.ts", { sendIfClaimed: async () => {} }],
    ["@/lib/sms-provider-truth.ts", { SmsNotSentError }],
    ["./money.ts", { stripAssistantMoney }],
  ])
  const glass = load("lib/glass.ts", env, common)
  const sms = load("lib/messages.ts", env, common)
  common.set("../glass.ts", glass)
  common.set("../messages.ts", sms)
  common.set("../glass-delivery.ts", { glassUrl: (token) => `${env.NEXT_PUBLIC_SITE_URL}/j/${token}` })
  const { followUpAssistantLead } = load("lib/assistant/followup.ts", env, common)
  const input = { leadId: 41, eventId: 101, isTest: false, fields: { callback_phone: lead.phone, callback_window: "after 3" } }
  return { lead, links, messages, queries, provider, glass, followUpAssistantLead, input, sql, common, env, setAllowed: (value) => { allowed = value } }
}

test("photo invite uses the real persisted SMS path once per lead, including retries and another session", async () => {
  const h = fixture()
  await h.followUpAssistantLead(h.input)
  await h.followUpAssistantLead({ ...h.input, eventId: 102 })
  assert.equal(h.messages.size, 1)
  assert.equal(h.provider.length, 1)
  assert.equal(h.links.size, 1)
  assert.equal([...h.messages.keys()][0], "assistant-photo:41")
  assert.match(h.provider[0].body, /https:\/\/shop\.example\.test\/j\/[a-f0-9]{64}$/)
  assert.equal([...h.messages.values()][0].lead_id, 41)
  assert.equal([...h.messages.values()][0].person_id, 9)
})

test("test leads, test people, missing callback, changed phone, disabled SMS and unknown consent never send", async () => {
  for (const options of [
    { lead: { is_test: true } }, { lead: { person_is_test: true } }, { configured: false }, { allowed: false },
  ]) {
    const h = fixture(options)
    await h.followUpAssistantLead({ ...h.input, isTest: Boolean(options.lead?.is_test) })
    assert.equal(h.provider.length, 0)
    assert.equal(h.messages.size, 0)
    assert.equal(h.links.size, 0)
  }
  for (const phone of [null, "+16155550888"]) {
    const h = fixture()
    await h.followUpAssistantLead({ ...h.input, fields: { callback_phone: phone } })
    assert.equal(h.provider.length, 0)
  }
})

test("missing Glass secret skips only photos while an unconfirmed receipt fails closed", async () => {
  const h = fixture({ noSecret: true })
  await h.followUpAssistantLead(h.input)
  assert.match(h.lead.notes, /Assistant callback requested: after 3/)
  assert.equal(h.messages.size, 0)
  const missing = fixture({ missingReceipt: true })
  await assert.rejects(missing.followUpAssistantLead(missing.input), /receipt could not be confirmed/)
  assert.equal(missing.provider.length, 0)
})

test("callback notes update on late turns, remove money, preserve existing notes and never duplicate", async () => {
  const h = fixture({ configured: false })
  await h.followUpAssistantLead(h.input)
  await h.followUpAssistantLead(h.input)
  assert.equal((h.lead.notes.match(/Assistant callback requested:/g) ?? []).length, 1)
  await h.followUpAssistantLead({ ...h.input, fields: { callback_window: "tomorrow morning; $450" } })
  assert.match(h.lead.notes, /^Owner note \$900\nAssistant callback requested: tomorrow morning/)
  assert.match(h.lead.crew_notes, /^Crew note\nAssistant callback requested: tomorrow morning/)
  assert.doesNotMatch(h.lead.notes, /after 3|\$450/)
  assert.doesNotMatch(h.lead.crew_notes, /900|\$450/)
  const ops = readFileSync(new URL("../lib/ops-data.ts", import.meta.url), "utf8")
  const page = readFileSync(new URL("../app/ops/leads/[id]/page.tsx", import.meta.url), "utf8")
  assert.match(ops, /notes: redactCrewText\(lead\.crew_notes/)
  assert.match(page, /defaultValue=\{lead\.notes\}/)
})

test("later receipt-backed phone and name fill the same partial email lead without changing established contact", async () => {
  const h = fixture({ configured: false, lead: {
    first_name: "Assistant callback (partial)", phone: "", email: "ava@example.com",
    message: "Partial assistant request. Missing: name, callback phone. Conversation: human please",
  }, receiptFields: { name: null, callback_phone: "+16155550199" } })
  await h.followUpAssistantLead({ ...h.input, fields: { callback_phone: "+16155550199" } })
  assert.equal(h.lead.phone, "+16155550199")
  assert.equal(h.lead.email, "ava@example.com")
  assert.equal(h.lead.first_name, "Assistant callback (partial)")
  h.lead.receipt_fields = { name: "Ava", callback_phone: "+16155550199", email: "changed@example.com" }
  await h.followUpAssistantLead({ ...h.input, eventId: 102, fields: h.lead.receipt_fields })
  assert.equal(h.lead.first_name, "Ava")
  assert.equal(h.lead.email, "ava@example.com", "an established email is not replaced")
  h.lead.receipt_fields = { name: "Different person", callback_phone: "+16155550888", email: "different@example.com" }
  await h.followUpAssistantLead({ ...h.input, eventId: 103, fields: h.lead.receipt_fields })
  assert.equal(h.lead.first_name, "Ava")
  assert.equal(h.lead.phone, "+16155550199")
  assert.equal(h.lead.email, "ava@example.com")
  const projections = h.queries.filter((query) => query.text.startsWith("UPDATE leads SET first_name"))
  assert.equal(projections.length, 3)
  assert.ok(projections.every(({ text }) => text.includes("phone_is_placeholder") && text.includes("source = ANY") && text.includes("Partial assistant request.")))
  assert.equal(h.messages.size, 0)
  assert.equal(h.provider.length, 0)
})

test("partial contact projection uses immutable receipt fields and replaces only a placeholder phone", async () => {
  const h = fixture({ configured: false, lead: {
    first_name: "Assistant callback (partial)", phone: "+16157033296", phone_is_placeholder: true,
    message: "Partial assistant request. Missing: name.",
  }, receiptFields: { name: "Ava", callback_phone: "+16155550199", email: "ava@example.com" } })
  await h.followUpAssistantLead({ ...h.input, fields: { name: "Forged", callback_phone: "+16155550888", email: "forged@example.com" } })
  assert.equal(h.lead.first_name, "Ava")
  assert.equal(h.lead.phone, "+16155550199")
  assert.equal(h.lead.phone_is_placeholder, false)
  assert.equal(h.lead.email, "ava@example.com")
  const receipt = h.queries[0].text
  assert.match(receipt, /e\.detail->'fields' AS receipt_fields/)
  assert.match(receipt, /JOIN events e ON e\.id = \? ::bigint AND e\.lead_id = l\.id/)
})

test("ordinary leads, missing receipt evidence, reserved phones and malformed emails cannot gain partial contact", async () => {
  for (const options of [
    { lead: { message: "ordinary request" }, receiptFields: { name: "Ava", callback_phone: "+16155550199" } },
    { lead: { source: "email-in" }, receiptFields: { name: "Ava", callback_phone: "+16155550199" } },
    { lead: { intake_key: "unrelated:identity" }, receiptFields: { name: "Ava", callback_phone: "+16155550199" } },
    { receiptFields: null },
    { receiptFields: { callback_phone: "+16157033296", email: "bad\n@example.com" } },
    { receiptFields: { callback_phone: "+16158104910", email: "not-email" } },
    { receiptFields: { callback_phone: "+16155550100" } },
  ]) {
    const h = fixture({ configured: false, ...options, lead: {
      first_name: "Assistant callback (partial)", phone: "", email: "",
      message: "Partial assistant request. Missing: callback phone.", ...options.lead,
    } })
    await h.followUpAssistantLead({ ...h.input, fields: { name: "Injected", callback_phone: "+16155550888", email: "injected@example.com" } })
    assert.equal(h.lead.phone, "")
    assert.equal(h.lead.email, "")
    assert.equal(h.lead.first_name, "Assistant callback (partial)")
    assert.equal(h.queries.filter((query) => query.text.startsWith("UPDATE leads SET first_name")).length, 0)
    assert.equal(h.provider.length, 0)
  }
})

test("partial test contacts stay in their partition and never send a photo invitation", async () => {
  const h = fixture({ lead: {
    first_name: "Assistant callback (partial)", phone: "", email: "ava@example.com", is_test: true,
    message: "[INTERNAL TEST] Partial assistant request. Missing: callback phone.",
  }, receiptFields: { name: "Ava", callback_phone: "+16155550199" } })
  await h.followUpAssistantLead({ ...h.input, isTest: true, fields: h.lead.receipt_fields })
  assert.equal(h.lead.phone, "+16155550199")
  assert.equal(h.messages.size, 0)
  assert.equal(h.provider.length, 0)
  assert.equal(h.links.size, 0)
})

test("assistant link reconstruction is stable and expired or revoked links never reopen", async () => {
  for (const closed of ["expired", "revoked"]) {
    const h = fixture()
    const token = await h.glass.createOrReuseAssistantGlassLink(41)
    assert.equal(await h.glass.createOrReuseAssistantGlassLink(41), token)
    const row = [...h.links.values()][0]
    if (closed === "expired") row.expires_at = new Date(Date.now() - 1).toISOString()
    else row.revoked_at = new Date().toISOString()
    assert.equal(await h.glass.createOrReuseAssistantGlassLink(41), null)
    assert.equal(h.links.size, 1)
    assert.equal(row.revoked_at !== null, closed === "revoked")
  }
})

test("existing active customer links are reused and corrupt link state fails verification", async () => {
  const h = fixture()
  const token = await h.glass.createOrReuseAssistantGlassLink(41)
  const row = [...h.links.values()][0]
  assert.equal(await h.glass.createOrReuseAssistantGlassLink(41), token)
  row.token_nonce = "corrupt"
  await assert.rejects(h.glass.createOrReuseAssistantGlassLink(41), /could not be verified/)
  assert.equal(h.links.size, 1)
})

test("real upload flow rejects expiry, over-size and wrong type before Blob authorization", async () => {
  const h = fixture()
  const token = await h.glass.createOrReuseAssistantGlassLink(41)
  const uploadQueries = []
  const sql = async (strings, ...values) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim()
    uploadQueries.push({ text, values })
    if (text.startsWith("WITH held AS MATERIALIZED")) return [{ expired: 0 }]
    if (text.includes("INSERT INTO glass_uploads")) {
      assert.match(text, /link\.token_hash, link\.lead_id, link\.person_id/)
      assert.match(values[4], /^glass\/41\//)
      return [{ id: values[2], pathname: values[4], status: "pending" }]
    }
    throw new Error(`Unexpected upload SQL: ${text}`)
  }
  const modules = new Map(h.common)
  modules.set("@/lib/db", { getSql: () => sql })
  modules.set("@/lib/glass", { ...h.glass, extendGlassLinkExpiry: async () => "future" })
  modules.set("@vercel/blob", { get: async () => { throw new Error("Blob must not be called") }, head: async () => { throw new Error("Blob must not be called") } })
  modules.set("@/lib/public-quote.ts", { imageTypeMatches: () => true })
  modules.set("@/lib/shop-brain-invariants.ts", { validateCustomerUploadMetadata, GLASS_UPLOAD_PENDING_EXPIRY_MS })
  const uploads = load("lib/glass-uploads.ts", h.env, modules)
  const input = { token, uploadId: "synthetic-upload-123", batchId: "synthetic-batch-123", filename: "gate.jpg", contentType: "image/jpeg", size: 100 }
  assert.equal((await uploads.createGlassUploadIntent(input)).status, "pending")
  const count = uploadQueries.length
  for (const bad of [{ size: 20 * 1024 * 1024 + 1 }, { filename: "gate.exe" }, { contentType: "text/html" }]) {
    await assert.rejects(uploads.createGlassUploadIntent({ ...input, ...bad }), /20 MB|Use JPG|does not match/)
    assert.equal(uploadQueries.length, count, "invalid metadata never reserves storage")
  }
  const row = [...h.links.values()][0]
  row.expires_at = new Date(Date.now() - 1).toISOString()
  await assert.rejects(uploads.createGlassUploadIntent(input), /closed/)
  await assert.rejects(uploads.authorizeGlassUploadToken("glass/41/file.jpg", JSON.stringify({ token, uploadId: input.uploadId })), /closed/)
  assert.equal(uploadQueries.length, count)
})

test("shared turn path sends after receipt and resumes a crashed finish without another photo SMS", async () => {
  const h = fixture()
  let result = null
  let response = null
  let leadId = null
  let crash = true
  let receipts = 0
  const store = {
    begin: async (value) => response ?? { token: "lease", session: { id: value.session_id, lead_id: leadId, is_test: false }, turn: { result, lead_captured: Boolean(leadId) } },
    history: async () => [], verifyLease: async () => {}, release: async () => {},
    saveModel: async (_claim, _index, value) => { result = value },
    saveLead: async (_claim, _index, value) => { leadId = value },
    finish: async (_claim, _index, value) => { if (crash) { crash = false; throw new Error("crash before response") } response = value },
  }
  const deps = {
    store, rateLimit: async () => false, fingerprint: (value) => value,
    phone: { display: "Shop", href: "tel:+16157033296" }, validPhone: normalizeUsPhone,
    model: async () => ({ reply: "What material is it?", fields: { name: "Ava", need: "gate repair", callback_phone: h.lead.phone,
      material_size: null, location: null, timing: null, callback_window: "after 3; $100", is_job: "yes" } }),
    fileLead: async () => ({ leadId: 41, isTest: false }), receipt: async () => { receipts++; return 101 }, notify: async () => {},
    followUpLead: async (value) => { assert.ok(receipts > 0); await h.followUpAssistantLead(value) },
  }
  const input = { session_id: "synthetic-session", turn_index: 0, message: "Call after 3", is_test: false }
  await assert.rejects(processAssistantTurn(input, "ip", deps), /crash before response/)
  assert.equal((await processAssistantTurn(input, "ip", deps)).lead_saved, true)
  assert.equal(h.provider.length, 1)
  assert.equal(h.messages.size, 1)
  assert.equal((await processAssistantTurn(input, "ip", deps)).lead_saved, true)
  assert.equal(receipts, 2, "completed replay performs no followup work")
  assert.doesNotMatch(JSON.stringify(result), /\$100/)
})

test("persisted failed and unknown photo deliveries finish assistant turns without resending", async () => {
  for (const failure of ["failed", "unknown"]) {
    const h = fixture({ failure })
    const responses = new Map()
    const deps = {
      store: {
        begin: async (input) => responses.get(input.turn_index) ?? {
          token: "lease", session: { lead_id: 41, is_test: false }, turn: { result: null, lead_captured: false },
        },
        history: async () => [], verifyLease: async () => {}, release: async () => {}, saveModel: async () => {},
        finish: async (_claim, index, response) => { responses.set(index, response) },
      },
      rateLimit: async () => false, fingerprint: (value) => value, phone: { display: "Shop", href: "tel:+16157033296" },
      validPhone: normalizeUsPhone, model: async () => ({ reply: "What material is it?", fields: {
        name: "Ava", callback_phone: h.lead.phone, need: "gate repair", material_size: null, location: null,
        timing: null, callback_window: "after 3", is_job: "yes",
      } }),
      receipt: async () => 101, notify: async () => {}, followUpLead: h.followUpAssistantLead,
    }
    const input = { session_id: "local-session", turn_index: 0, message: "Call after 3", is_test: false }
    assert.equal((await processAssistantTurn(input, "ip", deps)).lead_saved, true)
    assert.equal((await processAssistantTurn({ ...input, turn_index: 1 }, "ip", deps)).lead_saved, true)
    assert.equal((await processAssistantTurn(input, "ip", deps)).lead_saved, true)
    assert.equal(responses.size, 2)
    assert.equal(h.provider.length, 1)
    assert.equal([...h.messages.values()][0].status, failure)
  }
})

test("consent is checked again by persisted SMS and a revoked intent never reaches Twilio", async () => {
  const h = fixture({ revokeAtSend: true })
  await h.followUpAssistantLead(h.input)
  assert.equal(h.provider.length, 0)
  assert.equal([...h.messages.values()][0].status, "canceled")
})

test("a changed callback never resumes a prior per-lead intent to the old number", async () => {
  for (const status of ["persisted", "failed", "unknown"]) {
    const h = fixture()
    h.messages.set("assistant-photo:41", { id: 1, lead_id: 41, to_phone: h.lead.phone, status })
    h.lead.phone = "+16155550888"
    await h.followUpAssistantLead({ ...h.input, fields: { callback_phone: h.lead.phone } })
    assert.equal(h.provider.length, 0)
    assert.equal(h.messages.size, 1)
    assert.equal([...h.messages.values()][0].status, status)
    assert.equal(h.links.size, 0)
  }
})

test("a failure before SMS intent persistence stays retryable rather than silently dropping the invitation", async () => {
  for (const options of [{ smsDbFailure: true }, { claimDbFailure: true }]) {
    const h = fixture(options)
    await assert.rejects(h.followUpAssistantLead(h.input), /SMS (intent|claim) storage failure/)
    assert.equal(h.messages.size, options.smsDbFailure ? 0 : 1)
    if (h.messages.size) assert.equal([...h.messages.values()][0].status, "persisted")
    assert.equal(h.provider.length, 0)
  }
})
