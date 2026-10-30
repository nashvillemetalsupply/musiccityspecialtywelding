// Explicit isolated QA runner only, intentionally outside the normal *.test.mjs glob.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import test, { after } from "node:test"
import ts from "typescript"
import { Pool, neonConfig } from "@neondatabase/serverless"
import WebSocket from "ws"

const url = new URL(process.env.DATABASE_URL || "postgres://invalid")
assert.equal(process.env.MCSW_DISPOSABLE_DATABASE, "1")
assert.equal(url.hostname, "127.0.0.1")
assert.equal(url.pathname, "/mcsw_predeploy")
neonConfig.webSocketConstructor = WebSocket
const pool = new Pool({ connectionString: url.href, max: 8 })
after(() => pool.end())
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const sql = async (strings, ...values) => (await pool.query(
  strings.reduce((query, part, index) => query + part + (index < values.length ? `$${index + 1}` : ""), ""), values,
)).rows

// Actual production functions + actual SQL. Only external boundaries are adapters.
function loadModule(relative, adapters = new Map(), cache = new Map()) {
  const filename = path.resolve(root, relative)
  if (cache.has(filename)) return cache.get(filename)
  const loaded = { exports: {} }
  cache.set(filename, loaded.exports)
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const require = (name) => {
    if (name === "@/lib/db") return { getSql: () => sql }
    if (adapters.has(name)) return adapters.get(name)
    if (name === "node:crypto") return { randomUUID }
    if (name.startsWith("@/lib/") || name.startsWith("./")) {
      let target = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name)
      if (!existsSync(target)) target += ".ts"
      return loadModule(path.relative(root, target), adapters, cache)
    }
    throw new Error(`External boundary has no local adapter: ${name}`)
  }
  const context = vm.createContext({ Date, Error, Request, Response, URL, console, process: { env: { TWILIO_PHONE_NUMBER: "+16155550100" } } })
  vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, require, loaded)
  cache.set(filename, loaded.exports)
  return loaded.exports
}
async function fixture(isTest = false) {
  const rows = await pool.query(`INSERT INTO leads(public_id,first_name,phone,service,source,is_test)
    VALUES($1,'Local QA','+16155550183','Gate fabrication','local-predeploy',$2) RETURNING id`, [randomUUID(), isTest])
  const owner = (await pool.query("SELECT id FROM operators WHERE role='owner' AND active=true LIMIT 1")).rows[0]
  return { leadId: Number(rows.rows[0].id), ownerId: Number(owner.id) }
}
const events = loadModule("lib/events.ts")

test("real database preserves event journal truth and strips money from crew board trails", async () => {
  const { leadId } = await fixture()
  const safeId = await events.recordEvent({ leadId, kind: "note", body: "Owner cost $777", crewBody: "Weld ready", externalId: randomUUID() })
  await events.recordEvent({ leadId, kind: "invoice.payment-received", body: "Private balance $12345", externalId: randomUUID() })
  await assert.rejects(pool.query("UPDATE events SET body='rewritten' WHERE id=$1", [safeId]), /immutable|append.only/i)
  await assert.rejects(pool.query("DELETE FROM events WHERE id=$1", [safeId]), /immutable|append.only/i)
  const owner = await events.listBoardEventTrails([leadId], "owner", 12)
  const crew = await events.listBoardEventTrails([leadId], "crew", 12)
  assert.match(JSON.stringify([...owner.values()]), /12345/)
  const serialized = JSON.stringify([...crew.values()])
  assert.doesNotMatch(serialized, /12345|777|"tsv"|"crew_tsv"/)
  assert.match(serialized, /Weld ready/)
})

