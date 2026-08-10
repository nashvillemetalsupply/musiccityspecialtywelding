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
  let payload = { title: "Music City Specialty Welding", body: "Open the board.", url: "/ops" }
  try {
    payload = { ...payload, ...event.data.json() }
  } catch {
    /* keep defaults */
  }
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
  const url = (event.notification.data && event.notification.data.url) || "/ops"
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const requested = new URL(url, self.location.origin)
      const target = requested.origin === self.location.origin && requested.pathname.startsWith("/ops")
        ? requested.href
        : new URL("/ops", self.location.origin).href
      for (const client of windowClients) {
        if (new URL(client.url).pathname.startsWith("/ops") && "navigate" in client) {
          return client.navigate(target).then((navigated) => {
            const active = navigated || client
            active.postMessage({ type: "ops-refresh", url: target })
            return active.focus()
          })
        }
      }
      return clients.openWindow(target)
    })
  )
})
