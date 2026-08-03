/* Service worker for operations push alerts. */
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
      for (const client of windowClients) {
        if (client.url.includes("/ops") && "focus" in client) return client.focus()
      }
      return clients.openWindow(url)
    })
  )
})