test("real payment ledger converges simultaneous duplicate receipts and immutable reversals", async () => {
  const { leadId, ownerId } = await fixture(true)
  const api = loadModule("lib/payment-ledger.ts")
  const sourceEventId = await events.recordEvent({ leadId, kind: "email.in", body: "[INTERNAL TEST] receipt", externalId: randomUUID() })
  const input = { leadId, sourceEventId, occurredAt: new Date().toISOString(), amountCents: 10000,
    invoiceNumber: "LOCAL-1", invoiceTotalCents: 20000, balanceCents: 10000, explicitFullPayment: false, isTest: true, body: "Local payment receipt" }
  const results = await Promise.all([api.applyQuickBooksPayment(input), api.applyQuickBooksPayment(input)])
  assert.equal(results[0].receiptEventId, results[1].receiptEventId)
  assert.equal(Number((await pool.query("SELECT paid_amount_cents FROM leads WHERE id=$1", [leadId])).rows[0].paid_amount_cents), 10000)
  const reversal = { leadId, operatorId: ownerId, amountCents: 2500, reason: "Local duplicate correction", idempotencyKey: randomUUID() }
  const reversed = await Promise.all([api.applyPaymentReversal(reversal), api.applyPaymentReversal(reversal)])
  assert.equal(reversed[0].eventId, reversed[1].eventId)
  assert.equal(Number((await pool.query("SELECT paid_amount_cents FROM leads WHERE id=$1", [leadId])).rows[0].paid_amount_cents), 7500)
  await api.applyQuickBooksPayment(input)
  assert.equal(Number((await pool.query("SELECT paid_amount_cents FROM leads WHERE id=$1", [leadId])).rows[0].paid_amount_cents), 7500)
  await assert.rejects(api.applyPaymentReversal({ ...reversal, idempotencyKey: randomUUID(), amountCents: 8000 }), /exceed/)
})

test("real database suppresses test SMS and consent revoked after durable enqueue", async () => {
  const consent = loadModule("lib/messaging-consent.ts")
  const { leadId, ownerId } = await fixture()
  let sends = 0
  const adapters = new Map([
    ["@/lib/twilio", { twilioSmsConfigured: () => true, twilioCallbackUrl: (value) => value, isDefinitiveTwilioError: () => false, sendSms: async () => { sends++; return { sid: `SM${randomUUID()}`, status: "accepted" } } }],
    ["@/lib/notify", { notify: async () => {}, notifyAll: async () => {} }],
    ["@/lib/sms-quiet-hours.ts", { isCentralQuietHours: () => false, getDeferredSmsSendAt: () => new Date(Date.now() - 1000) }],
  ])
  const api = loadModule("lib/messages.ts", adapters)
  await consent.recordMessagingConsent({ phone: "+16155550183", source: "START", externalId: randomUUID(), leadId, operatorId: ownerId })
  const queued = await api.sendSmsPersisted({ to: "+16155550183", body: "Your gate is ready", leadId, operatorId: ownerId, idempotencyKey: randomUUID() })
  assert.equal(queued.deferred, true)
  await consent.recordMessagingConsent({ phone: "+16155550183", source: "STOP", externalId: randomUUID(), leadId })
  await api.sendDeferredSms()
  assert.equal((await pool.query("SELECT status FROM messages WHERE id=$1", [queued.id])).rows[0].status, "canceled")
  assert.equal(sends, 0)
  await consent.recordMessagingConsent({ phone: "+16155550183", source: "START", externalId: randomUUID(), leadId })
  const internal = await fixture(true)
  await assert.rejects(api.sendSmsPersisted({ to: "+16155550183", body: "Your gate is ready", leadId: internal.leadId, idempotencyKey: randomUUID() }), /Internal test/)
  assert.equal(sends, 0)
})

