import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
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
  message = "Repair a bracket", upload = () => {}, failLeadRead = "", emailConfigured = false,
  email = "", checkEmail = () => {}, checkPhotos = () => {},
} = {}) {
  const intakeKey = "10000000-0000-4000-8000-000000000001"
  const leads = new Map()
  const photoIntents = new Map()
  const blobs = new Map()
  const photoReceipts = []
  const alerts = []
  const emails = []
  const providerReceipts = new Map()
  const errors = []
  const events = []
  const consents = []
  const context = vm.createContext({
    Buffer, File, Response, Uint8Array,
    process: { env: {
      BLOB_READ_WRITE_TOKEN: "stub",
      ...(emailConfigured ? { RESEND_API_KEY: "stub", QUOTE_FROM_EMAIL: "from@example.test", QUOTE_TO_EMAIL: "owner@example.test" } : {}),
    } },
    console: { error: (...args) => errors.push(args), warn() {} },
  })
  const findLead = (id) => [...leads.values()].find((row) => row.id === id)
  const fakes = {
    "node:crypto": require("node:crypto"),
    "resend": { Resend: class { emails = { send: async (payload, options) => {
      if (providerReceipts.has(options.idempotencyKey)) return providerReceipts.get(options.idempotencyKey)
      const response = checkEmail("send", options.idempotencyKey.startsWith("quote-owner:") ? "shop" : "customer")
      emails.push({ payload, options })
      const receipt = { data: { id: `email-${emails.length}` } }
      providerReceipts.set(options.idempotencyKey, receipt)
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
          leads.set(values[25], {
            id, public_id, person_id: null, first_name, last_name, phone, email, service,
            message, preferred_contact, photo_count, is_test, source, photos: new Set(),
          })
          if (values[29]) consents.push(values[27])
          return [{ id, public_id, is_test }]
        }
        if (sql.includes("FROM leads WHERE intake_key")) return [leads.get(leadId)].filter(Boolean)
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
        if (sql.includes("FROM events WHERE lead_id")) return events.filter((row) => row.leadId === leadId && row.kind === "form.quote")
        if (sql.includes("SELECT kind") && sql.includes("detail->>'sourceEventId'")) {
          const intent = events.find((event) => event.id === Number(leadId))
          checkEmail("receipt", intent?.detail.audience)
          const kinds = [...sql.matchAll(/'(email\.\w+)'/g)].map((match) => match[1])
          return events.filter((event) =>
            kinds.includes(event.kind) && event.detail.sourceEventId === intent?.id
              && !(sql.includes("providerType") && event.kind === "email.failed" && event.detail.providerType)
          ).slice(-1)
        }
        if (sql.includes("FROM events")) {
          return events.filter((event) => event.kind === values[0] && event.externalId === values[1])
        }
        if (sql.includes("FROM lead_photo_intents")) {
          checkPhotos()
          return [...(photoIntents.get(leadId)?.values() ?? [])]
        }
        throw new Error(`Unexpected SQL mock call: ${sql}`)
      },
    },
    "@/lib/leads": {
      reserveLeadPhotoIntents: async (leadId, _intake, plans) => {
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
      markLeadDelivery: async () => {},
    },
    "@/lib/notify": { notifyAll: async (alert) => { alerts.push(alert) } },
    "@/lib/shop-contact": { getShopPhone: () => ({ display: "(615) 555-0100" }) },
    "@/lib/ops-auth": { isAuthorizedCron: (req) => req.headers.has("authorization") },
    "@/lib/email-templates": { brandedEmail: () => "", escapeHtml: (value) => value },
    "@/lib/events": { recordEvent: async (event) => {
      if (event.kind === "email.out") checkEmail("intent", event.detail.audience)
      if (event.kind === "email.accepted") checkEmail("acceptance", event.detail.audience)
      if (event.externalId && events.some((prior) => prior.kind === event.kind && prior.externalId === event.externalId)) return null
      const id = events.length + 1
      events.push({ ...event, id })
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
  const { POST } = load("app/api/quote/route.ts")
  return {
    leads, photoIntents, blobs, photoReceipts, alerts, emails, consents, events, errors,
    expireProviderReceipts: () => providerReceipts.clear(),
    submit(photos = [], { authorized = false, key = intakeKey, phone = "6155550100", textConsent = false } = {}) {
      const form = new FormData()
      for (const [name, value] of Object.entries({
        firstName: "Example", phone, service: "Not Sure / Other", message, intakeKey: key, email,
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
    const firstUnknownAudience = route.events.find((event) => event.kind === "email.unknown")?.detail.audience

    firstAttempt = false
    route.expireProviderReceipts()
    const retry = await route.submit()
    assert.equal(retry.status, 200)
    assert.deepEqual(await retry.json(), { ok: true, accepted: true, leadSaved: true })
    assert.equal(route.leads.size, 1)
    assert.deepEqual(route.emails.map(({ payload }) => payload.to), ["owner@example.test", "customer@example.test"])
    assert.equal(firstUnknownAudience, "shop")
    assert.ok(route.errors.some(([message]) => /reconciliation/i.test(message)))
  })
}

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
