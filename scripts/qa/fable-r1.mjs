// Local-only visual evidence. No API submission or remote request is allowed.
import { chromium } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import assert from "node:assert/strict"

const phase = process.argv[2] ?? "after"
const origin = process.argv[3] ?? "http://localhost:3100"
assert.equal(new URL(origin).hostname, "localhost", "visual checks must stay local")
const directory = "docs/design-shots"
mkdirSync(directory, { recursive: true })
const browser = await chromium.launch({ channel: "chrome", headless: true })
const results = []
for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const [slug, route] of [["home", "/"], ["mobile-welding", "/services/mobile-welding"], ["service-areas", "/service-areas"]]) {
    const page = await browser.newPage({ viewport })
    await page.route("**/*", (request) => new URL(request.request().url()).origin === origin ? request.continue() : request.abort())
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(origin + route, { waitUntil: "networkidle", timeout: 180_000 })
    if (phase === "after") await page.locator("#shop-assistant").waitFor({ state: "attached", timeout: 5000 })
    await page.evaluate(() => document.fonts.ready)
    for (const section of await page.locator("main section").all()) {
      await section.scrollIntoViewIfNeeded()
      for (const figure of await section.locator(".ms-work-shot").all()) {
        await figure.scrollIntoViewIfNeeded()
        await figure.locator("img").waitFor({ state: "visible" })
        await figure.locator("img").evaluate(img => img.decode())
      }
    }
    if (await page.locator("#contact").count()) await page.locator("form.ms-quote-form").waitFor({ state: "attached" })
    await page.locator(".ms-footer").scrollIntoViewIfNeeded()
    // Full-page captures don't scroll the viewport while rasterizing. Render
    // previously scroll-verified content-visibility sections for the image.
    // Lighthouse uses the untouched production CSS.
    await page.addStyleTag({ content: ".ms-home *, .ms-subpage[data-service] > * { content-visibility: visible !important; }" })
    await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => {}))))
    await page.evaluate(() => window.scrollTo(0, 0))
    const base = `${directory}/fable-r1-${phase}-${slug}-${viewport.width}x${viewport.height}`
    await page.screenshot({ path: `${base}.png`, fullPage: true, animations: "disabled" })
    await page.screenshot({ path: `${base}-fold.png`, animations: "disabled" })
    const metrics = await page.evaluate(() => {
      const style = selector => { const el = document.querySelector(selector); return el && getComputedStyle(el) }
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        bodyFont: style(".ms-hero-deck, .ms-subhero-copy p, .ms-area-hero p")?.fontFamily,
        labelFont: style(".ms-brand-words span")?.fontFamily,
        labelSize: style(".ms-brand-words span")?.fontSize,
        carbon: getComputedStyle(document.documentElement).getPropertyValue("--ms-carbon").trim(),
        missingImages: [...document.images].filter(img => !img.complete || !img.naturalWidth).map(img => img.src),
        cityChips: [...document.querySelectorAll(".ms-city-list a")].map(a => a.textContent.trim()),
        undersizedMono: [...document.querySelectorAll(".ms-site *")].filter(el => el.textContent.trim() && getComputedStyle(el).fontFamily.includes("Plex Mono") && parseFloat(getComputedStyle(el).fontSize) < 12).map(el => ({ text: el.textContent.trim().slice(0, 55), size: getComputedStyle(el).fontSize })),
        edges: Object.fromEntries([".ms-section-intro", ".ms-services-heading", ".ms-process-lead", ".ms-job-glass-copy", ".ms-territory-map", ".ms-faq-heading", ".ms-contact-lead", ".ms-footer-mark"].map(selector => [selector, document.querySelector(selector)?.getBoundingClientRect().x])),
        form: {
          checkbox: document.querySelector(".ms-text-consent input")?.getBoundingClientRect().width,
          consentTarget: document.querySelector(".ms-text-consent")?.getBoundingClientRect().height,
          inlineConsent: style(".ms-text-consent a")?.display,
          inlineFallback: style(".ms-form-fallback a")?.display,
          submitWidth: document.querySelector(".ms-submit")?.getBoundingClientRect().width,
          formWidth: document.querySelector(".ms-quote-form")?.getBoundingClientRect().width,
          selectAppearance: style("#quote-service")?.appearance,
        },
      }
    })
    if (phase === "after") {
      assert.equal(metrics.overflow, false, `${route}: no horizontal overflow`)
      assert.deepEqual(metrics.missingImages, [], `${route}: all displayed photos load`)
      assert.deepEqual(metrics.undersizedMono, [], `${route}: mono labels meet the 12px floor`)
      assert.deepEqual(errors, [], `${route}: no browser errors`)
      if (metrics.form.checkbox) {
        assert.equal(metrics.form.checkbox, 20)
        assert.ok(metrics.form.consentTarget >= 44)
        assert.equal(metrics.form.inlineConsent, "inline")
        assert.equal(metrics.form.inlineFallback, "inline")
      }
    }
    if (viewport.width === 390 && slug === "home") {
      await page.locator(".ms-menu summary").click()
      await page.screenshot({ path: `${directory}/fable-r1-${phase}-menu-390x844.png`, animations: "disabled" })
      metrics.menu = await page.locator(".ms-menu-panel").boundingBox()
      await page.keyboard.press("Escape")
      metrics.menuClosesOnEscape = await page.locator(".ms-menu").evaluate(menu => !menu.open)
    }
    results.push({ route, viewport, ...metrics, errors })
    await page.close()
  }
}
if (phase === "after") {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route("**/*", request => new URL(request.request().url()).origin === origin ? request.continue() : request.abort())
  let submitted = 0
  const intakeKeys = []
  await page.route("**/api/quote", async request => {
    submitted++
    intakeKeys.push(request.request().postData().match(/name="intakeKey"\r\n\r\n([^\r]+)/)?.[1])
    await request.fulfill({ status: submitted === 1 ? 429 : 200, contentType: "application/json", body: JSON.stringify(submitted === 1 ? { error: "Please call the shop while we catch up." } : { accepted: true }) })
  })
  await page.goto(origin, { waitUntil: "networkidle" })
  await page.locator("#contact").scrollIntoViewIfNeeded()
  await page.locator(".ms-submit").click()
  assert.equal(submitted, 0, "missing required inputs must not submit")
  await page.locator("#quote-name").fill("[INTERNAL TEST] Local fixture")
  await page.locator("#quote-phone").fill("6155550199")
  await page.locator("#quote-service").selectOption({ index: 1 })
  await page.locator(".ms-text-consent").click({ position: { x: 12, y: 12 } })
  assert.equal(await page.locator(".ms-text-consent input").isChecked(), true)
  await page.locator(".ms-submit").click()
  await page.getByText("Please call the shop while we catch up.", { exact: true }).waitFor()
  await page.screenshot({ path: `${directory}/fable-r1-after-quote-error-390x844.png`, animations: "disabled" })
  await page.locator(".ms-submit").click()
  await page.getByText("Got it.", { exact: false }).waitFor()
  assert.equal(submitted, 2)
  assert.ok(intakeKeys[0] && intakeKeys[0] === intakeKeys[1], "retry must keep its submission identity")
  await page.screenshot({ path: `${directory}/fable-r1-after-quote-success-390x844.png`, animations: "disabled" })
  results.push({ quoteFixture: { submissionsIntercepted: submitted, missingInputsBlocked: true, consentLabelToggles: true, retryIdentityPreserved: true, successVisible: true, serverRequests: 0 } })
  await page.locator(".ms-mobile-cta button").click()
  await page.getByRole("dialog").waitFor()
  await page.locator("#shop-assistant-message").waitFor({ state: "visible" })
  await page.screenshot({ path: `${directory}/fable-r1-after-chat-390x844.png`, animations: "disabled" })
  await page.getByRole("button", { name: "Close shop assistant" }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('[class*="launcher"] button').click()
  await page.getByRole("dialog").waitFor()
  await page.locator("#shop-assistant-message").waitFor({ state: "visible" })
  await page.screenshot({ path: `${directory}/fable-r1-after-chat-1440x900.png`, animations: "disabled" })
  const draft = "[INTERNAL TEST] Unsent local draft"
  await page.locator("#shop-assistant-message").fill(draft)
  await page.getByRole("button", { name: "Close shop assistant" }).click()
  await page.locator('a[href="/services/mobile-welding"]').first().click()
  await page.waitForURL(`${origin}/services/mobile-welding`)
  await page.reload({ waitUntil: "networkidle" })
  await page.locator(".ms-hero-actions button").click()
  await page.locator("#shop-assistant-message").waitFor({ state: "visible" })
  assert.equal(await page.locator("#shop-assistant-message").inputValue(), draft)
  results.push({ chatDraft: { navigationAndReloadPreserved: true, sentMessages: 0 } })
  await page.close()
  for (const viewport of [{ width: 320, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport })
    await page.route("**/*", request => new URL(request.request().url()).origin === origin ? request.continue() : request.abort())
    await page.goto(origin, { waitUntil: "networkidle" })
    const collisions = []
    for (const selector of [".ms-faq summary", ".ms-footer"]) {
      for (const node of await page.locator(selector).all()) {
        await node.scrollIntoViewIfNeeded()
        collisions.push(...await page.evaluate(() => {
          const launcher = document.querySelector('[class*="launcher"]')
          if (!launcher) return []
          const a = launcher.getBoundingClientRect()
          return [...document.querySelectorAll(".ms-faq summary i, .ms-footer a")].filter(el => {
            const b = el.getBoundingClientRect()
            return b.width && b.height && Math.min(a.right,b.right)>Math.max(a.left,b.left) && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)
          }).map(el => el.textContent.trim())
        }))
      }
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.deepEqual(collisions, [], `${viewport.width}: launcher leaves links and FAQ toggles clear`)
    assert.equal(overflow, false)
    results.push({ viewport, collisions: [...new Set(collisions)], overflow })
    if (viewport.width < 980) {
      for (const section of await page.locator("main section").all()) {
        await section.scrollIntoViewIfNeeded()
        for (const figure of await section.locator(".ms-work-shot").all()) {
          await figure.scrollIntoViewIfNeeded()
          await figure.locator("img").waitFor({ state: "visible" })
          await figure.locator("img").evaluate(img => img.decode())
        }
      }
      await page.locator(".ms-footer").scrollIntoViewIfNeeded()
      await page.addStyleTag({ content: ".ms-home *, .ms-subpage[data-service] > * { content-visibility: visible !important; }" })
      await page.screenshot({ path: `${directory}/fable-r1-after-home-${viewport.width}-responsive.png`, fullPage: true, animations: "disabled" })
    }
    await page.close()
  }
  const remainingServices = [...readFileSync("lib/service-pages.ts", "utf8").matchAll(/slug:\s*"([^"]+)"/g)].map(match => `/services/${match[1]}`).filter(path => path !== "/services/mobile-welding")
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const route of [...remainingServices, "/privacy", "/terms", "/fable-local-missing-page"]) {
      const page = await browser.newPage({ viewport })
      await page.route("**/*", request => new URL(request.request().url()).origin === origin ? request.continue() : request.abort())
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      const response = await page.goto(origin + route, { waitUntil: "networkidle" })
      await page.evaluate(() => document.fonts.ready)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      assert.equal(response.status(), route === "/fable-local-missing-page" ? 404 : 200)
      assert.equal(overflow, false, `${route} at ${viewport.width}`)
      assert.deepEqual(errors, [])
      if (route === "/fable-local-missing-page") await page.screenshot({ path: `${directory}/fable-r1-after-404-${viewport.width}x${viewport.height}.png`, fullPage: true, animations: "disabled" })
      results.push({ route, viewport, status: response.status(), overflow, errors })
      await page.close()
    }
  }
}
await browser.close()
writeFileSync(`${directory}/fable-r1-${phase}-metrics.json`, JSON.stringify(results, null, 2) + "\n")
console.log(JSON.stringify(results, null, 2))
