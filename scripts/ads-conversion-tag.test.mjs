import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import { Resend as ResendClient } from "resend"
import ts from "typescript"
import { findBoundGa4MeasurementIds } from "./verify-ads-tag.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

const AW_CONTAINER = "AW-17817632790"
const SEND_TO = "AW-17817632790/CZF4CMyQhPEbEJaAjrBC"
const PHONE_SEND_TO = "AW-17817632790/0aSACPS5ue4cEJaAjrBC"

const require = createRequire(import.meta.url)

function quotePhoto(name, content = 0) {
  return new File([Uint8Array.of(0xff, 0xd8, 0xff, content)], name, { type: "image/jpeg" })
}

function quoteRouteHarness({
  message = "Repair a bracket", upload = () => {}, failLeadRead = "", emailConfigured = false, vercelEnvironment = "production",
  email = "", checkEmail = () => {}, checkPhotos = () => {}, checkAlert = () => {}, checkPhotoReservation = () => {},
  storeQuoteFingerprints = true, activeOwners = [1], checkDelivery = () => {},
} = {}) {
  const intakeKey = "10000000-0000-4000-8000-000000000001"
  const leads = new Map()
  const quoteIntakes = new Map()
  const photoIntents = new Map()
  const blobs = new Map()
  const photoReceipts = []
  const alerts = []
  const emails = []
  const providerCalls = []
  const providerReceipts = new Map()
  const errors = []
  const events = []
  const consents = []
  const reviewAttempts = new Map()
  let now = Date.parse("2026-11-27T12:00:00.000Z")
  const env = {
    VERCEL_ENV: vercelEnvironment,
    BLOB_READ_WRITE_TOKEN: "stub",
    ...(emailConfigured ? { RESEND_API_KEY: "stub", QUOTE_FROM_EMAIL: "from@example.test", QUOTE_TO_EMAIL: "owner@example.test" } : {}),
  }
  const context = vm.createContext({
    Buffer, File, Response, Uint8Array,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])) }
      static now() { return now }
    },
    process: { env },
    console: { error: (...args) => errors.push(args), warn() {} },
  })
  const findLead = (id) => [...leads.values()].find((row) => row.id === id)
  const fakes = {
    "node:crypto": require("node:crypto"),
    "resend": { Resend: class {
      get webhooks() { return new ResendClient("stub").webhooks }
      emails = { send: async (payload, options) => {
      const payloadBytes = JSON.stringify(payload)
      providerCalls.push({ payloadBytes, key: options.idempotencyKey, attempt: events.at(-1) })
      const prior = providerReceipts.get(options.idempotencyKey)
      if (prior) return prior.payloadBytes === payloadBytes ? prior.receipt : {
        data: null, error: { statusCode: 409, message: "Idempotency key has a different payload" },
      }
      const response = checkEmail("send", options.idempotencyKey.startsWith("quote-owner:") ? "shop" : "customer")
      const status = response?.error?.statusCode
      if (status >= 400 && status < 500 && ![408, 409, 429].includes(status)) return response
      emails.push({ payload, options })
      const receipt = { data: { id: `email-${emails.length}` } }
      providerReceipts.set(options.idempotencyKey, { receipt, payloadBytes })
      return response ?? receipt
    } } } },
    "@vercel/blob": {
      put: async (pathname, file) => {
        await upload(pathname, file)
        blobs.set(pathname, file)
        return { pathname }
      },
      get: async (pathname) => {
        const file = blobs.get(pathname)
        return file ? { statusCode: 200, stream: file.stream(), blob: { size: file.size } } : null
      },
    },
    "next/server": { after() {} },
    "@/lib/db": {
      dbConfigured: () => true,
      getSql: () => async (strings, ...values) => {
        const sql = strings.join("?")
        const [leadId] = values
        if (sql.includes("WITH inserted_lead")) {
          const [public_id, first_name, last_name, phone, email, service, message, preferred_contact, photo_count, source] = values
          const id = leads.size + 1
          const is_test = values[20]
          const saved = {
            id, public_id, person_id: null, first_name, last_name, phone, email, service,
            message, preferred_contact, photo_count, quote_form_photo_count: values[27], is_test, source, photos: new Set(),
            email_delivery_status: "pending", email_delivery_error: "",
            created_at: new Date(now - 5000).toISOString(), gclid: values[10], utm_source: values[11], referrer: values[17],
          }
          leads.set(values[25], saved)
          if (values[30]) consents.push(values[28])
          if (storeQuoteFingerprints && sql.includes("INSERT INTO quote_intakes") && values[34]) {
            quoteIntakes.set(values[25], { count: values[31], fingerprints: JSON.parse(values[32]), environment: values[33] })
          }
          return [saved]
        }
        if (sql.includes("FROM leads WHERE intake_key")) {
          const saved = leads.get(leadId)
          return saved ? [{ ...saved, quote_photos: quoteIntakes.get(leadId) ?? null }] : []
        }
        if (sql.includes("FROM leads WHERE id")) {
          if ((failLeadRead === "route" && sql.includes("person_id, first_name")) ||
              (failLeadRead === "creation-event" && sql.includes("person_id, is_test"))) {
            throw new Error("Post-create lookup unavailable")
          }
          return [findLead(leadId)].filter(Boolean)
        }
        if (sql.includes("INSERT INTO messaging_consents")) {
          consents.push(values[0])
          return []
        }
        if (sql.includes("FROM notifications") && sql.includes("WHERE provider_email_id =")) return []
        if (sql.includes("FROM events accepted_event")) {
          const acceptance = events.find(({ kind, externalId }) => kind === "email.accepted" && externalId === values[0])
          return acceptance ? [{ kind: acceptance.kind, lead_id: acceptance.leadId, person_id: acceptance.personId,
            detail: acceptance.detail, audience: acceptance.detail.audience, is_test: false }] : []
        }
        if (sql.includes("WITH incoming AS") && sql.includes("UPDATE leads SET")) {
          const [status, error, preserveResolved, leadId] = values
          const lead = findLead(leadId)
          checkDelivery(status, leadId)
          if (status === "bounced" && (!preserveResolved || lead.email_delivery_status !== "resolved")) {
            Object.assign(lead, { email_delivery_status: "failed", email_delivery_error: error })
          } else if (status === "failed" && !["accepted", "sent", "delayed", "delivered", "resolved"].includes(lead.email_delivery_status)) {
            Object.assign(lead, { email_delivery_status: "rejected", email_delivery_error: error })
          }
          return []
        }
        if (sql.includes("WITH signed_failures AS")) {
          assert.match(sql, /receipt\.detail->>'providerType' IN \('email\.bounced', 'email\.complained', 'email\.failed', 'email\.suppressed'\)/)
          assert.match(sql, /n\.dedupe_key = failure\.alert_key/)
          assert.match(sql, /l\.email_delivery_error IS DISTINCT FROM failure\.body/)
          assert.match(sql, /l\.email_delivery_status IS DISTINCT FROM 'resolved'/)
          const signed = events.filter(({ kind, leadId, externalId, detail }) =>
            kind === "email.failed" && findLead(leadId)?.is_test === false && !detail.isTest && detail.providerEmailId
              && ["email.bounced", "email.complained", "email.failed", "email.suppressed"].includes(detail.providerType)
              && externalId === `resend:${detail.providerType}:${detail.providerEmailId}`)
          return signed.flatMap((receipt) => {
            const { id, leadId, body, detail } = receipt
            const lead = findLead(leadId)
            const alertKey = `resend-failure:${detail.providerEmailId}`
            const repairKey = `resend-failure-repair:${id}`
            const latestForLead = signed.findLast((row) => row.leadId === leadId && row.detail.audience === "shop")
            const latestForProvider = signed.findLast((row) => row.detail.providerEmailId === detail.providerEmailId)
            const repairDelivery = latestForLead === receipt && lead.email_delivery_status !== "resolved"
              && (lead.email_delivery_status !== "failed" || lead.email_delivery_error !== body)
            const fileAlert = latestForProvider === receipt && !alerts.some(({ dedupeKey }) => dedupeKey === alertKey)
            if (!(repairDelivery || fileAlert) || now - (reviewAttempts.get(repairKey) ?? -Infinity) < 15 * 60 * 1000) return []
            return [{ id, lead_id: leadId, body, alert_key: alertKey, repair_key: repairKey,
              repair_delivery: repairDelivery, file_alert: fileAlert }]
          }).slice(0, 20)
        }
        if (sql.includes("FROM events intent JOIN leads")) {
          assert.match(sql, /rejection\.detail->>'attemptEventId' = attempt\.id::text/)
          assert.match(sql, /intent\.recorded_at AS created_at/)
          assert.match(sql, /intent\.recorded_at < now\(\) - interval '15 minutes'/)
          assert.match(sql, /intake\.environment = \?::text OR intake\.environment IS NULL/)
          assert.match(sql, /intent\.detail->>'environment' = \?::text OR intent\.detail->>'environment' IS NULL/)
          assert.match(sql, /failure\.id = attempts\.rejection_id AND attempts\.unresolved_at IS NULL/)
          assert.match(sql, /n\.operator_id = o\.id AND n\.is_test = false/)
          assert.match(sql, /n\.dedupe_key = keys\.intake_alert_key/)
          assert.match(sql, /n\.created_at >= failure\.recorded_at AND n\.body LIKE '%OWNER EMAIL FAILED%'/)
          assert.match(sql, /OR eligibility\.repair_delivery\s+OR cardinality\(recipients\.owner_ids\) > 0/)
          assert.match(sql, /recovery\.last_attempt_at <= now\(\) - interval '15 minutes'/)
          assert.match(sql, /WHEN last_attempt_at IS NULL AND queue_position <= 15 THEN 0/)
          assert.match(sql, /WHEN last_attempt_at IS NOT NULL AND queue_position <= 5 THEN 1/)
          const eligible = events.flatMap(({ id, kind, externalId, occurred_at, detail, leadId, personId }) => {
            if (kind !== "email.out" || !/^quote-(?:owner|customer):/.test(externalId)) return []
            const lead = findLead(leadId)
            const intakeEnvironment = quoteIntakes.get("website:" + externalId.split(":")[1])?.environment ?? null
            const environment = detail.environment ?? null
            if (lead.is_test || (environment !== null && environment !== values[1])
              || (intakeEnvironment !== null && intakeEnvironment !== values[0])) return []
            const receipts = events.filter(({ detail }) => detail.sourceEventId === id)
            if (receipts.some(({ kind }) => ["email.accepted", "email.delivered"].includes(kind))) return []
            const attempts = receipts.filter(({ kind }) => kind === "email.attempt")
            const rejection = (attempt) => receipts.find(({ kind, detail }) =>
              kind === "email.failed" && detail.attemptEventId === attempt.id && (detail.requestNotSent
              || (detail.providerStatus >= 400 && detail.providerStatus < 500 && ![408, 409, 429].includes(detail.providerStatus))))
            const counted = attempts.filter((attempt) => !rejection(attempt)?.detail.requestNotSent)
            const unresolved = attempts.filter((attempt) => !rejection(attempt))
            const failure = unresolved.length === 0 ? attempts
              .map(rejection)
              .findLast((receipt) => receipt && !receipt.detail.requestNotSent) : undefined
            const row = { id, lead_id: leadId, person_id: personId, audience: detail.audience,
              external_id: externalId, frozen_payload: detail.frozenPayload, created_at: occurred_at, environment,
              origin_unknown: environment === null && intakeEnvironment === null, failure_event_id: failure?.id, failure_error: failure?.body }
            const createdAge = now - Date.parse(occurred_at)
            const age = counted.length ? Math.max(...unresolved.map(({ occurred_at }) => now - Date.parse(occurred_at))) : createdAge
            const reviewKey = `quote-email-review:${id}`
            const lastAttempt = reviewAttempts.get(reviewKey)
            const backoffComplete = now - (lastAttempt ?? -Infinity) >= 15 * 60 * 1000
            const sendDue = counted.length === 0 && detail.frozenPayload
              && createdAge > 15 * 60 * 1000 && createdAge < 23 * 60 * 60 * 1000
            const reviewDue = age >= 23 * 60 * 60 * 1000 || (sendDue && row.origin_unknown)
            const failureKey = `quote-${detail.audience === "shop" ? "owner" : "customer"}-delivery:${externalId.split(":")[1]}:failed`
            const intakeAlertKey = `quote-intake:${externalId.split(":")[1]}:new-lead`
            const missingOwners = activeOwners.filter((operatorId) => !alerts.some((alert) =>
              alert.operatorId === operatorId && (alert.dedupeKey === (failure ? failureKey : reviewKey)
                || (failure && detail.audience === "shop" && alert.dedupeKey === intakeAlertKey
                  && alert.created_at >= failure.occurred_at && alert.body.includes("OWNER EMAIL FAILED")))))
            const repairDelivery = failure && detail.audience === "shop"
              && !["accepted", "sent", "delayed", "delivered", "resolved"].includes(lead.email_delivery_status)
              && (lead.email_delivery_status !== "rejected" || lead.email_delivery_error !== failure.body)
            if (!failure && !reviewDue && !sendDue) return []
            if (!backoffComplete) return []
            if ((failure || reviewDue) && !repairDelivery && !missingOwners.length) return []
            return [{ ...row, needs_review: reviewDue, review_key: reviewKey, failure_key: failureKey,
              repair_delivery: repairDelivery, owner_ids: missingOwners, age, lastAttempt }]
          }).sort((a, b) => ((a.lastAttempt ?? -Infinity) - (b.lastAttempt ?? -Infinity) || 0)
            || b.age - a.age || a.id - b.id)
          const fresh = eligible.filter(({ lastAttempt }) => lastAttempt === undefined)
          const retries = eligible.filter(({ lastAttempt }) => lastAttempt !== undefined)
          return [...fresh.splice(0, 15), ...retries.splice(0, 5), ...fresh, ...retries].slice(0, 20)
        }
        if (sql.includes("INSERT INTO sync_state") && sql.includes("last_recovery_attempt_at")) {
          assert.match(sql, /WHERE sync_state\.updated_at <= now\(\) - interval '15 minutes'/)
          if (now - (reviewAttempts.get(leadId) ?? -Infinity) < 15 * 60 * 1000) return []
          reviewAttempts.set(leadId, now)
          return [{ key: leadId }]
        }
        if (sql.includes("FROM leads l") && sql.includes("quote-event-repair:")) return []
        if (sql.includes("automation_leases")) return [{ key: "follow-up-reminders" }]
        if (["DELETE FROM rate_limits", "next_follow_up_at IS NOT NULL", "processed_at IS NULL", "FROM shop_documents",
          "INSERT INTO automation_runs"].some((fragment) => sql.includes(fragment))) return []
        if (sql.includes("FROM events WHERE lead_id")) return events.filter((row) => row.leadId === leadId && row.kind === "form.quote")
        if (sql.includes("SELECT kind") && sql.includes("detail->>'sourceEventId'")) {
          const intent = events.find((event) => event.id === Number(leadId))
          checkEmail("receipt", intent?.detail.audience)
          const kinds = [...sql.matchAll(/'(email\.\w+)'/g)].map((match) => match[1])
          const history = events.filter((event) => kinds.includes(event.kind) && event.detail.sourceEventId === intent?.id)
          return (sql.includes("LIMIT 1") ? history.slice(-1) : history).map((event) => ({
            ...event, payload_hash: event.detail.payloadHash, attempt_event_id: event.detail.attemptEventId,
            attempt_number: event.detail.attemptNumber, idempotency_key: event.detail.idempotencyKey,
            provider_status: event.detail.providerStatus, request_not_sent: event.detail.requestNotSent,
          }))
        }
        if (sql.includes("FROM events")) {
          return events.filter((event) => event.kind === values[0] && event.externalId === values[1])
            .map((event) => ({ ...event, frozen_payload: event.detail.frozenPayload, environment: event.detail.environment ?? null, created_at: event.occurred_at }))
        }
        if (sql.includes("FROM lead_photo_intents")) {
          checkPhotos()
          const intents = [...(photoIntents.get(leadId)?.values() ?? [])].sort((a, b) => a.photo_index - b.photo_index)
          return sql.includes("AS pathname") ? intents.filter(({ status }) => status === "attached")
            .map(({ stored_pathname, filename, size_bytes }) => ({ pathname: stored_pathname, filename, size: size_bytes })) : intents
        }
        throw new Error(`Unexpected SQL mock call: ${sql}`)
      },
    },
    "@/lib/leads": {
      reserveLeadPhotoIntents: async (leadId, _intake, plans) => {
        checkPhotoReservation()
        const intents = photoIntents.get(leadId) ?? new Map()
        photoIntents.set(leadId, intents)
        for (const plan of plans) {
          const prior = intents.get(plan.photoIndex)
          if (prior && prior.target_path !== plan.targetPath) throw new Error("Reserved photo content differs")
          intents.set(plan.photoIndex, {
            photo_index: plan.photoIndex, target_path: plan.targetPath, filename: plan.filename,
            content_type: plan.contentType, size_bytes: plan.size,
            status: prior?.status ?? "pending",
            stored_pathname: prior?.stored_pathname ?? "",
          })
        }
      },
      markLeadPhotoIntent: async (leadId, _intake, index, status, { storedPathname } = {}) => {
        const intent = photoIntents.get(leadId).get(index)
        intent.status = status
        if (storedPathname) intent.stored_pathname = storedPathname
      },
      attachLeadPhotos: async (leadId, photos, { externalId }) => {
        const lead = findLead(leadId)
        const previousCount = lead.photos.size
        for (const photo of photos) lead.photos.add(photo.pathname)
        if (lead.photos.size > previousCount) photoReceipts.push(externalId)
        lead.photo_count = lead.photos.size
      },
    },
    "@/lib/notify": {
      notify: async (alert) => {
        checkAlert(alert)
        alerts.push({ ...alert, created_at: new Date(now).toISOString() })
        return { id: alerts.length }
      },
      notifyAll: (alert) => Promise.all(activeOwners.map((operatorId) => fakes["@/lib/notify"].notify({ ...alert, operatorId }))),
    },
    "@/lib/shop-contact": { getShopPhone: () => ({ display: "(615) 555-0100" }) },
    "@/lib/ops-auth": { isAuthorizedCron: (req) => req.headers.has("authorization") },
    "@/lib/email-templates": { brandedEmail: () => "", escapeHtml: (value) => value },
    "@/lib/events": { recordEvent: async (event) => {
      if (event.kind === "email.out") checkEmail("intent", event.detail.audience)
      if (event.kind === "email.attempt") checkEmail("attempt", event.detail.audience)
      if (event.kind === "email.accepted") checkEmail("acceptance", event.detail.audience)
      if (event.kind === "email.unknown") checkEmail("unknown", event.detail.audience)
      if (event.externalId && events.some((prior) => prior.kind === event.kind && prior.externalId === event.externalId)) return null
      const id = events.length + 1
      events.push({ ...event, id, occurred_at: event.occurredAt ?? new Date(now).toISOString() })
      return id
    } },
    "@/lib/extract": {}, "@/lib/media-safety": {}, "@/lib/messages": {},
    "@/lib/follow-up-cadence.ts": { getDefaultFollowUpAt: async () => null },
    "@/lib/messaging-consent": { getMessagingConsentState: async () => "unknown" },
    "@/lib/people": {
      normalizePhone: (value) => fakes["@/lib/shop-brain-invariants.ts"].normalizeUsPhone(value),
      isReservedShopPhone: () => false,
      findOrCreatePerson: async ({ leadId }) => ({ id: leadId + 100 }),
      attachLeadToPerson: async (id, personId) => { findLead(id).person_id ??= personId },
    },
    "@/lib/twilio": { twilioSmsConfigured: () => false },
  }
  function load(path) {
    const compiled = ts.transpileModule(source(path), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const exports = {}
    const run = vm.runInContext(`(function(exports, require) { ${compiled}\n })`, context)
    run(exports, (name) => {
      assert.ok(name in fakes, `Unexpected import in quote test: ${name}`)
      return fakes[name]
    })
    return exports
  }
  fakes["@/lib/public-quote.ts"] = load("lib/public-quote.ts")
  fakes["@/lib/shop-brain-invariants.ts"] = load("lib/shop-brain-invariants.ts")
  fakes["@/lib/leads"] = { ...load("lib/leads.ts"), ...fakes["@/lib/leads"] }
  fakes["@/lib/quote-email"] = load("lib/quote-email.ts")
  const { POST } = load("app/api/quote/route.ts")
  return {
    leads, quoteIntakes, photoIntents, blobs, photoReceipts, alerts, emails, providerCalls, consents, events, errors, env,
    advance: (hours) => { now += hours * 60 * 60 * 1000 },
    expireProviderReceipts() { this.advance(24); providerReceipts.clear() },
    async signedBounce(providerEmailId, reason) {
      const { createHmac } = require("node:crypto")
      const signingKey = Buffer.from("synthetic quote sweep signing key")
      env.RESEND_WEBHOOK_SECRET = `whsec_${signingKey.toString("base64")}`
      const id = "signed-quote-recovery"
      const timestamp = String(Math.floor(Date.now() / 1000))
      const body = JSON.stringify({ type: "email.bounced", data: { email_id: providerEmailId, bounce: { message: reason } } })
      const signature = createHmac("sha256", signingKey).update(`${id}.${timestamp}.${body}`).digest("base64")
      return load("app/api/resend/webhook/route.ts").POST(new Request("https://example.test/api/resend/webhook", {
        method: "POST",
        headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` },
        body,
      }))
    },
    async legacyQuoteRecovery() {
      // 8729684 used kind, external ID, lead test flag, attempts, and payload age.
      // It could not read deployment origin from either the intent or intake.
      for (const intent of events) {
        const age = now - Date.parse(intent.occurred_at)
        if (intent.kind !== "email.out" || !/^quote-(owner|customer):/.test(intent.externalId)
          || findLead(intent.leadId).is_test || !intent.detail.frozenPayload
          || age <= 15 * 60 * 1000 || age >= 23 * 60 * 60 * 1000
          || events.some(({ kind, detail }) => ["email.attempt", "email.accepted", "email.delivered"].includes(kind)
            && detail.sourceEventId === intent.id)) continue
        const { message } = JSON.parse(intent.detail.frozenPayload)
        await new fakes.resend.Resend().emails.send(message, { idempotencyKey: `${intent.externalId}:legacy-worker` })
      }
    },
    sweep() {
      for (const [name, method] of Object.entries({
        "attachment-retry": "retryPendingAttachments", "call-transcription": "retryCallTranscriptions",
        "voice-transcription": "retryVoiceTranscriptions", messages: "reconcileStaleSmsIntents",
        ingest: "reconcileRawInboundCalls", calls: "reconcileStaleOutboundCalls",
        commitments: "reconcileStaleCommitmentReschedules", "glass-uploads": "reconcileGlassUploads",
        "job-intake": "reconcileStaleCallIntakes", "call-summary": "summarizePendingCalls",
      })) fakes[`@/lib/${name}`] = { [method]: async () => 0 }
      fakes["@/lib/notify"].retryPendingInterrupts = async () => 0
      fakes["@/lib/extract"].EXTRACTABLE_EVENT_KINDS = []
      return load("lib/recovery-sweep.ts").runRecoverySweep({ trigger: "owner-manual", force: true })
    },
    submit(photos = [], { authorized = false, key = intakeKey, phone = "6155550100", textConsent = false, replyEmail = email, utmSource = "" } = {}) {
      const form = new FormData()
      for (const [name, value] of Object.entries({
        firstName: "Example", phone, service: "Not Sure / Other", message, intakeKey: key, email: replyEmail, utm_source: utmSource,
      })) form.set(name, value)
      if (textConsent) form.set("textConsent", "yes")
      for (const photo of photos) form.append("photos", photo)
      return POST({ headers: new Headers(authorized ? { authorization: "stub" } : {}), formData: async () => form })
    },
  }
}

const productionHosts = ["musiccityspecialtywelding.com", "www.musiccityspecialtywelding.com"]
const nonProductionHosts = [
  "localhost", "127.0.0.1", "mcsw-preview.vercel.app", "vercel.app",
  "musiccityspecialtywelding.com.vercel.app", "preview.musiccityspecialtywelding.com",
  "musiccityspecialtywelding.com.evil.example", "wwwmusiccityspecialtywelding.com", "",
]

function browserHarness(hostname, search = "", globals = {}) {
  const inserted = []
  const effects = []
  const triggers = []
  const window = {
    location: { hostname, search },
    addEventListener: (event, callback) => triggers.push({ event, callback }),
    removeEventListener() {},
    setTimeout: (callback) => { triggers.push({ event: "timeout", callback }); return 1 },
    clearTimeout() {},
  }
  const document = {
    createElement: () => ({}),
    getElementById: (id) => inserted.find((script) => script.id === id),
    getElementsByTagName: () => [{ parentNode: { insertBefore: (script) => inserted.push(script) } }],
    head: { appendChild: (script) => inserted.push(script) },
  }
  const context = vm.createContext({
    window, document, URLSearchParams, process: { env: {} },
    MutationObserver: class {
      observe() { triggers.push({ event: "observe" }) }
      disconnect() {}
    },
    ...globals,
  })
  // Browser globals alias window properties (notably the Meta shim's fbq).
  Object.defineProperty(context, "fbq", { get: () => window.fbq })
  function load(path, mocks = {}) {
    const exports = {}
    const compiled = ts.transpileModule(source(path), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const run = vm.runInContext(`(function(exports, require) { ${compiled}\n })`, context)
    run(exports, (name) => {
      if (name in mocks) return mocks[name]
      if (name === "react") return { useEffect: (effect) => effects.push(effect) }
      if (name === "@/lib/measurement") return measurement
      return require(name)
    })
    return exports
  }
  const measurement = load("lib/measurement.ts")
  const analytics = load("components/public-analytics.tsx", {
    "next/script": { __esModule: true, default: () => null },
    "next/navigation": { usePathname: () => "/" },
    "@/components/attribution-tracker": { AttributionTracker: () => null },
    "@/components/deferred-google-tag": { DeferredGoogleTag: () => null },
    "@/components/phone-click-tracker": { PhoneClickTracker: () => null },
  })
  const google = load("components/deferred-google-tag.tsx")
  const publicElements = analytics.PublicAnalytics({ measurementId: "G-TEST123" }).props.children
  return {
    window, inserted, triggers, measurement, load,
    runBootstrap: (provider) => vm.runInContext(provider === "meta"
      ? analytics.metaPixelBootstrapSource(measurement.META_PIXEL_ID)
      : publicElements[0].props.children, context),
    runDeferred: () => {
      google.DeferredGoogleTag({ containerId: "GT-TWZ9WFGX" })
      publicElements[2].type()
      effects.forEach((effect) => effect())
    },
  }
}

test("ad measurement rejects local, preview, and lookalike hosts before any provider or queue side effect", () => {
  for (const hostname of nonProductionHosts) {
    const browser = browserHarness(hostname)
    assert.equal(browser.measurement.isProductionHost(hostname), false, hostname)
    const existingGoogleQueue = ["pending google"]
    const existingMetaQueue = [["track", "Lead"]]
    browser.window.dataLayer = existingGoogleQueue
    browser.window.__mcswMetaQueue = existingMetaQueue
    const providerCalls = []
    browser.window.gtag = (...args) => providerCalls.push(args)
    browser.window.fbq = (...args) => providerCalls.push(args)
    browser.measurement.queueMeasurementEvent("conversion", { send_to: SEND_TO })
    browser.measurement.queueMeasurementEvent("generate_lead", {})
    browser.measurement.queueMeasurementEvent("conversion", { send_to: PHONE_SEND_TO })
    browser.measurement.reportMetaLead()
    browser.runBootstrap("meta")
    browser.runBootstrap("google")
    browser.runDeferred()
    assert.deepEqual(providerCalls, [], hostname)
    assert.deepEqual(browser.inserted, [], hostname)
    assert.deepEqual(browser.triggers, [], hostname)
    assert.strictEqual(browser.window.dataLayer, existingGoogleQueue, hostname)
    assert.strictEqual(browser.window.__mcswMetaQueue, existingMetaQueue, hostname)
    assert.equal(existingMetaQueue.length, 1, hostname)

    const withoutProviders = browserHarness(hostname)
    withoutProviders.measurement.queueMeasurementEvent("conversion", { send_to: SEND_TO })
    withoutProviders.measurement.reportMetaLead()
    withoutProviders.runBootstrap("meta")
    withoutProviders.runBootstrap("google")
    for (const key of ["dataLayer", "gtag", "fbq", "__mcswMetaQueue"]) {
      assert.equal(withoutProviders.window[key], undefined, `${hostname}: ${key}`)
    }
    assert.deepEqual(withoutProviders.inserted, [], hostname)
  }
})

test("both production hosts retain early Lead queues, provider calls, bootstrap replay and deferred loading", () => {
  for (const hostname of productionHosts) {
    const browser = browserHarness(hostname)
    assert.equal(browser.measurement.isProductionHost(hostname), true)
    browser.measurement.queueMeasurementEvent("generate_lead", { send_to: "G-TEST123" })
    browser.measurement.queueMeasurementEvent("conversion", { send_to: SEND_TO })
    browser.measurement.queueMeasurementEvent("conversion", { send_to: PHONE_SEND_TO })
    assert.deepEqual(Array.from(browser.window.dataLayer, (args) => Array.from(args)), [
      ["event", "generate_lead", { send_to: "G-TEST123" }],
      ["event", "conversion", { send_to: SEND_TO }],
      ["event", "conversion", { send_to: PHONE_SEND_TO }],
    ])
    browser.measurement.reportMetaLead()
    assert.equal(browser.window.__mcswMetaQueue.length, 1)
    browser.runBootstrap("meta")
    assert.equal(browser.window.__mcswMetaQueue.length, 0)
    assert.deepEqual(Array.from(browser.window.fbq.queue, (args) => Array.from(args)), [
      ["init", "1584753153193012"], ["track", "PageView"], ["track", "Lead"],
    ])
    browser.runBootstrap("google")
    assert.ok(browser.window.dataLayer.some((args) => args[0] === "config" && args[1] === AW_CONTAINER))
    browser.runDeferred()
    browser.triggers.find(({ event }) => event === "pointerdown").callback()
    assert.ok(browser.inserted.some((script) => script.id === "deferred-google-tag"))
    // The Meta effect also loads when Google's trigger already inserted the tag.
    browser.runDeferred()
    assert.ok(browser.inserted.some((script) => script.id === "meta-pixel"))

    const providerCalls = []
    browser.window.gtag = (...args) => providerCalls.push(args)
    browser.window.fbq = (...args) => providerCalls.push(args)
    browser.measurement.queueMeasurementEvent("conversion", { send_to: SEND_TO })
    browser.measurement.reportMetaLead()
    assert.deepEqual(providerCalls, [["event", "conversion", { send_to: SEND_TO }], ["track", "Lead"]])
  }
})

test("production internal-verification UTMs suppress both providers, bootstraps, deferred loaders and early queues", () => {
  for (const hostname of productionHosts) {
    for (const search of ["?utm_source=internal-verify", "?utm_medium=e2e"]) {
      const browser = browserHarness(hostname, search)
      const providerCalls = []
      browser.window.gtag = (...args) => providerCalls.push(args)
      browser.window.fbq = (...args) => providerCalls.push(args)
      browser.measurement.queueMeasurementEvent("conversion", { send_to: SEND_TO })
      browser.measurement.reportMetaLead()
      browser.runBootstrap("meta")
      browser.runBootstrap("google")
      browser.runDeferred()
      assert.deepEqual(providerCalls, [])
      assert.deepEqual(browser.inserted, [])
      assert.deepEqual(browser.triggers, [])
      assert.equal(browser.window.dataLayer, undefined)
      assert.equal(browser.window.__mcswMetaQueue, undefined)
    }
  }
  const ordinary = browserHarness(productionHosts[0], "?utm_source=google&utm_medium=cpc")
  ordinary.measurement.reportMetaLead()
  ordinary.runBootstrap("google")
  assert.equal(ordinary.window.__mcswMetaQueue.length, 1)
  assert.ok(ordinary.window.dataLayer.length > 0)
})

test("measurement Lead entry points are safe without a browser", () => {
  const compiled = ts.transpileModule(source("lib/measurement.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  const context = vm.createContext({ exports, process: { env: {} }, URLSearchParams })
  vm.runInContext(compiled, context)
  assert.doesNotThrow(() => exports.queueMeasurementEvent("conversion", { send_to: SEND_TO }))
  assert.doesNotThrow(() => exports.reportMetaLead())
})

test("the shipped conversion label is the one the Ads conversion action listens on", () => {
  const measurement = source("lib/measurement.ts")
  assert.match(
    measurement,
    new RegExp(`process\\.env\\.NEXT_PUBLIC_GOOGLE_ADS_SEND_TO[^\\n]*\\n\\s*"${SEND_TO}"`),
    `lib/measurement.ts must fall back to ${SEND_TO}; a wrong label sends every conversion to a dead destination and looks exactly like a dead tag.`,
  )
})

test("the page configures the Ads container", () => {
  const analytics = source("components/public-analytics.tsx")
  assert.ok(
    analytics.includes(`window.gtag('config', '${AW_CONTAINER}')`),
    `public-analytics.tsx must configure ${AW_CONTAINER}. Without that config gtag still exists and the base tag still pings Google, but every conversion event is dropped.`,
  )
})

test("the inline tag script declares nothing at classic-script top level", () => {
  const analytics = source("components/public-analytics.tsx")
  const start = analytics.indexOf('<Script id="google-tag"')
  assert.notEqual(start, -1, "The inline google-tag Script is gone.")
  const body = analytics.slice(start, analytics.indexOf("</Script>", start))
  // An inline <script> shares the global lexical scope. A top-level const or
  // let throws "Identifier has already been declared" if the script ever parses
  // twice, and a failed parse discards the entire body -- including the AW
  // config -- with no error on the page you are looking at. An IIFE cannot.
  assert.ok(body.includes("(function(){"), "The inline tag body must be wrapped in an IIFE.")
  for (const line of body.split("\n")) {
    const code = line.trim()
    if (/^(const|let)\s/.test(code)) {
      assert.fail(`Top-level ${code.split(" ")[0]} in the inline tag script: ${code}`)
    }
  }
})

function quoteFormHarness(route, { rejectStorageWrites = false, acknowledgeAds = true } = {}) {
  const session = new Map()
  const history = { state: { __NA: true }, replaceState(state) { this.state = state } }
  const responses = []
  const intakeKeys = []
  const adsEvents = []
  const adsTimeouts = []
  let issuedKeys = 0

  function mountForm(selectedPhotos, { storage = session, phone = "6155550100", textConsent = false } = {}) {
    const browser = browserHarness(productionHosts[0], "", {
      FormData,
      crypto: { randomUUID: () => `10000000-0000-4000-8000-${String(++issuedKeys).padStart(12, "0")}` },
      fetch: async (path, { body }) => {
        assert.equal(path, "/api/quote")
        const key = body.get("intakeKey")
        intakeKeys.push(key)
        const response = await route.submit(body.getAll("photos"), {
          key, phone: body.get("phone"), textConsent: body.get("textConsent") === "yes",
        })
        responses.push({ status: response.status, data: await response.clone().json() })
        return response
      },
    })
    browser.window.sessionStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (rejectStorageWrites) throw new Error("Session storage write denied")
        storage.set(key, value)
      },
      removeItem: (key) => storage.delete(key),
    }
    browser.window.history = history
    browser.window.setTimeout = (callback) => adsTimeouts.push(callback)
    browser.window.clearTimeout = (id) => { delete adsTimeouts[id - 1] }
    browser.window.gtag = (_command, event, params) => {
      if (event !== "conversion") return
      adsEvents.push(params)
      if (acknowledgeAds) params.event_callback?.()
    }
    const formStates = [{ firstName: "Example", phone, service: "Not Sure / Other", textConsent }, selectedPhotos]
    const formRefs = []
    let stateIndex = 0
    let refIndex = 0
    const { QuoteForm } = browser.load("components/mainstreet-contact.tsx", {
      react: {
        useEffect() {},
        useRef: (current) => formRefs[refIndex++] ??= { current },
        useState: (initial) => {
          const index = stateIndex++
          if (!(index in formStates)) formStates[index] = initial
          return [formStates[index], (value) => {
            formStates[index] = typeof value === "function" ? value(formStates[index]) : value
          }]
        },
      },
      "@/components/contact-lead": {},
      "@/lib/attribution": { captureAttribution: () => ({}) },
      "@/lib/shop-phone-shared": {},
      "@/lib/public-quote.ts": browser.load("lib/public-quote.ts"),
    })
    const render = () => {
      stateIndex = refIndex = 0
      return QuoteForm({})
    }
    const submit = () => render().props.onSubmit({ preventDefault() {} })
    return Object.assign(submit, { render })
  }

  return { mountForm, responses, intakeKeys, adsEvents, adsTimeouts, session, history }
}

test("a partial photo upload stays on the same lead and fires Ads once across a refresh", async () => {
  let storageRecovered = false
  const uploadedPhotos = []
  const route = quoteRouteHarness({
    upload: (_pathname, file) => {
      if (uploadedPhotos.includes("bracket.jpg") && file.name === "bracket.jpg") {
        throw new Error("Previously attached photo cannot be uploaded again")
      }
      uploadedPhotos.push(file.name)
      if (!storageRecovered && file.name === "hinge.jpg") throw new Error("Photo storage unavailable")
    },
  })
  const { mountForm, responses, intakeKeys, adsEvents } = quoteFormHarness(route)
  const photos = [quotePhoto("bracket.jpg"), quotePhoto("hinge.jpg")]
  const submit = mountForm(photos)
  await submit()
  assert.equal(responses[0].status, 503)
  assert.deepEqual(adsEvents.map((event) => event.send_to), [SEND_TO])
  await submit()
  assert.equal(responses[1].status, 503, "same files must retry despite the attached count dropping to one")

  storageRecovered = true
  await mountForm([...photos].reverse())()
  assert.equal(responses[2].status, 200)
  assert.equal(new Set(intakeKeys).size, 1)
  assert.equal(route.leads.size, 1)
  assert.equal(route.leads.get(`website:${intakeKeys[0]}`).photo_count, 2)
  assert.deepEqual(adsEvents.map((event) => event.send_to), [SEND_TO])
  assert.deepEqual(uploadedPhotos, ["bracket.jpg", "hinge.jpg", "hinge.jpg", "hinge.jpg"])
  assert.deepEqual(route.photoReceipts, [`quote-photos:${intakeKeys[0]}:1`, `quote-photos:${intakeKeys[0]}:2`])

  const changed = await route.submit([photos[0], quotePhoto("different.jpg")], { key: intakeKeys[0] })
  assert.equal(changed.status, 409, "a different photo with the same count must be rejected")
})

test("a quote retry keeps the saved lead across reload when session storage writes fail", async () => {
  let uploadFails = true
  const route = quoteRouteHarness({ upload: () => { if (uploadFails) throw new Error("Blob unavailable") } })
  const { mountForm, responses, intakeKeys, session, history } = quoteFormHarness(route, { rejectStorageWrites: true })
  const photos = [quotePhoto("bracket.jpg")]
  const submit = mountForm(photos)
  await submit()
  await submit()
  assert.deepEqual(responses.map(({ status }) => status), [503, 503])
  assert.equal(session.has("mcsw:quote-intake"), false)

  uploadFails = false
  await mountForm(photos)()
  assert.equal(responses[2].status, 200)
  assert.equal(new Set(intakeKeys).size, 1)
  assert.equal(route.leads.size, 1)
  assert.equal(history.state.__NA, true)
  assert.equal(history.state["mcsw:quote-intake"], undefined)
})

test("a duplicated tab reports the saved quote with the same Ads transaction ID", async () => {
  const route = quoteRouteHarness()
  const { mountForm, adsEvents, intakeKeys, session } = quoteFormHarness(route)
  const originalSubmission = mountForm([])()
  const submitInDuplicate = mountForm([], { storage: new Map(session) })
  await originalSubmission
  await submitInDuplicate()
  assert.equal(route.leads.size, 1)
  assert.deepEqual(adsEvents.map((event) => event.transaction_id), [intakeKeys[0], intakeKeys[0]])
})

test("only the Ads callback marks a queued quote conversion reported", async () => {
  let uploadFails = true
  const route = quoteRouteHarness({ upload: () => { if (uploadFails) throw new Error("Blob unavailable") } })
  const { mountForm, responses, adsEvents, adsTimeouts, intakeKeys, session } = quoteFormHarness(route, { acknowledgeAds: false })
  const photos = [quotePhoto("bracket.jpg")]
  const submit = mountForm(photos)
  await submit()
  assert.equal(responses[0].status, 503)
  const reportedKey = `mcsw:quote-ads:${intakeKeys[0]}`
  assert.equal(session.has(reportedKey), false)
  await submit()
  assert.equal(adsEvents.length, 1, "the event is already queued in this page")
  adsTimeouts[0]()
  assert.equal(session.has(reportedKey), false)

  uploadFails = false
  await mountForm(photos)()
  assert.equal(responses[2].status, 200)
  assert.equal(adsEvents.length, 2, "reload must queue the unconfirmed conversion again")
  assert.equal(session.has(reportedKey), false)
  adsEvents[1].event_callback()
  assert.equal(session.get(reportedKey), "1")
})

test("changing the phone with text consent returns 409 and clears the pending quote key", async () => {
  let uploadFails = true
  const route = quoteRouteHarness({ upload: () => { if (uploadFails) throw new Error("Blob unavailable") } })
  const { mountForm, responses, intakeKeys, session } = quoteFormHarness(route)
  const photos = [quotePhoto("bracket.jpg")]
  await mountForm(photos)()
  assert.equal(responses[0].status, 503)

  const submitCorrected = mountForm(photos, { phone: "6155550199", textConsent: true })
  await submitCorrected()
  assert.equal(intakeKeys[1], intakeKeys[0])
  assert.equal(responses[1].status, 409)
  assert.equal(session.has("mcsw:quote-intake"), false)

  uploadFails = false
  await submitCorrected()
  assert.notEqual(intakeKeys[2], intakeKeys[0])
  assert.equal(responses[2].status, 200)
  assert.equal(route.leads.size, 2)
})

test("reselecting the original retry photo keeps one quote and one Ads conversion", async () => {
  let uploadFails = true
  const route = quoteRouteHarness({ upload: () => { if (uploadFails) throw new Error("Blob unavailable") } })
  const { mountForm, responses, intakeKeys, adsEvents } = quoteFormHarness(route)
  const original = quotePhoto("bracket.jpg")
  const selected = [original]
  const submit = mountForm(selected)
  await submit()

  selected[0] = quotePhoto("wrong.jpg")
  await submit()

  uploadFails = false
  selected[0] = original
  await submit()

  assert.deepEqual(responses.map(({ status }) => status), [503, 409, 200])
  assert.equal(route.leads.size, 1)
  assert.equal(new Set(intakeKeys).size, 1)
  assert.deepEqual(adsEvents.map((event) => event.transaction_id), [intakeKeys[0]])
})

test("starting a new request after a photo conflict sends replacement photos with a new quote key", async () => {
  for (const rejectStorageWrites of [false, true]) {
    let uploadFails = true
    const route = quoteRouteHarness({ upload: () => { if (uploadFails) throw new Error("Blob unavailable") } })
    const { mountForm, responses, intakeKeys, session, history } = quoteFormHarness(route, { rejectStorageWrites })
    await mountForm([quotePhoto("bracket.jpg")])()

    uploadFails = false
    const submitReplacement = mountForm([quotePhoto("replacement.jpg")])
    await submitReplacement()
    assert.deepEqual(responses.map(({ status }) => status), [503, 409])
    assert.equal(intakeKeys[1], intakeKeys[0])
    assert.equal(responses[1].data.retryOriginalPhotos, true)

    const restart = submitReplacement.render().props.children.find((element) =>
      element?.type === "button" && element.props.children === "Start a new request",
    )
    assert.ok(restart, "the form offers a way to use the replacement photos")
    assert.equal(restart.props.type, "button")
    restart.props.onClick()
    assert.equal(session.has("mcsw:quote-intake"), false)
    assert.equal(history.state["mcsw:quote-intake"], undefined)

    await submitReplacement()
    assert.deepEqual(responses.map(({ status }) => status), [503, 409, 200])
    assert.notEqual(intakeKeys[2], intakeKeys[0])
    assert.equal(route.leads.size, 2)
    assert.equal(route.leads.get(`website:${intakeKeys[2]}`).photo_count, 1)
  }
})

test("a saved test quote cannot report a conversion on an unauthorized photo retry", async () => {
  let uploadFails = true
  const route = quoteRouteHarness({
    message: "[INTERNAL TEST] Repair a bracket",
    upload: () => { if (uploadFails) throw new Error("Blob unavailable") },
  })
  const photos = [quotePhoto("bracket.jpg")]
  const saved = await route.submit(photos, { authorized: true })
  assert.equal(saved.status, 503)
  assert.equal((await saved.json()).leadSaved, false)
  assert.equal([...route.leads.values()][0].is_test, true)

  const { mountForm, responses, adsEvents } = quoteFormHarness(route)
  const retry = mountForm(photos)
  await retry()
  assert.equal(responses[0].status, 503)
  assert.equal(responses[0].data.leadSaved, false)
  assert.deepEqual(adsEvents, [])

  uploadFails = false
  await retry()
  assert.equal(responses[1].status, 200)
  assert.equal(responses[1].data.accepted, true)
  assert.equal(responses[1].data.leadSaved, false)
  assert.deepEqual(adsEvents, [])
  assert.equal(route.leads.size, 1)
  assert.equal(route.alerts.length, 0)
})

test("a committed quote still alerts the owner and qualifies for Ads when the post-create lookup fails", async () => {
  for (const failLeadRead of ["route", "creation-event"]) {
    const route = quoteRouteHarness({ failLeadRead, emailConfigured: true })
    const response = await route.submit()
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, accepted: true, leadSaved: true })
    assert.equal(route.leads.size, 1)
    const [saved] = route.leads.values()
    assert.equal(route.alerts[0].url, `/ops/leads/${saved.id}`)
    const ownerEmailIntent = route.events.find((event) => event.kind === "email.out")
    assert.equal(ownerEmailIntent.leadId, saved.id)
    assert.equal(ownerEmailIntent.personId, saved.person_id)
    assert.equal(route.emails[0].payload.to, "owner@example.test")
    assert.ok(route.emails[0].payload.text.includes(`Phone: ${saved.phone}`))
  }
})

test("a photo-free quote retry ignores the photo count updated by a later MMS", async () => {
  let customerIntentUnavailable = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation, audience) {
      if (customerIntentUnavailable && operation === "intent" && audience === "customer") {
        throw new Error("Customer intent storage unavailable")
      }
    },
  })

  assert.equal((await route.submit()).status, 503)
  const [lead] = route.leads.values()
  assert.equal(lead.photo_count, 0)
  assert.equal(lead.quote_form_photo_count, 0)
  assert.deepEqual([...route.quoteIntakes.values()], [{ count: 0, fingerprints: [], environment: "production" }])
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test"])

  lead.photos.add("messages/incoming-mms.jpg")
  lead.photo_count = lead.photos.size
  customerIntentUnavailable = false
  assert.equal((await route.submit()).status, 200)
  assert.equal(route.leads.size, 1)
  assert.equal(lead.photo_count, 1)
  assert.equal(lead.quote_form_photo_count, 0)
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test", "customer@example.test"])
})

test("legacy MMS after an interrupted owner email leaves one lead and one customer receipt", async (t) => {
  for (const interruption of ["attempt", "intent"]) {
    await t.test(interruption === "attempt" ? "frozen original photo list" : "no original photo evidence", async () => {
      let interrupted = true
      const route = quoteRouteHarness({
        emailConfigured: true,
        email: "customer@example.test",
        storeQuoteFingerprints: false,
        checkEmail(operation, audience) {
          if (interrupted && operation === interruption && audience === "shop") throw new Error("Interrupted owner email")
        },
      })
      assert.equal((await route.submit()).status, 503)
      const [lead] = route.leads.values()
      lead.quote_form_photo_count = null
      const owner = route.events.find(({ kind, detail }) => kind === "email.out" && detail.audience === "shop")
      if (interruption === "attempt") assert.deepEqual(JSON.parse(owner.detail.frozenPayload).photos, [])
      else assert.equal(owner, undefined)
      assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["customer@example.test"])

      lead.photos.add("messages/incoming-mms.jpg")
      lead.photo_count = lead.photos.size
      interrupted = false
      assert.equal((await route.submit()).status, 200)
      assert.deepEqual([...route.leads.values()], [lead])
      assert.equal(lead.photo_count, 1)
      assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["customer@example.test", "owner@example.test"])
      assert.equal(route.events.filter(({ kind, detail }) => kind === "email.accepted" && detail.audience === "customer").length, 1)
    })
  }
})

test("a legacy retry with fewer photos preserves staged originals and never offers a restart", async (t) => {
  for (const allPhotosAttached of [false, true]) {
    await t.test(allPhotosAttached ? "uses already attached originals" : "keeps an incomplete photo set pending", async () => {
      let interrupted = true
      const route = quoteRouteHarness({
        emailConfigured: true,
        email: "customer@example.test",
        storeQuoteFingerprints: false,
        upload(pathname) {
          if (interrupted && !allPhotosAttached && pathname.endsWith("hinge.jpg")) throw new Error("Second photo unavailable")
        },
        checkEmail(operation, audience) {
          if (interrupted && operation === "intent" && audience === "shop") throw new Error("Interrupted owner email")
        },
      })
      const photos = [quotePhoto("gate.jpg", 41), quotePhoto("hinge.jpg", 42)]
      assert.equal((await route.submit(photos)).status, 503)
      const [lead] = route.leads.values()
      lead.quote_form_photo_count = null
      interrupted = false
      const retry = await route.submit()
      assert.equal(retry.status, allPhotosAttached ? 200 : 503)
      assert.equal((await retry.json()).retryOriginalPhotos, undefined)
      assert.equal(lead.photos.size, allPhotosAttached ? 2 : 1)
      if (!allPhotosAttached) {
        assert.equal(route.events.some(({ kind, detail }) => kind === "email.out" && detail.audience === "shop"), false)
        assert.equal((await route.submit(photos)).status, 200)
      }
      assert.equal(route.leads.size, 1)
      assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["customer@example.test", "owner@example.test"])
      assert.deepEqual(Array.from(route.emails[1].payload.attachments, ({ content }) => content.at(-1)), [41, 42])
    })
  }
})

test("a legacy zero-photo quote ignores extra photos when its original fingerprints are saved", async () => {
  let interrupted = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation, audience) {
      if (interrupted && operation === "intent" && audience === "shop") throw new Error("Interrupted owner email")
    },
  })
  assert.equal((await route.submit()).status, 503)
  const [lead] = route.leads.values()
  lead.quote_form_photo_count = null
  assert.deepEqual([...route.quoteIntakes.values()][0].fingerprints, [])

  interrupted = false
  assert.equal((await route.submit([quotePhoto("later.jpg", 43)])).status, 200)
  assert.equal(route.leads.size, 1)
  assert.equal(lead.photos.size, 0)
  const owner = route.events.find(({ kind, detail }) => kind === "email.out" && detail.audience === "shop")
  assert.deepEqual(JSON.parse(owner.detail.frozenPayload).photos, [])
})

test("configured preview quote saves with no provider sends", async () => {
  const route = quoteRouteHarness({ emailConfigured: true, email: "customer@example.test", vercelEnvironment: "preview" })
  assert.equal((await route.submit()).status, 200)
  assert.equal(route.leads.size, 1)
  assert.equal(route.providerCalls.length, 0)
  assert.equal(route.alerts.length, 0)
})

test("an old production worker finds no mail to send for a newly saved preview quote", async () => {
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    vercelEnvironment: "preview",
    checkEmail(operation) {
      if (operation === "attempt") throw new Error("Process stopped after freeze")
    },
  })
  const response = await route.submit()
  route.env.VERCEL_ENV = "production"
  route.advance(16 / 60)
  await route.legacyQuoteRecovery()
  assert.equal(route.providerCalls.length, 0)
  assert.equal(response.status, 200)
  assert.equal(route.leads.size, 1)
  assert.equal(route.events.filter(({ kind }) => kind === "email.out").length, 0)
  assert.equal((await route.submit()).status, 200, "a production retry must preserve preview origin")
  assert.equal(route.providerCalls.length, 0)
})

test("a preview retry cannot freeze preview sender payloads for an existing production intake", async () => {
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation) {
      if (route.env.VERCEL_ENV === "production" && operation === "intent") throw new Error("Stopped before freeze")
      if (route.env.VERCEL_ENV === "preview" && operation === "attempt") throw new Error("Stopped after freeze")
    },
  })
  assert.equal((await route.submit()).status, 503)
  route.env.VERCEL_ENV = "preview"
  route.env.QUOTE_FROM_EMAIL = "preview@example.test"
  const response = await route.submit()
  route.env.VERCEL_ENV = "production"
  route.advance(16 / 60)
  await route.legacyQuoteRecovery()
  assert.equal((await route.sweep()).ok, true)
  assert.equal(route.providerCalls.length, 0)
  assert.equal(response.status, 200)
  assert.equal(route.leads.size, 1)
  assert.equal(route.events.filter(({ kind }) => kind === "email.out").length, 0)
})

test("retrying a pre-upgrade quote after reservation failed attaches the original photo without duplicating the receipt", async () => {
  let reservationUnavailable = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    storeQuoteFingerprints: false,
    checkPhotoReservation() {
      if (reservationUnavailable) throw new Error("Photo reservation stopped")
    },
  })
  const original = quotePhoto("gate.jpg", 42)

  assert.equal((await route.submit([original])).status, 503)
  const [lead] = route.leads.values()
  lead.quote_form_photo_count = null
  assert.equal(lead.photo_count, 1)
  assert.equal(route.quoteIntakes.size, 0)
  assert.equal(route.photoIntents.size, 0)
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["customer@example.test"])

  reservationUnavailable = false
  assert.equal((await route.submit([original])).status, 200)
  assert.deepEqual([...route.leads.values()], [lead])
  assert.equal(lead.photos.size, 1)
  assert.deepEqual(route.providerCalls.map(({ key }) => key.split(":")[0]), ["quote-customer", "quote-owner"])
  const [attachment] = route.emails[1].payload.attachments
  assert.equal(route.emails[1].payload.to, "owner@example.test")
  assert.equal(attachment.filename, "gate.jpg")
  assert.equal(attachment.content.at(-1), 42)
})

test("quote photo fingerprints are saved before reservation and reject replacement contents on retry", async () => {
  let reservationUnavailable = true
  const route = quoteRouteHarness({
    checkPhotoReservation() {
      if (reservationUnavailable) throw new Error("Photo reservation stopped")
    },
  })
  const original = quotePhoto("gate.jpg", 1)
  const replacement = quotePhoto("gate.jpg", 2)

  assert.equal((await route.submit([original])).status, 503)
  assert.equal(route.photoIntents.size, 0)
  const [intake] = route.quoteIntakes.values()
  assert.equal(intake.count, 1)
  assert.match(intake.fingerprints[0], /^[0-9a-f]{64}$/)

  reservationUnavailable = false
  assert.equal((await route.submit([replacement])).status, 409)
  assert.equal(route.photoIntents.size, 0)
  assert.equal((await route.submit([original])).status, 200)
  assert.equal(route.leads.size, 1)
})

test("an email intent or receipt outage preserves the saved quote for retry", async () => {
  for (const target of ["shop", "customer"]) {
    for (const stage of ["intent", "receipt"]) {
      let unavailable = true
      const route = quoteRouteHarness({
        emailConfigured: true,
        email: "customer@example.test",
        checkEmail: (operation, audience) => {
          if (unavailable && operation === stage && audience === target) throw new Error("Email storage unavailable")
        },
      })
      const { mountForm, responses, intakeKeys, adsEvents, session } = quoteFormHarness(route)
      const submit = mountForm([])

      await submit()
      assert.equal(responses[0].status, 503, `${target} ${stage}`)
      assert.equal(responses[0].data.leadSaved, true)
      assert.equal(session.get("mcsw:quote-intake"), intakeKeys[0])
      assert.deepEqual(route.emails.map(({ payload }) => payload.to), [
        target === "shop" ? "customer@example.test" : "owner@example.test",
      ])

      unavailable = false
      route.expireProviderReceipts()
      await submit()
      assert.equal(responses[1].status, 200)
      assert.equal(intakeKeys[1], intakeKeys[0])
      assert.equal(route.leads.size, 1)
      assert.equal(adsEvents.length, 1)
      assert.deepEqual(route.emails.map(({ payload }) => payload.to).sort(), ["customer@example.test", "owner@example.test"])
    }
  }
})

for (const [ownerFailure, providerResponse] of [
  ["acceptance receipt write fails", undefined],
  ["SDK loses the response", { data: null, error: { name: "application_error", statusCode: null, message: "Unable to fetch data" } }],
  ["provider reports a concurrent send", { data: null, error: { name: "concurrent_idempotent_requests", statusCode: 409, message: "The request is already in progress" } }],
  ["provider reports a request timeout", { data: null, error: { statusCode: 408, message: "Request Timeout" } }],
  ["provider throttles the request", { data: null, error: { statusCode: 429, message: "Too Many Requests" } }],
  ["provider omits the acceptance ID", { data: {}, error: null }],
]) {
  test(`an email-only retry after provider deduplication expires leaves an ambiguous owner email for reconciliation (${ownerFailure})`, async () => {
    let firstAttempt = true
    const route = quoteRouteHarness({
      emailConfigured: true,
      email: "customer@example.test",
      checkEmail(operation, audience) {
        if (!firstAttempt) return
        if ((operation === "acceptance" && audience === "shop" && !providerResponse) ||
            (operation === "intent" && audience === "customer")) throw new Error("Email storage unavailable")
        if (operation === "send" && audience === "shop") return providerResponse
      },
    })

    const first = await route.submit()
    assert.equal(first.status, 503)
    assert.equal((await first.json()).leadSaved, true)
    assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test"])
    const unknown = route.events.find((event) => event.kind === "email.unknown")
    assert.equal(unknown.detail.audience, "shop")
    if (!providerResponse) assert.equal(unknown.detail.providerEmailId, "email-1")

    firstAttempt = false
    route.expireProviderReceipts()
    const retry = await route.submit()
    assert.equal(retry.status, 200)
    assert.deepEqual(await retry.json(), { ok: true, accepted: true, leadSaved: true })
    assert.equal(route.leads.size, 1)
    assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test", "customer@example.test"])
    assert.ok(route.errors.some(([message]) => /reconciliation/i.test(message)))
  })
}

test("Astra P1: losing both owner outcome writes reuses one frozen payload and sends one owner email", async () => {
  let unavailable = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "Customer@example.test",
    checkEmail(operation, audience) {
      if (unavailable && ((audience === "shop" && ["acceptance", "unknown"].includes(operation)) ||
        (audience === "customer" && operation === "intent"))) throw new Error("Email storage unavailable")
    },
  })
  const photos = [quotePhoto("bracket.jpg", 42), quotePhoto("gate.jpg", 43)]
  const first = await route.submit(photos, { utmSource: "first-visit" })
  assert.equal(first.status, 503)
  assert.equal((await first.json()).leadSaved, true)
  assert.deepEqual(route.events.filter(({ kind }) => kind.startsWith("email.")).map(({ kind }) => kind), ["email.out", "email.attempt"])
  assert.equal(route.emails.length, 1)
  assert.match(route.emails[0].payload.text, /Time: 2026-11-27T11:59:55\.000Z/)
  assert.match(route.emails[0].payload.text, /Source: first-visit/)

  unavailable = false
  route.advance(22.9)
  route.env.QUOTE_EMAIL_SUBJECT_PREFIX = "Updated subject prefix"
  route.env.QUOTE_TO_EMAIL = "new-owner@example.test"
  const retry = await route.submit([...photos].reverse(), {
    phone: "(615) 555-0100", replyEmail: "customer@example.test", utmSource: "retry-visit",
  })
  assert.equal(retry.status, 200)
  const [original, replay] = route.providerCalls.filter(({ key }) => key.startsWith("quote-owner:"))
  assert.equal(original.key, replay.key)
  assert.equal(original.payloadBytes, replay.payloadBytes)
  assert.equal(original.attempt.kind, "email.attempt")
  assert.equal(replay.attempt.kind, "email.attempt")
  assert.equal(original.attempt.detail.idempotencyKey, original.key)
  assert.equal(original.attempt.detail.attemptedAt, original.attempt.occurred_at)
  assert.match(original.attempt.detail.payloadHash, /^[\da-f]{64}$/)
  assert.equal(original.attempt.detail.payloadHash, replay.attempt.detail.payloadHash)
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test", "Customer@example.test"])
  assert.equal(route.leads.size, 1)
})

test("Astra P1: an acceptance still wins after a later same-key rejection and provider expiry", async () => {
  let customerUnavailable = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation, audience) {
      if (customerUnavailable && audience === "customer" && operation === "intent") throw new Error("Email storage unavailable")
    },
  })
  assert.equal((await route.submit()).status, 503)
  const acceptance = route.events.find(({ kind }) => kind === "email.accepted")
  assert.equal(acceptance.detail.audience, "shop")
  // Replay the history left by round 5's concurrent, different-payload send.
  route.events.push({ ...acceptance, id: route.events.length + 1, kind: "email.failed", externalId: "legacy-rejection" })
  customerUnavailable = false
  route.expireProviderReceipts()
  assert.equal((await route.submit()).status, 200)
  assert.equal(route.providerCalls.filter(({ key }) => key.startsWith("quote-owner:")).length, 1)
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test", "customer@example.test"])
  assert.equal(route.leads.size, 1)
})

test("Astra P1: a 504 after upstream acceptance stays ambiguous and sends one owner email", async () => {
  let firstAttempt = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation, audience) {
      if (firstAttempt && audience === "customer" && operation === "intent") throw new Error("Email storage unavailable")
      if (firstAttempt && audience === "shop" && operation === "send") {
        return { data: null, error: { statusCode: 504, message: "Gateway Timeout" } }
      }
    },
  })
  assert.equal((await route.submit()).status, 503)
  assert.equal(route.events.find(({ kind }) => kind === "email.unknown").detail.audience, "shop")
  assert.equal(route.events.some(({ kind }) => kind === "email.failed"), false)
  firstAttempt = false
  route.expireProviderReceipts()
  assert.equal((await route.submit()).status, 200)
  assert.equal(route.providerCalls.filter(({ key }) => key.startsWith("quote-owner:")).length, 1)
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test", "customer@example.test"])
  assert.equal(route.leads.size, 1)
})

test("a failed attempt insert returns a retryable 503 before the provider call", async () => {
  let unavailable = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation) {
      if (unavailable && operation === "attempt") throw new Error("Attempt receipt insert unavailable")
    },
  })
  const first = await route.submit()
  assert.equal(first.status, 503)
  assert.equal(first.headers.get("Retry-After"), "15")
  assert.equal((await first.json()).leadSaved, true)
  assert.equal(route.providerCalls.length, 0)
  assert.equal(route.leads.size, 1)
  unavailable = false
  assert.equal((await route.submit()).status, 200)
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test", "customer@example.test"])
  assert.equal(route.leads.size, 1)
})

test("an attempt with both outcomes missing stops at 23 hours and raises one owner-review alert", async () => {
  let unavailable = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    checkEmail(operation) {
      if (unavailable && ["acceptance", "unknown"].includes(operation)) throw new Error("Outcome writes unavailable")
    },
  })
  assert.equal((await route.submit()).status, 200)
  unavailable = false
  route.advance(23)
  assert.equal((await route.submit()).status, 200)
  assert.equal(route.providerCalls.length, 1, "the expired retry makes no provider call")
  assert.equal(route.emails.length, 1)
  assert.equal(route.leads.size, 1)
  route.env.VERCEL_ENV = "preview"
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 0)
  route.env.VERCEL_ENV = "production"
  assert.equal((await route.sweep()).ok, true)
  assert.equal((await route.sweep()).ok, true)
  const reviews = route.alerts.filter(({ title }) => title === "Quote saved, owner email unconfirmed")
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].ownerOnly, true)
})

test("a new ambiguous send supersedes a definite failure after a legacy ambiguous send", async () => {
  let attempt = 1
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation, audience) {
      if ((attempt === 1 && operation === "send" && audience === "shop") ||
          (attempt === 2 && operation === "acceptance" && audience === "shop") ||
          (attempt < 3 && operation === "intent" && audience === "customer")) {
        throw new Error("Email storage or transport unavailable")
      }
    },
  })

  assert.equal((await route.submit()).status, 503)
  assert.equal(route.emails.length, 0)
  const unknown = route.events.find((event) => event.kind === "email.unknown")
  // The previous route could retry this unknown outcome and record a rejection.
  route.events.push({
    ...unknown,
    id: route.events.length + 1,
    kind: "email.failed",
    externalId: unknown.externalId.replace("request-unknown:", "request-failed:"),
  })

  attempt = 2
  assert.equal((await route.submit()).status, 503)
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test"])

  attempt = 3
  route.expireProviderReceipts()
  assert.equal((await route.submit()).status, 200)
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test", "customer@example.test"])
})

test("a confirmed owner rejection can retry past 23 hours with a fresh key and the same frozen message", async () => {
  let reject = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation, audience) {
      if (reject && operation === "intent" && audience === "customer") throw new Error("Customer intent storage unavailable")
      if (reject && operation === "send" && audience === "shop") return { error: { statusCode: 422, message: "Rejected" } }
    },
  })
  assert.equal((await route.submit()).status, 503)
  assert.equal(route.events.find(({ kind }) => kind === "email.failed").detail.attemptEventId, route.providerCalls[0].attempt.id)
  route.advance(23.1)
  route.env.VERCEL_ENV = "production"
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 0)
  assert.equal(route.alerts.filter(({ dedupeKey }) => dedupeKey.startsWith("quote-owner-delivery:")).length, 0)
  reject = false
  route.env.QUOTE_TO_EMAIL = "changed@example.test"
  assert.equal((await route.submit()).status, 200)
  const [first, second] = route.providerCalls.filter(({ key }) => key.startsWith("quote-owner:"))
  assert.ok(second, "a definitive rejection permits a fresh owner send")
  assert.notEqual(first.key, second.key)
  assert.equal(first.payloadBytes, second.payloadBytes)
  const frozen = JSON.parse(route.events.find(({ kind, detail }) => kind === "email.out" && detail.audience === "shop").detail.frozenPayload)
  assert.deepEqual(frozen.message.tags, [
    { name: "quote_intent", value: "quote-owner-10000000-0000-4000-8000-000000000001" },
    { name: "audience", value: "shop" },
  ])
  assert.deepEqual(JSON.parse(second.payloadBytes).tags, frozen.message.tags)
  assert.equal(second.attempt.detail.attemptNumber, 2)
  assert.equal(route.events.find(({ kind, detail }) => kind === "email.accepted" && detail.audience === "shop").detail.attemptEventId, second.attempt.id)
  assert.equal(route.leads.size, 1)
})

test("a definitive rejection on a replay cannot settle a different ambiguous attempt", async () => {
  let phase = "lost"
  const route = quoteRouteHarness({ emailConfigured: true, email: "customer@example.test", checkEmail(operation, audience) {
    if (operation === "intent" && audience === "customer" && phase !== "restored") throw new Error("Customer intent storage unavailable")
    if (operation === "send" && audience === "shop") {
      if (phase === "lost") throw new Error("Response lost")
      if (phase === "reject") return { error: { statusCode: 422, message: "Rejected" } }
    }
  } })
  assert.equal((await route.submit()).status, 503)
  route.advance(1)
  phase = "reject"
  assert.equal((await route.submit()).status, 503)
  const [first, second] = route.providerCalls
  assert.equal(first.key, second.key)
  assert.equal(route.events.find(({ kind }) => kind === "email.unknown").detail.attemptEventId, first.attempt.id)
  assert.equal(route.events.find(({ kind }) => kind === "email.failed").detail.attemptEventId, second.attempt.id)
  route.advance(22.1)
  phase = "restored"
  assert.equal((await route.submit()).status, 200)
  assert.equal(route.providerCalls.filter(({ key }) => key.startsWith("quote-owner:")).length, 2)
  route.env.VERCEL_ENV = "production"
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 1)
})

test("recovery sends a frozen quote with no attempts after 15 minutes and reviews one past 23 hours", async () => {
  for (const hours of [16 / 60, 40]) {
    let interrupted = true
    const route = quoteRouteHarness({ emailConfigured: true, checkEmail(operation) {
      if (interrupted && operation === "attempt") throw new Error("Process stopped after freeze")
    } })
    assert.equal((await route.submit()).status, 503)
    assert.deepEqual(route.events.filter(({ kind }) => kind.startsWith("email.")).map(({ kind }) => kind), ["email.out"])
    interrupted = false
    route.env.VERCEL_ENV = "production"
    route.advance(14 / 60)
    assert.equal((await route.sweep()).ok, true)
    assert.equal(route.providerCalls.length, 0)
    route.advance(hours - 14 / 60)
    assert.equal((await route.sweep()).ok, true)
    assert.equal((await route.sweep()).ok, true)
    assert.equal(route.providerCalls.length, hours < 23 ? 1 : 0)
    assert.equal(route.alerts.filter(({ dedupeKey }) => dedupeKey.startsWith("quote-email-review:")).length, hours < 23 ? 0 : 1)
    if (hours < 23) assert.equal(route.providerCalls[0].attempt.detail.attemptNumber, 1)
  }
})

test("one failing quote review backs off for 15 minutes while a newer review files", async () => {
  const reviewAttempts = []
  let brokenReview
  const route = quoteRouteHarness({
    emailConfigured: true,
    checkEmail(operation) {
      if (["acceptance", "unknown"].includes(operation)) throw new Error("Outcomes unavailable")
    },
    checkAlert({ dedupeKey }) {
      if (!dedupeKey.startsWith("quote-email-review:")) return
      reviewAttempts.push(dedupeKey)
      if (dedupeKey === brokenReview) throw new Error("Oldest notification cannot be filed")
    },
  })
  await route.submit()
  const first = route.events.find(({ kind }) => kind === "email.out")
  brokenReview = `quote-email-review:${first.id}`
  route.advance(1 / 60)
  await route.submit([], { key: "10000000-0000-4000-8000-000000000002" })
  const newest = `quote-email-review:${route.events.findLast(({ kind }) => kind === "email.out").id}`
  assert.notEqual(brokenReview, newest)
  route.advance(24)
  route.env.VERCEL_ENV = "production"
  assert.equal((await route.sweep()).ok, true)
  assert.deepEqual(reviewAttempts, [brokenReview, newest])
  assert.ok(route.alerts.some(({ dedupeKey }) => dedupeKey === newest))
  route.advance(14 / 60)
  assert.equal((await route.sweep()).ok, true)
  assert.deepEqual(reviewAttempts, [brokenReview, newest])
  route.advance(1 / 60)
  assert.equal((await route.sweep()).ok, true)
  assert.deepEqual(reviewAttempts, [brokenReview, newest, brokenReview])
})

test("production recovery leaves preview-origin frozen owner and customer emails unsent", async () => {
  let interrupted = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation) {
      if (interrupted && operation === "attempt") throw new Error("Process stopped after freeze")
    },
  })
  assert.equal((await route.submit()).status, 503)
  assert.equal([...route.leads.values()][0].is_test, false)
  // Emulate old preview workers that stored origin only on quote_intakes.
  route.quoteIntakes.values().next().value.environment = "preview"
  const frozen = route.events.filter(({ kind }) => kind.startsWith("email."))
  assert.deepEqual(frozen.map(({ kind }) => kind), ["email.out", "email.out"])
  for (const intent of frozen) delete intent.detail.environment
  interrupted = false
  route.env.VERCEL_ENV = "preview"
  route.advance(16 / 60)
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 0)
  route.env.VERCEL_ENV = "production"
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 0)
  route.advance(40)
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 0)
  assert.equal(route.providerCalls.length, 0)
})

test("production recovery reviews a legacy frozen intent with no proven production origin once", async () => {
  const route = quoteRouteHarness({
    emailConfigured: true,
    checkEmail(operation) {
      if (operation === "attempt") throw new Error("Process stopped after freeze")
    },
  })
  assert.equal((await route.submit()).status, 503)
  route.quoteIntakes.values().next().value.environment = null
  delete route.events.find(({ kind }) => kind === "email.out").detail.environment
  route.advance(16 / 60)
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 1)
  route.advance(1)
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 0)
  assert.equal(route.providerCalls.length, 0)
  const review = route.alerts.find(({ dedupeKey }) => dedupeKey.startsWith("quote-email-review:"))
  assert.equal(review.ownerOnly, true)
  assert.equal(review.url, "/ops/leads/1#spike")
  assert.match(review.body, /environment could not be confirmed/)
})

test("only production recovers untagged legacy mail and skips a mismatched frozen intent", async () => {
  let interrupted = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation) {
      if (interrupted && operation === "attempt") throw new Error("Process stopped after freeze")
    },
  })
  assert.equal((await route.submit()).status, 503)
  const [shop, customer] = route.events.filter(({ kind }) => kind === "email.out")
  shop.detail.environment = "preview"
  delete customer.detail.environment
  interrupted = false
  route.advance(16 / 60)
  route.env.VERCEL_ENV = "preview"
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 0)
  assert.equal(route.providerCalls.length, 0)
  route.env.VERCEL_ENV = "production"
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 1)
  assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["customer@example.test"])
  route.advance(40)
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 0)
  assert.equal(route.providerCalls.length, 1)
})

test("recovery files a lead-specific owner failure and customer warning for definitive rejections", async () => {
  let interrupted = true
  let filingUnavailable = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation) {
      if (interrupted && operation === "attempt") throw new Error("Process stopped after freeze")
      if (operation === "send") return { data: null, error: { statusCode: 422, message: "Rejected recipient" } }
    },
    checkAlert({ dedupeKey }) {
      if (filingUnavailable && dedupeKey.startsWith("quote-customer-delivery:") && dedupeKey.endsWith(":failed")) {
        throw new Error("Notification write unavailable")
      }
    },
  })
  assert.equal((await route.submit()).status, 503)
  interrupted = false
  route.advance(16 / 60)
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 2)
  const failureAlerts = () => route.alerts.filter(({ dedupeKey }) => dedupeKey.endsWith(":failed"))
  assert.deepEqual(failureAlerts().map(({ title }) => title), ["Quote saved, owner email did not send"])
  filingUnavailable = false
  route.advance(16 / 60)
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 0)
  route.advance(40)
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 0)
  assert.equal(route.providerCalls.length, 2)
  assert.deepEqual(failureAlerts().map(({ title }) => title), [
    "Quote saved, owner email did not send",
    "Customer confirmation did not send",
  ])
  for (const alert of failureAlerts()) {
    assert.equal(alert.ownerOnly, true)
    assert.equal(alert.url, "/ops/leads/1#spike")
    assert.equal(alert.body, "Rejected recipient")
    assert.equal(route.events.find(({ id }) => id === alert.sourceEventId).kind, "email.failed")
  }
  assert.match(failureAlerts()[1].dedupeKey, /^quote-customer-delivery:.*:failed$/)
})

test("a healthy 21st review gets a turn after 20 older reviews fail", async () => {
  const attempts = []
  let healthyReview
  const route = quoteRouteHarness({
    emailConfigured: true,
    checkEmail(operation) {
      if (operation === "attempt") throw new Error("Process stopped after freeze")
    },
    checkAlert({ dedupeKey }) {
      if (!dedupeKey.startsWith("quote-email-review:")) return
      attempts.push(dedupeKey)
      if (dedupeKey !== healthyReview) throw new Error("Notification write unavailable")
    },
  })
  for (let index = 1; index <= 21; index++) {
    const key = "10000000-0000-4000-8000-" + String(index).padStart(12, "0")
    assert.equal((await route.submit([], { key })).status, 503)
    route.advance(1 / 60)
  }
  healthyReview = "quote-email-review:" + route.events.findLast(({ kind }) => kind === "email.out").id
  route.advance(24)
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 0)
  assert.equal(attempts.length, 20)
  route.advance(1)
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 1)
  assert.equal(attempts[20], healthyReview)
  assert.equal(route.providerCalls.length, 0)
})

test("a healthy 21st send gets a turn while 20 attachment reads back off", async () => {
  let interrupted = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    checkEmail(operation) {
      if (interrupted && operation === "attempt") throw new Error("Process stopped after freeze")
    },
  })
  for (let index = 1; index <= 21; index++) {
    const key = "10000000-0000-4000-8000-" + String(index).padStart(12, "0")
    assert.equal((await route.submit([quotePhoto("bracket.jpg", index)], { key })).status, 503)
    route.advance(1 / 60)
  }
  const healthy = route.events.findLast(({ kind }) => kind === "email.out")
  const [healthyPhoto] = JSON.parse(healthy.detail.frozenPayload).photos
  for (const pathname of route.blobs.keys()) {
    if (pathname !== healthyPhoto.pathname) route.blobs.delete(pathname)
  }
  interrupted = false
  const prepareFailures = () => route.errors.filter(([message, error]) =>
    message === "Quote email could not be prepared:" && error.message === "Saved quote photo unavailable.")
  route.advance(16 / 60)
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 0)
  assert.equal(prepareFailures().length, 20)
  route.advance(1 / 60)
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 1)
  assert.equal(prepareFailures().length, 20)
  assert.equal(route.providerCalls.length, 1)
  assert.equal(route.providerCalls[0].attempt.leadId, healthy.leadId)
  assert.equal(route.emails[0].payload.attachments[0].filename, "bracket.jpg")
})

test("a pending owner email waits for photo verification and includes the recovered attachments", async () => {
  let emailUnavailable = true
  let photosUnavailable = false
  const route = quoteRouteHarness({
    emailConfigured: true,
    checkEmail: (operation) => {
      if (emailUnavailable && operation === "receipt") throw new Error("Email receipt lookup unavailable")
    },
    checkPhotos: () => {
      if (photosUnavailable) throw new Error("Photo intent lookup unavailable")
    },
  })
  const photos = [quotePhoto("bracket.jpg", 42)]
  assert.equal((await (await route.submit(photos)).json()).leadSaved, true)
  assert.ok(route.events.some((event) => event.kind === "email.out"))
  assert.equal(route.emails.length, 0)

  emailUnavailable = false
  photosUnavailable = true
  assert.equal((await route.submit(photos)).status, 503)
  assert.equal(route.emails.length, 0)

  photosUnavailable = false
  assert.equal((await route.submit(photos)).status, 200)
  assert.equal(route.emails.length, 1)
  const [attachment] = route.emails[0].payload.attachments
  assert.equal(attachment.filename, "bracket.jpg")
  assert.equal(attachment.content.at(-1), 42)
})

test("same-metadata photos resume by contents when the customer reverses their order", async () => {
  for (const existingIntents of ["current", "legacy", "legacy-missing-receipt"]) {
    const uploads = []
    let recovered = false
    const route = quoteRouteHarness({
      upload: async (_pathname, file) => {
        const content = new Uint8Array(await file.arrayBuffer()).at(-1)
        uploads.push(content)
        if (content === 2 && !recovered) throw new Error("Photo storage unavailable")
      },
    })
    const files = [quotePhoto("gate+.jpg", 1), quotePhoto("gate?.jpg", 2)]
    const first = await route.submit(files)
    assert.equal(first.status, 503)
    const [lead] = route.leads.values()
    if (existingIntents !== "current") {
      // Simulate an in-flight quote reserved before intent paths included a digest.
      route.quoteIntakes.clear()
      lead.quote_form_photo_count = null
      for (const intent of route.photoIntents.get(lead.id).values()) {
        const legacyPath = `leads/${lead.public_id}/${intent.photo_index}-${intent.filename}`
        if (intent.stored_pathname) {
          route.blobs.set(legacyPath, route.blobs.get(intent.stored_pathname))
          route.blobs.delete(intent.stored_pathname)
          lead.photos.delete(intent.stored_pathname)
          if (existingIntents === "legacy-missing-receipt") {
            lead.photo_count = files.length
            intent.status = "failed"
            intent.stored_pathname = ""
          } else {
            lead.photos.add(legacyPath)
            intent.stored_pathname = legacyPath
          }
        }
        intent.target_path = legacyPath
      }
    }

    recovered = true
    const retry = await route.submit([...files].reverse())
    assert.equal(retry.status, 200)
    assert.equal(route.leads.size, 1)
    assert.deepEqual(uploads, [1, 2, 2])
    const attached = await Promise.all([...lead.photos].map(async (pathname) =>
      new Uint8Array(await route.blobs.get(pathname).arrayBuffer()).at(-1)
    ))
    assert.deepEqual(attached, [1, 2])
  }
})

test("a conversion is never dropped because gtag has not defined itself yet", () => {
  // GA4 recorded enhanced-measurement form_start on 2026-08-25, 27 and 28 and
  // zero generate_lead -- including the day lead #161 saved. Enhanced
  // measurement comes from gtag.js and needs no shim; these events did, and
  // `window.gtag &&` turned a missing shim into a permanent, silent loss.
  const measurement = source("lib/measurement.ts")
  assert.ok(
    measurement.includes("export function queueMeasurementEvent"),
    "queueMeasurementEvent must exist.",
  )
  assert.ok(
    measurement.includes("target.dataLayer = target.dataLayer || []"),
    "The queue must create dataLayer rather than assume it.",
  )
  for (const path of ["components/mainstreet-contact.tsx", "components/phone-click-tracker.tsx"]) {
    const body = source(path)
    assert.ok(
      !/window\.gtag/.test(body.replace(/gtag\?: \(/g, "")),
      `${path} must not read window.gtag directly; a falsy read drops the conversion for good.`,
    )
    assert.ok(body.includes("queueMeasurementEvent"), `${path} must queue its events.`)
  }
})

test("the internal-verification guard never disables the tag for ordinary traffic", () => {
  // utm_source=internal-verify and utm_medium=e2e switch the tag off by design,
  // so the shop's own end-to-end walk cannot bill a conversion. That guard must
  // stay narrow: any broader condition silently turns real visitors into
  // untracked ones, which is invisible from the site itself.
  for (const path of ["components/public-analytics.tsx", "components/deferred-google-tag.tsx"]) {
    const body = source(path)
    const guards = [...body.matchAll(/utm_(source|medium)'?"?\)? ?===? ?'([^']+)'/g)].map((m) => m[2])
    for (const value of guards) {
      assert.ok(
        ["internal-verify", "e2e"].includes(value),
        `${path} gates the tag on utm value "${value}"; only internal-verify and e2e may.`,
      )
    }
  }
})

test("health reports how long the public quote form has been silent", () => {
  const health = source("app/api/health/route.ts")
  assert.ok(
    health.includes("last_web_quote_at"),
    "checkDatabase must read the last web quote; only /api/quote writes landing_page.",
  )
  assert.ok(health.includes("webQuoteSilent"), "The health payload must expose webQuoteSilent.")
  assert.ok(
    health.includes("WEB_QUOTE_SILENCE_LIMIT_HOURS = 240"),
    "The silence limit is 240 hours: the form takes about one lead a week, so four days of quiet is normal and reddened the monitor for ten runs straight.",
  )
  const monitor = source(".github/workflows/health-monitor.yml")
  assert.ok(
    monitor.includes("webQuoteSilent"),
    "The health monitor must read quote-form silence, or nothing reads the field.",
  )
  assert.match(
    monitor,
    /::warning::No web quote has reached the database/,
    "Form silence is a warning; inbound-call silence is the red build.",
  )
  assert.ok(
    monitor.includes("verify-ads-tag.mjs"),
    "The health monitor must run the live Ads tag probe.",
  )
})

test("release health gates both Ads destinations and GA4 configuration", () => {
  const health = source("app/api/health/route.ts")
  assert.match(
    health,
    /import \{[^}]*ADS_CONVERSION_SEND_TO[^}]*ADS_PHONE_CONVERSION_SEND_TO[^}]*GA_MEASUREMENT_ID[^}]*\} from "@\/lib\/measurement"/s,
    "Health must use the same public measurement IDs as the browser bundle.",
  )
  for (const gate of [
    "adsConversionConfigured",
    "adsPhoneConversionConfigured",
    "analyticsMeasurementConfigured",
  ]) {
    const launchGateStart = health.indexOf("const launchGatePassed")
    const launchGate = health.slice(launchGateStart, health.indexOf("return Response.json", launchGateStart))
    assert.ok(launchGate.includes(gate), `${gate} must participate in the release gate.`)
  }
  assert.ok(health.includes("phoneConversionSendTo: ADS_PHONE_CONVERSION_SEND_TO"))

  const monitor = source(".github/workflows/health-monitor.yml")
  assert.ok(
    monitor.includes(".googleAds.phoneConversionConfigured == true"),
    "Production verification must fail when the phone Ads destination is missing.",
  )
  assert.ok(
    monitor.includes(".googleAnalytics.measurementConfigured == true"),
    "Production verification must fail when GA4 is missing.",
  )
})

test("the live tag probe checks form, phone, and GA4 runtime wiring", () => {
  const verifier = source("scripts/verify-ads-tag.mjs")
  assert.ok(verifier.includes(PHONE_SEND_TO), "The phone conversion destination must be probed.")
  assert.match(verifier, /G-\[A-Z0-9\]/, "The probe must discover a shipped GA4 measurement ID.")
  assert.ok(
    verifier.includes("GA4") && verifier.includes("gtag config"),
    "The probe must require GA4 runtime config, not merely a G- string elsewhere in the bundle.",
  )
})

test("the live tag probe binds the discovered GA4 ID to its exact config call", () => {
  const html = '<script>self.__next_f.push([1,"{\\"measurementId\\":\\"G-BOUND123\\"}"])</script>'
  const boundBundle = "function({measurementId:e}){return `${e?`window.gtag('config', ${JSON.stringify(e)});`:\"\"}`}"
  assert.deepEqual(findBoundGa4MeasurementIds(html, boundBundle), ["G-BOUND123"])

  const unrelatedHtml = '<script>window.unrelatedMeasurement = "G-STRAY123"</script>'
  const unrelatedBundle = "window.gtag('config', 'GT-CONTAINER1')"
  assert.deepEqual(
    findBoundGa4MeasurementIds(unrelatedHtml, unrelatedBundle),
    [],
    "A stray G-* ID and a different config call must not pass GA4 verification.",
  )

  const wrongBindingBundle = "function({measurementId:e}){return `${e?`window.gtag('config', ${JSON.stringify(other)});`:\"\"}`}"
  assert.deepEqual(
    findBoundGa4MeasurementIds(html, wrongBindingBundle),
    [],
    "The config expression must use the exact variable receiving measurementId.",
  )
})

test("Meta measurement shares verification suppression and queues an early Lead", () => {
  const analytics = source("components/public-analytics.tsx")
  const metaStart = analytics.indexOf("export function metaPixelBootstrapSource")
  const metaBody = analytics.slice(metaStart, analytics.indexOf("function DeferredMetaPixel", metaStart))
  assert.ok(metaStart >= 0, "The deferred bootstrap source must remain testable.")
  assert.doesNotMatch(analytics, /<Script id="meta-pixel"/, "The initial HTML must not contain a Meta Script component.")
  assert.ok(metaBody.includes("internal-verify"), "Meta PageView must ignore internal verification.")
  assert.ok(metaBody.includes("e2e"), "Meta PageView must ignore end-to-end verification.")
  assert.ok(metaBody.includes("fbq('track', 'PageView')"), "Meta PageView keeps its existing event name.")
  assert.doesNotMatch(
    analytics,
    /facebook\.com\/tr\?[^\n]*noscript/i,
    "A no-script pixel must not bypass internal-verification suppression.",
  )
  assert.ok(
    metaBody.includes("__mcswMetaQueue") && metaBody.includes("fbq.apply"),
    "The Meta bootstrap must drain Leads queued before fbq becomes available.",
  )
  assert.ok(
    analytics.includes('getElementById("deferred-google-tag")') && analytics.includes("new MutationObserver"),
    "Meta loads only after the deferred Google tag trigger inserts its script.",
  )

  const measurement = source("lib/measurement.ts")
  const reportMetaLead = measurement.slice(measurement.indexOf("export function reportMetaLead"))
  assert.ok(reportMetaLead.includes("internal-verify"), "Meta Lead must ignore internal verification.")
  assert.ok(reportMetaLead.includes("e2e"), "Meta Lead must ignore end-to-end verification.")
  assert.ok(
    reportMetaLead.includes("__mcswMetaQueue") && reportMetaLead.includes('["track", "Lead"]'),
    "A Lead must queue when fbq is temporarily unavailable.",
  )
  assert.doesNotMatch(reportMetaLead, /eventID|receipt/i, "Do not fabricate a Meta provider receipt.")
})

test("privacy copy names Meta measurement without claiming enhanced data sharing", () => {
  const privacy = source("app/privacy/page.tsx")
  assert.match(privacy, /Meta Pixel/)
  assert.match(privacy, /Facebook/)
  assert.match(privacy, /quote request/)
  assert.doesNotMatch(privacy, /enhanced conversions|enhanced data sharing/i)
})

test("a limited-signal ad click is still filed as paid", () => {
  // lib/leads.ts reaches the database at import time, so pin the rule on the
  // source rather than loading the module.
  const leads = source("lib/leads.ts")
  assert.ok(leads.includes('"gbraid="'), "gbraid must count as an ad click.")
  assert.ok(leads.includes('"wbraid="'), "wbraid must count as an ad click.")
  assert.ok(
    leads.includes("landingPageIsAdClick(input.landingPage ?? \"\")"),
    "deriveLeadSource must fall back to the landing page when gclid is absent.",
  )
})

test("a phone tap can carry an Ads conversion", () => {
  const measurement = source("lib/measurement.ts")
  assert.ok(
    measurement.includes("NEXT_PUBLIC_GOOGLE_ADS_PHONE_SEND_TO"),
    "The phone conversion label must be configurable.",
  )
  assert.ok(
    measurement.includes('"AW-17817632790/0aSACPS5ue4cEJaAjrBC"'),
    'The tap must send to "Call tap on website"; a wrong label is a dead destination.',
  )
  const tracker = source("components/phone-click-tracker.tsx")
  assert.ok(
    tracker.includes('queueMeasurementEvent("conversion", { send_to: ADS_PHONE_CONVERSION_SEND_TO })'),
    "A tel: tap must fire the Ads conversion when the label is set.",
  )
  assert.ok(
    tracker.includes("if (ADS_PHONE_CONVERSION_SEND_TO)"),
    "The phone conversion must stay off until a label exists.",
  )
})

test("five overdue quote review retries get a slot alongside twenty fresh reviews", async () => {
  const retried = new Set()
  const attempts = []
  let notificationUnavailable = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    checkEmail(operation) {
      if (operation === "attempt") throw new Error("Process stopped after freeze")
    },
    checkAlert({ dedupeKey }) {
      if (!dedupeKey.startsWith("quote-email-review:")) return
      attempts.push(dedupeKey)
      if (notificationUnavailable) {
        retried.add(dedupeKey)
        throw new Error("Notification write unavailable")
      }
    },
  })
  for (let index = 1; index <= 6; index++) {
    const key = "10000000-0000-4000-8000-" + String(index).padStart(12, "0")
    assert.equal((await route.submit([], { key })).status, 503)
  }
  route.advance(24)
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 0)
  assert.equal(retried.size, 6)
  notificationUnavailable = false
  attempts.length = 0
  for (let index = 7; index <= 26; index++) {
    const key = "10000000-0000-4000-8000-" + String(index).padStart(12, "0")
    assert.equal((await route.submit([], { key })).status, 503)
  }
  route.advance(24)
  assert.equal((await route.sweep()).detail.quoteEmailReviews, 20)
  assert.equal(attempts.filter((key) => retried.has(key)).length, 5)
  assert.equal(attempts.filter((key) => !retried.has(key)).length, 15)
  assert.equal(route.providerCalls.length, 0)
})

test("production sweep repairs legacy recovery 422 receipts without a recovery marker or another send", async () => {
  let interrupted = true
  let alertUnavailable = true
  const route = quoteRouteHarness({
    emailConfigured: true,
    email: "customer@example.test",
    checkEmail(operation) {
      if (interrupted && operation === "attempt") throw new Error("Process stopped after freeze")
      if (operation === "send") return { error: { statusCode: 422, message: "Rejected recipient" } }
    },
    checkAlert({ dedupeKey }) {
      if (alertUnavailable && dedupeKey.endsWith(":failed")) throw new Error("Notification write unavailable")
    },
  })
  assert.equal((await route.submit()).status, 503)
  interrupted = false
  route.advance(16 / 60)
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 2)
  assert.equal(route.providerCalls.length, 2)
  const failureReceipts = route.events.filter(({ kind }) => kind === "email.failed")
  assert.equal(failureReceipts.length, 2)
  for (const row of route.events) {
    if (row.kind === "email.attempt") delete row.detail.recovery
    if (row.kind === "email.out") delete row.detail.environment
  }
  alertUnavailable = false
  route.advance(40)
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 0)
  assert.equal((await route.sweep()).detail.quoteEmailRecoveries, 0)
  assert.equal(route.providerCalls.length, 2)
  const alerts = route.alerts.filter(({ dedupeKey }) => dedupeKey.endsWith(":failed"))
  assert.deepEqual(alerts.map(({ sourceEventId }) => sourceEventId), failureReceipts.map(({ id }) => id))
  assert.ok(alerts.every(({ ownerOnly, url }) => ownerOnly && url === "/ops/leads/1#spike"))
})

