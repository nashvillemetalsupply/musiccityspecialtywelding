/* Root-scoped operations worker: private pages are session-keyed and writes stay network-only. */
const BUILD_SHA = new URL(self.location.href).searchParams.get("build") || "dev"
const STATIC_CACHE = `ops-static-${BUILD_SHA}`
const AUTH_CACHE_PREFIX = "ops-auth-"
const SESSION_CACHE = "ops-session-meta-v1"
const SESSION_KEY = new Request(new URL("/__ops_active_session__", self.location.origin).href)
const SESSION_MARKER = /data-ops-session-cache-id=["']([a-f0-9]{64})["']/

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter((name) => name.startsWith("ops-static-") && name !== STATIC_CACHE)
      .map((name) => caches.delete(name)))
    await purgeAuthCaches(await readActiveSession())
    await self.clients.claim()
  })())
})

self.addEventListener("message", (event) => {
  if (event.data?.type !== "ops-session") return
  const sessionId = typeof event.data.sessionId === "string" && /^[a-f0-9]{64}$/.test(event.data.sessionId)
    ? event.data.sessionId
    : null
  event.waitUntil(setActiveSession(sessionId))
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Sign-out is a network-only POST. Once the server confirms its redirect,
  // purge private data before the browser follows through to the login door.
  if (request.method === "POST" && url.pathname === "/api/ops/logout") {
    event.respondWith((async () => {
      const response = await fetch(request)
      if (response.ok || response.redirected || (response.status >= 300 && response.status < 400)) {
        await setActiveSession(null)
      }
      return response
    })())
    return
  }

  // Forms, server actions, uploads and every request with a body pass straight
  // to the network. They are never stored and never queued for replay.
  if (request.method !== "GET" || request.body !== null) return

  if (request.mode === "navigate" && isPrivatePagePath(url.pathname)) {
    const background = []
    const response = fetchPrivatePage(request, event.clientId, (pending) => background.push(pending))
    event.waitUntil(response.then(() => Promise.all(background)).then(() => undefined).catch(() => undefined))
    event.respondWith(response)
    return
  }

  if (url.pathname.startsWith("/_next/static/")) {
    const revalidate = updateStaticCache(request)
    event.waitUntil(revalidate.then(() => undefined).catch(() => undefined))
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE)
      return await cache.match(request) || revalidate
    })())
  }
})

self.addEventListener("push", (event) => {
  let payload = { title: "Music City Specialty Welding", body: "Open the board.", url: "/board" }
  try {
    payload = { ...payload, ...event.data.json() }
  } catch {
    /* keep defaults */
  }
  payload.url = safeNotificationPath(payload.url)
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
      icon: "/images/optimized/mcs welding logo.png",
      badge: "/icon-dark-32x32.png",
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = safeNotificationPath(event.notification.data && event.notification.data.url)
  const target = new URL(url, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      const client = windowClients.find((candidate) => {
        try { return new URL(candidate.url).origin === self.location.origin } catch { return false }
      })
      if (!client) return self.clients.openWindow(target)
      if (new URL(client.url).href === target) return client.focus()
      if (!("navigate" in client)) return self.clients.openWindow(target)
      const navigated = await client.navigate(target)
      return (navigated || client).focus()
    })
  )
})

function isPrivatePagePath(pathname) {
  return pathname === "/board" || pathname.startsWith("/board/") || pathname.startsWith("/ops/leads/")
}

function safeNotificationPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/board"
  try {
    const requested = new URL(value, self.location.origin)
    return requested.origin === self.location.origin
      ? `${requested.pathname}${requested.search}${requested.hash}`
      : "/board"
  } catch {
    return "/board"
  }
}

function authCacheName(sessionId) {
  return `${AUTH_CACHE_PREFIX}${sessionId}`
}

async function readActiveSession() {
  const cache = await caches.open(SESSION_CACHE)
  const saved = await cache.match(SESSION_KEY)
  const sessionId = saved ? await saved.text() : ""
  return /^[a-f0-9]{64}$/.test(sessionId) ? sessionId : null
}

