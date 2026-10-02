import { readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const origin = "https://musiccityspecialtywelding.com"
const url = `${origin}/?utm_source=internal-verify&utm_medium=e2e#contact`
const dir = dirname(fileURLToPath(import.meta.url))
const lock = join(dir, "form-live-attempt.json")
const responseFile = join(dir, "form-live-response.json")
const screenshotFile = join(dir, "form-live-390.png")
const reportFile = join(dir, "form-live-verification.md")
const fake = {
  name: "Internal Test E2E 20261002",
  phone: "(615) 555-0199",
  service: "Not Sure / Other",
  email: "mcsw-e2e-20261002@example.com",
  details: "[INTERNAL TEST] Authorized production quote-form verification. Fake request; do not contact.",
}

if (!process.argv.includes("--confirm-single-live-submit")) {
  throw new Error("Explicit --confirm-single-live-submit flag required.")
}

function envValue(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"))
  if (!match) return ""
  let value = match[1].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  return value.trim()
}

let secret = ""
let credentialSource = ""
for (const candidate of [".env.vercel.production", ".env.local"]) {
  try {
    const value = envValue(await readFile(join(process.cwd(), candidate), "utf8"), "CRON_SECRET")
    if (Buffer.byteLength(value, "utf8") >= 32) {
      secret = value
      credentialSource = basename(candidate)
      break
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}
if (!secret) throw new Error("No usable local CRON_SECRET found.")

let browser
let apiPostCount = 0
let authAttached = false
let attemptCreated = false
try {
  const startedAt = new Date().toISOString()
  await writeFile(lock, JSON.stringify({ startedAt, state: "armed", target: `${origin}/api/quote` }, null, 2) + "\n", { flag: "wx" })
  attemptCreated = true
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" })
  const page = await context.newPage()
  const measurementRequests = []
  const pageErrors = []
  page.on("pageerror", error => pageErrors.push(error.message.slice(0, 300)))
  page.on("request", request => {
    const parsed = new URL(request.url())
    const host = parsed.hostname.toLowerCase()
    if (host === "www.googletagmanager.com" || host.includes("google-analytics.com") || host === "connect.facebook.net" || (host.endsWith("facebook.com") && parsed.pathname.startsWith("/tr"))) {
      measurementRequests.push(`${request.method()} ${host}${parsed.pathname}`)
    }
  })
  await page.route("**/api/quote", async route => {
    const request = route.request()
    const parsed = new URL(request.url())
    const exact = request.method() === "POST" && parsed.origin === origin && parsed.pathname === "/api/quote" && parsed.search === ""
    if (!exact) return route.continue()
    apiPostCount += 1
    if (apiPostCount > 1) return route.abort("blockedbyclient")
    authAttached = true
    return route.continue({ headers: { ...request.headers(), authorization: `Bearer ${secret}` } })
  })

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })
  await page.locator(".ms-quote-form").waitFor({ state: "visible", timeout: 20000 })
  const query = await page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)))
  if (query.utm_source !== "internal-verify" || query.utm_medium !== "e2e") throw new Error("Internal verification attribution was not retained.")
  await page.locator("#quote-name").fill(fake.name)
  await page.locator("#quote-phone").fill(fake.phone)
  await page.locator("#quote-service").selectOption({ label: fake.service })
  await page.locator("#quote-details").fill(fake.details)
  await page.locator("#quote-email").fill(fake.email)
  const consent = page.locator("#quote-text-consent")
  if (await consent.isChecked()) throw new Error("Text consent unexpectedly checked.")

  const responsePromise = page.waitForResponse(r => r.url() === `${origin}/api/quote` && r.request().method() === "POST", { timeout: 45000 })
  await page.getByRole("button", { name: "Send the job" }).click()
  const response = await responsePromise
  const status = response.status()
  const contentType = response.headers()["content-type"] || ""
  const rawBody = contentType.includes("application/json") ? await response.json() : null
  const body = {}
  for (const key of ["ok", "accepted", "suppressed", "partial", "consentConflict", "warning", "error"]) {
    if (typeof rawBody?.[key] === "boolean" || typeof rawBody?.[key] === "string") body[key] = rawBody[key]
  }
  const ui = page.locator(".ms-form-status").first()
  await ui.waitFor({ state: "visible", timeout: 20000 })
  const uiMessage = (await ui.innerText()).trim()
  const uiClass = await ui.getAttribute("class")
  const cleared = await page.locator("#quote-name").inputValue() === "" && await page.locator("#quote-phone").inputValue() === "" && await page.locator("#quote-service").inputValue() === "" && await page.locator("#quote-details").inputValue() === "" && await page.locator("#quote-email").inputValue() === ""
  await ui.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const png = await page.screenshot({ path: screenshotFile })
  const dimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
  const expectedMessage = "Got it. We’ll review the job and call you back. If it cannot wait, call now. We’re open 24/7."
  const assertions = {
    exactlyOneQuotePost: apiPostCount === 1,
    authenticatedRoute: authAttached,
    acceptedResponse: status === 200 && body.ok === true && body.accepted === true && body.suppressed !== true,
    honestSuccessUi: uiClass?.includes("is-success") === true && uiMessage === expectedMessage,
    formClearedAfterAcceptance: cleared,
    noTextConsent: await consent.isChecked() === false,
    noMeasurementRequests: measurementRequests.length === 0,
    screenshotWidth390: dimensions.width === 390,
  }
  const evidence = {
    verifiedAt: new Date().toISOString(),
    target: origin,
    viewport: { width: 390, height: 844, screenshot: dimensions },
    request: { method: "POST", path: "/api/quote", count: apiPostCount, authAttached, credentialSource, internalMarker: true, textConsent: false, phone: fake.phone, email: fake.email, attribution: "utm_source=internal-verify&utm_medium=e2e" },
    response: { status, contentType: contentType.split(";")[0], body },
    ui: { message: uiMessage, className: uiClass, formCleared: cleared },
    measurement: { requestCount: measurementRequests.length, requests: measurementRequests },
    browser: { pageErrorCount: pageErrors.length, pageErrors },
    assertions,
  }
  await writeFile(responseFile, JSON.stringify(evidence, null, 2) + "\n")
  await writeFile(lock, JSON.stringify({ startedAt, completedAt: evidence.verifiedAt, state: assertions.acceptedResponse ? "accepted" : "not-accepted", apiPostCount, status }, null, 2) + "\n")
  const checks = Object.entries(assertions).map(([name, pass]) => `- ${pass ? "PASS" : "FAIL"}: ${name}`).join("\n")
  await writeFile(reportFile, `# Live quote-form verification\n\nVerified at: ${evidence.verifiedAt}\n\nOne authenticated production POST reached \`/api/quote\` at a 390 x 844 viewport. The sanitized result was HTTP ${status} with \`${JSON.stringify(body)}\`. The UI showed: “${uiMessage}”\n\nThe request used reserved fake phone ${fake.phone}, ${fake.email}, the \`[INTERNAL TEST]\` marker, no photos, and no text consent. The internal verification URL produced ${measurementRequests.length} Google/Meta measurement requests.\n\n## Assertions\n\n${checks}\n\nArtifacts: [screenshot](form-live-390.png), [machine evidence](form-live-response.json).\n`)
  if (!Object.values(assertions).every(Boolean)) throw new Error("One or more post-submit assertions failed; review saved evidence before any further action.")
  console.log(JSON.stringify({ ok: true, status, apiPostCount, ui: "success", measurementRequests: measurementRequests.length, screenshot: dimensions }))
} catch (error) {
  const message = (error instanceof Error ? error.message : String(error)).split(secret).join("[REDACTED]").slice(0, 1000)
  if (attemptCreated) {
    const prior = await readFile(lock, "utf8").then(JSON.parse).catch(() => ({}))
    await writeFile(lock, JSON.stringify({ ...prior, failedAt: new Date().toISOString(), state: apiPostCount ? "request-attempted-review-required" : "failed-before-request", apiPostCount, authAttached, error: message }, null, 2) + "\n")
  }
  console.error(JSON.stringify({ ok: false, apiPostCount, error: message }))
  process.exitCode = 1
} finally {
  await browser?.close()
}