test("a filed direct rejection warning leaves projection repair and other owners eligible", async (t) => {
  for (const activeOwners of [[1], [1, 2]]) {
    const missingOwners = activeOwners.slice(1)
    await t.test(missingOwners.length ? "another active owner needs a warning" : "every active owner already has a warning", async () => {
      let projectionUnavailable = true
      let projectionWrites = 0
      const route = quoteRouteHarness({
        emailConfigured: true,
        activeOwners,
        checkEmail(operation) {
          if (operation === "send") return { error: { statusCode: 422, message: "Rejected owner address" } }
        },
        checkDelivery(status) {
          if (status !== "failed") return
          if (projectionUnavailable) throw new Error("Lead delivery projection unavailable")
          projectionWrites++
        },
        checkAlert({ priority, operatorId }) {
          if (priority === "interrupt" && operatorId !== 1) throw new Error("Operator notification unavailable")
        },
      })
      assert.equal((await route.submit()).status, 200)
      const lead = [...route.leads.values()][0]
      assert.equal(lead.email_delivery_status, "pending")
      assert.deepEqual(route.alerts.map(({ operatorId }) => operatorId), [1])
      const failure = route.events.find(({ kind }) => kind === "email.failed")
      projectionUnavailable = false
      route.advance(40)
      assert.equal((await route.sweep()).ok, true)
      assert.equal(lead.email_delivery_status, "rejected")
      assert.equal(lead.email_delivery_error, failure.body)
      route.advance(1)
      assert.equal((await route.sweep()).ok, true)
      assert.equal(projectionWrites, 1)
      const recoveryAlerts = route.alerts.filter(({ dedupeKey }) => dedupeKey.startsWith("quote-owner-delivery:"))
      assert.deepEqual(recoveryAlerts.map(({ operatorId, sourceEventId }) => [operatorId, sourceEventId]),
        missingOwners.map((operatorId) => [operatorId, failure.id]))
      assert.equal(route.providerCalls.length, 1)
    })
  }
})

