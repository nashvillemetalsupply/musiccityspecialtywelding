import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import test from "node:test"

const ORIGIN = "https://mcsw.test"
const SESSION_A = "a".repeat(64)
const SESSION_B = "b".repeat(64)
const BOARD_URL = `${ORIGIN}/board`
const META_URL = `${ORIGIN}/__ops_active_session__`
const WORKER = readFileSync(new URL("../public/ops-sw.js", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const REGISTER = readFileSync(new URL("../app/ops/register-ops-service-worker.ts", import.meta.url), "utf8")
const NEXT_CONFIG = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8")
const CALENDAR_ACTIONS = readFileSync(new URL("../app/board/calendar-actions.ts", import.meta.url), "utf8")
const GLASS_ACTIONS = readFileSync(new URL("../app/ops/leads/[id]/glass-actions.ts", import.meta.url), "utf8")
const BOARD_PAGE = readFileSync(new URL("../app/board/page.tsx", import.meta.url), "utf8")
const PUSH_TOGGLE = readFileSync(new URL("../app/ops/push-toggle.tsx", import.meta.url), "utf8")

function createHarness(fetchImpl = async () => new Response("network"), sessionImpl = async () => Response.json({ sessionId: SESSION_A }), build = "test-sha") {
  const listeners = new Map()
  const buckets = new Map()
  const caches = {
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map())
      const bucket = buckets.get(name)
      return {
        async match(key) {
          const response = bucket.get(typeof key === "string" ? key : key.url)
          return response?.clone() ?? undefined
        },
        async put(key, response) {
          bucket.set(typeof key === "string" ? key : key.url, response.clone())
        },
        async delete(key) {
          return bucket.delete(typeof key === "string" ? key : key.url)
        },
      }
    },
    async keys() { return [...buckets.keys()] },
    async delete(name) { return buckets.delete(name) },
  }
  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/ops-sw.js?build=${build}` },
    registration: { scope: `${ORIGIN}/`, async showNotification() {} },
    clients: { async matchAll() { return [] }, async openWindow() { return null }, async claim() {} },
    addEventListener(name, handler) { listeners.set(name, handler) },
    async skipWaiting() {},
  }
  const workerFetch = async (request) => {
    if (new URL(request.url).pathname === "/api/ops/cache-session") return sessionImpl(request)
    return fetchImpl(request)
  }
  vm.runInNewContext(WORKER, { self, caches, fetch: workerFetch, Request, Response, URL, TextDecoder, Promise })
  return {
    caches,
    async seedSession(sessionId) {
      const auth = await caches.open(`ops-auth-${sessionId}`)
      await auth.put(new Request(BOARD_URL), new Response(`private board ${sessionId}`))
      const metadata = await caches.open("ops-session-meta-v1")
      await metadata.put(new Request(META_URL), new Response(sessionId))
    },
    dispatch(name, event) { listeners.get(name)(event) },
    async fetchEvent(request) {
      let responsePromise = null
      const waits = []
      this.dispatch("fetch", {
        request,
        respondWith(value) { responsePromise = Promise.resolve(value) },
        waitUntil(value) { waits.push(Promise.resolve(value)) },
      })
      return {
        response: responsePromise ? await responsePromise : null,
        waits: Promise.all(waits),
      }
    },
    async message(sessionId) {
      let pending
      this.dispatch("message", {
        data: { type: "ops-session", sessionId },
        waitUntil(value) { pending = value },
      })
      await pending
    },
  }
}

function navRequest(url, method = "GET", body = null) {
  return { url, method, body, mode: "navigate" }
}

async function activeSession(harness) {
  const metadata = await harness.caches.open("ops-session-meta-v1")
  const response = await metadata.match(new Request(META_URL))
  return response ? response.text() : null
}

test("registers at the root and versions static caches with the build SHA", () => {
  assert.match(REGISTER, /register\(`\/ops-sw\.js\?build=/)
  assert.match(REGISTER, /\{ scope: "\/" \}/)
  assert.match(NEXT_CONFIG, /OPS_SW_BUILD_SHA:\s*process\.env\.VERCEL_GIT_COMMIT_SHA\?\.trim\(\)\s*\|\|\s*"dev"/)
  assert.match(NEXT_CONFIG, /Service-Worker-Allowed[\s\S]*?value: "\/"/)
  assert.match(WORKER, /ops-static-\$\{BUILD_SHA\}/)
  assert.match(WORKER, /startsWith\("ops-static-"\) && name !== STATIC_CACHE/)
})