test("real SMS persistence quarantines ambiguous dispatch and converges simultaneous retries", async () => {
  const { leadId, ownerId } = await fixture()
  let sends = 0
  const adapters = new Map([
    ["@/lib/twilio", { twilioSmsConfigured: () => true, twilioCallbackUrl: (value) => value, isDefinitiveTwilioError: () => false, sendSms: async () => { sends++; throw new Error("local adapter lost response") } }],
    ["@/lib/notify", { notify: async () => {}, notifyAll: async () => {} }],
    ["@/lib/sms-quiet-hours.ts", { isCentralQuietHours: () => false, getDeferredSmsSendAt: () => null }],
  ])
  const api = loadModule("lib/messages.ts", adapters)
  const input = { to: "+16155550183", body: "Your gate is ready", leadId, operatorId: ownerId, idempotencyKey: randomUUID() }
  const first = await Promise.allSettled([api.sendSmsPersisted(input), api.sendSmsPersisted(input)])
  assert.ok(first.every((result) => result.status === "rejected"))
  assert.equal(sends, 1)
  assert.equal((await pool.query("SELECT status FROM messages WHERE idempotency_key=$1", [input.idempotencyKey])).rows[0].status, "unknown")
  await assert.rejects(api.sendSmsPersisted(input), /may have accepted/)
  assert.equal(sends, 1)
})

test("actual call route with real persistence cannot redial an ambiguous intent or reuse it for another job", async () => {
  const { leadId, ownerId } = await fixture()
  let dials = 0
  const adapters = new Map([
    ["@/lib/ops-auth", { getAuthenticatedOperator: async () => ({ id: ownerId, role: "owner", name: "Local QA", cell_phone: "+16155550122" }) }],
    ["@/lib/people", { normalizePhone: (phone) => phone, isReservedShopPhone: () => false }],
    ["@/lib/notify", { notify: async () => {} }],
    ["@/lib/twilio", { twilioVoiceConfigured: () => true, isDefinitiveTwilioError: () => false, twilioCallbackUrl: (value) => value,
      startVoiceCall: async () => { dials++; throw new Error("local adapter lost response") } }],
  ])
  const api = loadModule("app/api/ops/call/route.ts", adapters)
  const intentKey = randomUUID()
  const post = (id) => api.POST(new Request("https://fixture.invalid/api/ops/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: id, targetPhone: "+16155550183", intentKey }) }))
  assert.equal((await post(leadId)).status, 502)
  assert.equal((await post(leadId)).status, 409)
  assert.equal((await post((await fixture()).leadId)).status, 409)
  assert.equal(dials, 1)
})

test("real upload receipts authorize before storage and converge delayed callback with finish", async () => {
  const { leadId, ownerId } = await fixture(true)
  let heads = 0
  const id = randomUUID()
  const pathname = `closeouts/${id}-local.jpg`
  await pool.query(`INSERT INTO closeout_photo_uploads(id,lead_id,operator_id,upload_mode,pathname,original_name,content_type,size_bytes,is_test,expires_at)
    VALUES($1,$2,$3,'completion',$4,'local.jpg','image/jpeg',1234,true,now()+interval '1 hour')`, [id, leadId, ownerId, pathname])
  const api = loadModule("lib/closeout-photo-uploads.ts", new Map([
    ["@/lib/operators", { requireLeadMutationAccess: async () => { throw new Error("Unexpected creation") } }],
    ["@vercel/blob", { head: async () => { heads++; return { pathname, size: 1234 } } }],
  ]))
  const input = { id, leadId, operatorId: ownerId, mode: "completion", isTest: true }
  for (const changed of [{ leadId: leadId + 1 }, { operatorId: ownerId + 1 }, { mode: "addendum" }, { isTest: false }]) {
    await assert.rejects(api.getCloseoutPhotoUpload({ ...input, ...changed }), /unavailable/)
  }
  assert.equal(heads, 0)
  await Promise.all([api.getCloseoutPhotoUpload(input), api.confirmCloseoutPhotoUpload(id, pathname)])
  assert.equal((await pool.query("SELECT status FROM closeout_photo_uploads WHERE id=$1", [id])).rows[0].status, "uploaded")
  const before = heads
  await api.confirmCloseoutPhotoUpload(id, pathname)
  assert.equal(heads, before)
})
