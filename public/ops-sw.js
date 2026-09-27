/* Service worker for operations push alerts. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Retire the legacy root-scoped registration as soon as this worker update
    // reaches it. Current Jobs registrations are intentionally /ops/ only.
    if (new URL(self.registration.scope).pathname === "/") {
      await self.registration.unregister()
      return
    }
    await self.clients.claim()
  })())
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
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      const client = windowClients.find((candidate) => {
        try { return new URL(candidate.url).origin === self.location.origin } catch { return false }
      })
      if (!client) return clients.openWindow(target)
      if (new URL(client.url).href === target) return client.focus()
      if (!("navigate" in client)) return clients.openWindow(target)
      const navigated = await client.navigate(target)
      return (navigated || client).focus()
    })
  )
})

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