test("sign-out purges the authenticated cache after the network confirms logout", async () => {
  const harness = createHarness(async () => new Response(null, { status: 303, headers: { Location: "/ops" } }))
  await harness.seedSession(SESSION_A)
  const result = await harness.fetchEvent(navRequest(`${ORIGIN}/api/ops/logout`, "POST", "logout"))
  assert.equal(result.response.status, 303)
  assert.equal((await harness.caches.keys()).some((name) => name === `ops-auth-${SESSION_A}`), false)
  assert.equal(await activeSession(harness), null)
})

test("signed-out board navigation returns the login response and purges cached board data", async () => {
  const login = new Response("login form", { status: 200 })
  Object.defineProperty(login, "redirected", { value: true })
  const harness = createHarness(async () => new Response("unused board"), async () => login)
  await harness.seedSession(SESSION_A)
  const result = await harness.fetchEvent(navRequest(BOARD_URL))
  assert.equal(await result.response.text(), "login form")
  assert.equal((await harness.caches.keys()).some((name) => name === `ops-auth-${SESSION_A}`), false)
  assert.equal(await activeSession(harness), null)
})

test("POST requests are network-only and never enter a cache", async () => {
  let networkCalls = 0
  const harness = createHarness(async () => {
    networkCalls += 1
    return new Response(`<div data-ops-session-cache-id="${SESSION_A}">private page</div>`)
  })
  const page = await harness.fetchEvent(navRequest(BOARD_URL))
  assert.equal(page.response.status, 200, "the private GET cache must be active")
  await page.waits
  const before = await harness.caches.keys()
  const result = await harness.fetchEvent(navRequest(`${ORIGIN}/ops/leads/42`, "POST", "server action"))
  assert.equal(result.response, null, "unintercepted POST is left to the browser's network stack")
  assert.equal(networkCalls, 1, "the worker neither sends nor replays the POST")
  assert.deepEqual(await harness.caches.keys(), before)
  const auth = await harness.caches.open(`ops-auth-${SESSION_A}`)
  assert.ok(await auth.match(new Request(BOARD_URL)))
})

test("offline board navigation can only fall back to the matching session cache", async () => {
  const harness = createHarness(async () => { throw new Error("offline") }, async () => { throw new Error("offline") })
  await harness.seedSession(SESSION_A)
  const result = await harness.fetchEvent(navRequest(BOARD_URL))
  assert.equal(await result.response.text(), `private board ${SESSION_A}`)
})

test("a new session purges the previous session cache", async () => {
  const harness = createHarness()
  await harness.seedSession(SESSION_A)
  await harness.message(SESSION_B)
  assert.equal((await harness.caches.keys()).some((name) => name === `ops-auth-${SESSION_A}`), false)
  assert.equal(await activeSession(harness), SESSION_B)
})

test("successful private pages are cached only under the session marker they render", async () => {
  const page = new Response(`<div data-ops-session-cache-id="${SESSION_A}">board</div>`)
  const harness = createHarness(async () => page)
  const result = await harness.fetchEvent(navRequest(BOARD_URL))
  assert.equal(result.response.status, 200)
  assert.equal((await harness.caches.keys()).includes(`ops-auth-${SESSION_A}`), true)
  assert.equal(await activeSession(harness), SESSION_A)
})

test("/ops/leads navigations and versioned static assets are cached without repeat static fetches", async () => {
  const lead = new Response(`<div data-ops-session-cache-id="${SESSION_A}">lead</div>`)
  const leadHarness = createHarness(async () => lead)
  const leadResult = await leadHarness.fetchEvent(navRequest(`${ORIGIN}/ops/leads/42`))
  assert.equal(leadResult.response.status, 200)
  assert.equal((await leadHarness.caches.keys()).includes(`ops-auth-${SESSION_A}`), true)

  let assetVersion = 0
  const staticHarness = createHarness(async () => new Response(`asset-${++assetVersion}`))
  const request = { url: `${ORIGIN}/_next/static/chunks/app.js`, method: "GET", body: null, mode: "cors" }
  const first = await staticHarness.fetchEvent(request)
  assert.equal(await first.response.text(), "asset-1")
  await first.waits
  const second = await staticHarness.fetchEvent(request)
  assert.equal(await second.response.text(), "asset-1")
  await second.waits
  const staticCache = await staticHarness.caches.open("ops-static-test-sha")
  assert.equal(assetVersion, 1, "the versioned asset must not be fetched again on a cache hit")
  assert.equal(await (await staticCache.match(request)).text(), "asset-1")
})