async function writeActiveSession(sessionId) {
  const cache = await caches.open(SESSION_CACHE)
  if (sessionId) await cache.put(SESSION_KEY, new Response(sessionId, { headers: { "Content-Type": "text/plain" } }))
  else await cache.delete(SESSION_KEY)
}

async function purgeAuthCaches(keepSessionId = null) {
  const keepName = keepSessionId ? authCacheName(keepSessionId) : ""
  const names = await caches.keys()
  await Promise.all(names
    .filter((name) => name.startsWith(AUTH_CACHE_PREFIX) && name !== keepName)
    .map((name) => caches.delete(name)))
}

async function setActiveSession(sessionId) {
  const previous = await readActiveSession()
  if (previous !== sessionId || sessionId === null) await purgeAuthCaches()
  await writeActiveSession(sessionId)
  if (sessionId) await purgeAuthCaches(sessionId)
}

async function updateStaticCache(request) {
  const cache = await caches.open(STATIC_CACHE)
  const response = await fetch(request)
  if (response.ok && response.type !== "opaque") await cache.put(request, response.clone())
  return response
}

async function responseSessionId(response) {
  const reader = response.clone().body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder()
  let text = ""
  while (text.length < 65536) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    const match = text.match(SESSION_MARKER)
    if (match) {
      void reader.cancel()
      return match[1]
    }
    if (text.includes("data-ops-session-cache-id=")) {
      void reader.cancel()
      return null
    }
  }
  void reader.cancel()
  return null
}

async function signedOutResponse(response) {
  return response.redirected || response.status === 401 || (response.status >= 300 && response.status < 400)
}

async function loginResponseAfterUnauthorized() {
  return fetch(new Request(new URL("/ops", self.location.origin).href, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  }))
}

async function networkSession() {
  const response = await fetch(new Request(new URL("/api/ops/cache-session", self.location.origin).href, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  }))
  if (await signedOutResponse(response)) {
    return { signedOut: true, loginResponse: response.status === 401 ? await loginResponseAfterUnauthorized() : response }
  }
  if (!response.ok) throw new Error("The current operations session could not be confirmed.")
  const payload = await response.json()
  if (typeof payload?.sessionId !== "string" || !/^[a-f0-9]{64}$/.test(payload.sessionId)) {
    return { signedOut: true, loginResponse: await loginResponseAfterUnauthorized() }
  }
  return { signedOut: false, sessionId: payload.sessionId }
}

async function revalidatePrivatePage(request, onSignedOut) {
  const response = await fetch(request)
  if (await signedOutResponse(response)) {
    await setActiveSession(null)
    onSignedOut?.()
    return response.status === 401 ? loginResponseAfterUnauthorized() : response
  }
  if (!response.ok) return response

  const renderedSession = await responseSessionId(response)
  if (!renderedSession) {
    await setActiveSession(null)
    return response
  }
  await setActiveSession(renderedSession)
  const cache = await caches.open(authCacheName(renderedSession))
  await cache.put(request, response.clone())
  return response
}

async function fetchPrivatePage(request, clientId, addBackgroundWork) {
  try {
    const state = await networkSession()
    if (state.signedOut) {
      await setActiveSession(null)
      return state.loginResponse
    }

    await setActiveSession(state.sessionId)
    const cache = await caches.open(authCacheName(state.sessionId))
    const cached = await cache.match(request)
    const revalidation = revalidatePrivatePage(request, async () => {
      if (!clientId) return
      const client = await self.clients.get(clientId)
      client?.postMessage({ type: "ops-session-expired" })
    })
    if (cached) {
      addBackgroundWork(revalidation)
      return cached
    }
    return await revalidation
  } catch (error) {
    const sessionId = await readActiveSession()
    if (!sessionId) throw error
    const cache = await caches.open(authCacheName(sessionId))
    const cached = await cache.match(request)
    if (cached) return cached
    throw error
  }
}
