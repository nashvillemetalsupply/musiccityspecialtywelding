// Local screenshots only: no provider requests, API submissions, or form sends.
import { chromium } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"
import assert from "node:assert/strict"
import { parseArgs } from "node:util"

const { values } = parseArgs({ options: {
  help: { type: "boolean", default: false },
  label: { type: "string", default: "after" },
  origin: { type: "string", default: "http://localhost:3100" },
} })
if (values.help) {
  console.log("node scripts/qa/fable-r2-visual.mjs --label=before|after --origin=http://localhost:3100")
  process.exit(0)
}
assert.match(values.label, /^[a-z0-9-]+$/)
const url = new URL(values.origin)
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol === "http:", "visual checks must stay local")
assert.equal(url.pathname, "/")
assert.ok(!url.username && !url.password && !url.search && !url.hash)
const origin = url.origin
const directory = "docs/design-shots"
mkdirSync(directory, { recursive: true })
console.log(JSON.stringify({ stage: "launching-browser", origin, label: values.label }))
const browser = await chromium.launch({ channel: "chrome", headless: true })
console.log(JSON.stringify({ stage: "browser-launched" }))
const results = []
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const [slug, route] of [["home", "/"], ["mobile-welding", "/services/mobile-welding"]]) {
      console.log(JSON.stringify({ stage: "opening-page", route, viewport }))
      const page = await browser.newPage({ viewport })
      page.setDefaultTimeout(15_000)
      const errors = [], consoleErrors = [], blockedSubmissions = []
      page.on("pageerror", error => errors.push(error.message))
      page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()) })
      await page.route("**/*", request => {
        if (!["GET", "HEAD"].includes(request.request().method())) {
          blockedSubmissions.push({ method: request.request().method(), url: request.request().url() })
          return request.abort()
        }
        return new URL(request.request().url()).origin === origin ? request.continue() : request.abort()
      })
      console.log(JSON.stringify({ stage: "navigating", route, viewport }))
      const response = await page.goto(origin + route, { waitUntil: "domcontentloaded", timeout: 45_000 })
      assert.equal(response.status(), 200, `${route}: healthy local response`)
      console.log(JSON.stringify({ stage: "loaded", route, viewport }))
      await page.locator("#shop-assistant").waitFor({ state: "attached", timeout: 5000 })
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("font loading exceeded 15s")), 15_000))]))
      for (const section of await page.locator("main section").all()) {
        await section.scrollIntoViewIfNeeded()
        for (const figure of await section.locator(".ms-work-shot").all()) {
          await figure.scrollIntoViewIfNeeded()
          await figure.locator("img").evaluate(img => Promise.race([img.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error(`image decode exceeded 15s: ${img.currentSrc || img.src}`)), 15_000))]))
        }
      }
      console.log(JSON.stringify({ stage: "sections-scrolled", route, viewport }))
      // Service-row and process photos are lazy images outside the proof wall.
      // Trigger every image before waiting for full-page screenshot readiness.
      for (const image of await page.locator("img").all()) {
        if (!await image.isVisible()) continue
        await image.scrollIntoViewIfNeeded()
        await image.evaluate(img => Promise.race([img.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error(`image decode exceeded 15s: ${img.currentSrc || img.src}`)), 15_000))]))
      }
      console.log(JSON.stringify({ stage: "images-decoded", route, viewport }))
      if (await page.locator("#contact").count()) await page.locator("form.ms-quote-form").waitFor({ state: "attached" })
      await page.locator(".ms-footer").scrollIntoViewIfNeeded()
      // Full-page screenshots rasterize without scrolling. Scroll-verify first,
      // then show those same deferred sections for this screenshot only.
      await page.addStyleTag({ content: ".ms-home *, .ms-subpage[data-service] > * { content-visibility: visible !important; }" })
      await page.evaluate(() => Promise.race([Promise.all([...document.images].map(img => img.decode().catch(() => {}))), new Promise((_, reject) => setTimeout(() => reject(new Error("full-page image decode exceeded 15s")), 15_000))]))
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("font loading exceeded 15s")), 15_000))]))
      await page.evaluate(() => window.scrollTo(0, 0))
      const base = `${directory}/fable-r2-${values.label}-${slug}-${viewport.width}x${viewport.height}`
      await page.screenshot({ path: `${base}.png`, fullPage: true, animations: "disabled" })
      await page.screenshot({ path: `${base}-fold.png`, animations: "disabled" })
      const metrics = await page.evaluate(() => {
        const round = number => Math.round(number * 100) / 100
        const box = element => {
          const { x, y, width, height } = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return { tag: element.tagName, text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 90), x: round(x), y: round(y), width: round(width), height: round(height), font: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color }
        }
        const style = selector => { const el = document.querySelector(selector); return el && getComputedStyle(el) }
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          scrollHeight: document.documentElement.scrollHeight,
          bodyFont: style(".ms-hero-deck, .ms-subhero-copy p")?.fontFamily,
          labelFont: style(".ms-brand-words span")?.fontFamily,
          labelSize: style(".ms-brand-words span")?.fontSize,
          carbon: getComputedStyle(document.documentElement).getPropertyValue("--ms-carbon").trim(),
          fonts: [...document.fonts].filter(font => font.status === "loaded").map(font => ({ family: font.family, weight: font.weight, status: font.status })),
          missingImages: [...document.images].filter(img => !img.complete || !img.naturalWidth).map(img => img.src),
          images: [...document.images].map(img => ({ alt: img.alt, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, x: round(img.getBoundingClientRect().x), y: round(img.getBoundingClientRect().y), width: round(img.getBoundingClientRect().width), height: round(img.getBoundingClientRect().height) })),
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
          geometry: [...document.querySelectorAll(".ms-site h1, .ms-site h2, .ms-site h3, .ms-site main p, .ms-footer-mark, .ms-services-heading, .ms-faq-heading, .ms-submit, .ms-text-consent, .ms-quote-form")].map(box),
          checkboxWidth: document.querySelector(".ms-text-consent input")?.getBoundingClientRect().width,
          selectAppearance: style("#quote-service")?.appearance,
        }
      })
      assert.equal(metrics.overflow, false, `${route}: no horizontal overflow`)
      assert.deepEqual(metrics.missingImages, [], `${route}: displayed photos load`)
      assert.deepEqual(metrics.undersizedMono, [], `${route}: mono labels meet 12px floor`)
      assert.deepEqual(errors, [], `${route}: no browser exceptions`)
      assert.deepEqual(blockedSubmissions, [], `${route}: zero API submissions`)
      results.push({ route, viewport, fullScreenshot: `${base}.png`, foldScreenshot: `${base}-fold.png`, ...metrics, pageErrors: errors, consoleErrors, blockedSubmissions })
      writeFileSync(`${directory}/fable-r2-${values.label}-metrics.json`, JSON.stringify({ origin, label: values.label, remoteRequests: "blocked for local visual QA only", results }, null, 2) + "\n")
      console.log(JSON.stringify({ route, viewport, screenshot: `${base}.png`, overflow: metrics.overflow, missingImages: metrics.missingImages, pageErrors: errors }))
      await page.close()
    }
  }
} finally {
  await browser.close()
}
