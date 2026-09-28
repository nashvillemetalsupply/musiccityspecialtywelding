export async function registerOpsServiceWorker() {
  if (!("serviceWorker" in navigator)) return null

  const expectedScope = new URL("/", window.location.origin).href
  const registrations = await navigator.serviceWorker.getRegistrations()

  // The app shell now covers /board as well as /ops/leads. Retire this same
  // worker's old nested registration so every controlled route shares a scope.
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

  const buildSha = process.env.OPS_SW_BUILD_SHA?.trim() || "dev"
  return navigator.serviceWorker.register(`/ops-sw.js?build=${encodeURIComponent(buildSha)}`, { scope: "/" })
}