test("cached static assets remain available offline without a background network attempt", async () => {
  let networkCalls = 0
  const harness = createHarness(async () => { networkCalls += 1; throw new Error("offline") })
  const request = { url: `${ORIGIN}/_next/static/chunks/cached.js`, method: "GET", body: null, mode: "cors" }
  const cache = await harness.caches.open("ops-static-test-sha")
  await cache.put(request, new Response("cached asset"))
  const result = await harness.fetchEvent(request)
  assert.equal(await result.response.text(), "cached asset")
  await result.waits
  assert.equal(networkCalls, 0)
})

test("static cache misses do not cache error responses and retry the network", async () => {
  let networkCalls = 0
  const harness = createHarness(async () => ++networkCalls === 1
    ? new Response("unavailable", { status: 503 })
    : new Response("recovered asset"))
  const request = { url: `${ORIGIN}/_next/static/chunks/recover.js`, method: "GET", body: null, mode: "cors" }
  const failed = await harness.fetchEvent(request)
  assert.equal(failed.response.status, 503)
  await failed.waits
  const cache = await harness.caches.open("ops-static-test-sha")
  assert.equal(await cache.match(request), undefined)
  const recovered = await harness.fetchEvent(request)
  assert.equal(await recovered.response.text(), "recovered asset")
  await recovered.waits
  assert.equal(networkCalls, 2)
  assert.equal(await (await cache.match(request)).text(), "recovered asset")
})

test("a static network rejection on a cache miss can recover on the next request", async () => {
  let networkCalls = 0
  const harness = createHarness(async () => {
    if (++networkCalls === 1) throw new Error("offline")
    return new Response("recovered asset")
  })
  const request = { url: `${ORIGIN}/_next/static/chunks/retry.js`, method: "GET", body: null, mode: "cors" }
  await assert.rejects(harness.fetchEvent(request), /offline/)
  const recovered = await harness.fetchEvent(request)
  assert.equal(await recovered.response.text(), "recovered asset")
  await recovered.waits
  assert.equal(networkCalls, 2)
})

test("development static assets pass through to the browser because their URLs can change in place", async () => {
  let networkCalls = 0
  const harness = createHarness(async () => { networkCalls += 1; return new Response("unused") }, undefined, "dev")
  const request = { url: `${ORIGIN}/_next/static/chunks/app.js`, method: "GET", body: null, mode: "cors" }
  const result = await harness.fetchEvent(request)
  assert.equal(result.response, null, "the browser must fetch mutable development assets")
  await result.waits
  assert.equal(networkCalls, 0)
  assert.deepEqual(await harness.caches.keys(), [])
})

test("a new build fetches its own static asset and removes only older static caches", async () => {
  let networkCalls = 0
  const harness = createHarness(async () => { networkCalls += 1; return new Response("new build asset") }, undefined, "new-sha")
  const request = { url: `${ORIGIN}/_next/static/chunks/shared.js`, method: "GET", body: null, mode: "cors" }
  const old = await harness.caches.open("ops-static-old-sha")
  await old.put(request, new Response("old build asset"))
  await harness.seedSession(SESSION_A)
  const result = await harness.fetchEvent(request)
  assert.equal(await result.response.text(), "new build asset")
  await result.waits
  assert.equal(networkCalls, 1, "a prior build cache cannot satisfy this build")
  let activated
  harness.dispatch("activate", { waitUntil(value) { activated = value } })
  await activated
  assert.equal((await harness.caches.keys()).includes("ops-static-old-sha"), false)
  assert.equal((await harness.caches.keys()).includes("ops-static-new-sha"), true)
  assert.equal((await harness.caches.keys()).includes(`ops-auth-${SESSION_A}`), true)
})

test("calendar and Customer Page mutations revalidate their affected paths", () => {
  assert.match(CALENDAR_ACTIONS, /revalidatePath\("\/board"\)/)
  assert.match(CALENDAR_ACTIONS, /revalidatePath\(`\/ops\/leads\/\$\{created\.leadId\}`\)/)
  assert.match(GLASS_ACTIONS, /revalidatePath\(`\/ops\/leads\/\$\{leadId\}`\)/)
})

test("signed-out /board requests use the login door instead of a zero-state board", () => {
  assert.match(BOARD_PAGE, /if \(!operator\) redirect\("\/ops"\)/)
  assert.doesNotMatch(BOARD_PAGE, /EMPTY_BOARD/)
})

test("push-toggle failures remain visible to the operator", () => {
  assert.match(PUSH_TOGGLE, /errorMessage && <span[^>]*role="alert"/)
  assert.match(PUSH_TOGGLE, /Alerts could not be checked/)
  assert.match(PUSH_TOGGLE, /Alerts could not be enabled/)
})