test("production sweep repairs the lead projection from saved failed and suppressed callbacks", async () => {
  const route = quoteRouteHarness({ emailConfigured: true })
  const reasons = [
    ["email.failed", "The provider failed to deliver the owner email.", "accepted"],
    ["email.suppressed", "The owner address is suppressed.", "accepted"],
    ["email.failed", "An operator resolved the delivery problem.", "resolved"],
  ]
  for (const [index, [type, reason, oldStatus]] of reasons.entries()) {
    const key = "10000000-0000-4000-8000-" + String(index + 1).padStart(12, "0")
    assert.equal((await route.submit([], { key })).status, 200)
    const lead = [...route.leads.values()].at(-1)
    const acceptance = route.events.findLast(({ kind }) => kind === "email.accepted")
    const signedFailure = {
      ...acceptance,
      id: route.events.length + 1,
      kind: "email.failed",
      externalId: `resend:${type}:${acceptance.detail.providerEmailId}`,
      body: reason,
      detail: { ...acceptance.detail, providerType: type },
    }
    route.events.push(signedFailure)
    Object.assign(lead, { email_delivery_status: oldStatus, email_delivery_error: "" })
    route.alerts.push({
      dedupeKey: `resend-failure:${acceptance.detail.providerEmailId}`, sourceEventId: signedFailure.id,
    })
  }

  assert.equal((await route.sweep()).detail.terminalLeadEmailRepairs, 2)
  assert.equal((await route.sweep()).detail.terminalLeadEmailRepairs, 0)
  assert.deepEqual([...route.leads.values()].map(({ email_delivery_status, email_delivery_error }) =>
    [email_delivery_status, email_delivery_error]), reasons.map(([, reason, oldStatus]) =>
    oldStatus === "resolved" ? ["resolved", ""] : ["failed", reason]))
  assert.equal(route.alerts.filter(({ dedupeKey }) => dedupeKey.startsWith("resend-failure:")).length, 3)
  assert.equal(route.providerCalls.length, 3)
})

