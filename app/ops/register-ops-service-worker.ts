export async function registerOpsServiceWorker() {
  if (!("serviceWorker" in navigator)) return null

  const expectedScope = new URL("/ops/", window.location.origin).href
  const registrations = await navigator.serviceWorker.getRegistrations()

  // Older builds registered this worker at the site root. Remove that legacy
  // registration so public and Customer Pages cannot be controlled by Jobs.
  await Promise.all(registrations.map(async (registration) => {
    const scriptUrl = registration.active?.scriptURL
      || registration.waiting?.scriptURL
      || registration.installing?.scriptURL
      || ""
    const scriptPath = scriptUrl ? new URL(scriptUrl).pathname : ""
    if (scriptPath === "/ops-sw.js" && registration.scope !== expectedScope) {
      await registration.unregister()
    }
  }))

  return navigator.serviceWorker.register("/ops-sw.js", { scope: "/ops/" })
}