test("production sweep files one alert for a signed bounce received only by preview", async () => {
  const route = quoteRouteHarness({ emailConfigured: true })
  assert.equal((await route.submit()).status, 200)
  const { providerEmailId } = route.events.find(({ kind }) => kind === "email.accepted").detail
  const alerts = () => route.alerts.filter(({ dedupeKey }) => dedupeKey === `resend-failure:${providerEmailId}`)
  route.env.VERCEL_ENV = "preview"
  const bounceReason = "The owner mailbox rejected the email."
  assert.equal((await route.signedBounce(providerEmailId, bounceReason)).status, 200)
  const failureReceipts = route.events.filter(({ kind }) => kind === "email.failed")
  assert.equal(failureReceipts.length, 1)
  assert.equal(failureReceipts[0].body, bounceReason)
  assert.equal((await route.sweep()).detail.terminalLeadEmailRepairs, 0)
  assert.equal(alerts().length, 0)

  route.env.VERCEL_ENV = "production"
  assert.equal((await route.sweep()).detail.terminalLeadEmailRepairs, 1)
  route.advance(1)
  assert.equal((await route.sweep()).detail.terminalLeadEmailRepairs, 0)
  assert.equal(alerts().length, 1)
  assert.equal(alerts()[0].sourceEventId, failureReceipts[0].id)
  assert.equal(alerts()[0].url, "/ops/leads/1#spike")
  assert.equal(route.providerCalls.length, 1)
})
