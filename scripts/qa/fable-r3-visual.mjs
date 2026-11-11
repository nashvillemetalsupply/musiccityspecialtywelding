// Local production UI evidence. Never submit a form or contact a provider.
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"

const origin = process.argv[2] ?? "http://localhost:3100"
const url = new URL(origin)
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:")
assert.equal(url.origin, origin)
const directory = "docs/design-shots"
mkdirSync(directory, { recursive: true })
const services = [...readFileSync("lib/service-pages.ts", "utf8").matchAll(/slug:\s*"([^"]+)"/g)].map(match => [match[1], `/services/${match[1]}`])
const routes = [["home", "/"], ["service-areas", "/service-areas"], ...services, ["privacy", "/privacy"], ["terms", "/terms"], ["404", "/fable-local-missing-page"]]
assert.equal(routes.length, 12)
const results = { origin, delivery: "All non-GET/HEAD requests and all remote requests blocked; no chat messages sent.", captures: [], geometry: [], scrollChecks: [], responsive: [] }
const save = () => writeFileSync(`${directory}/fable-r3-metrics.json`, JSON.stringify(results, null, 2) + "\n")
const browser = await chromium.launch({ channel: "chrome", headless: true })
async function open(route, viewport) {
  console.log(JSON.stringify({ stage: "opening", route, viewport }))
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" })
  page.setDefaultTimeout(20_000)
  const errors = [], blockedSubmissions = [], requests = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("request", request => requests.push(request.url()))
  await page.route("**/*", request => {
    if (!["GET", "HEAD"].includes(request.request().method())) {
      blockedSubmissions.push({ method: request.request().method(), url: request.request().url() })
      return request.abort()
    }
    return new URL(request.request().url()).origin === origin ? request.continue() : request.abort()
  })
  const response = await page.goto(origin + route, { waitUntil: "networkidle", timeout: 60_000 })
  assert.equal(response.status(), route.includes("missing-page") ? 404 : 200)
  // Make evidence scrolling deterministic; smooth scrolling can race a
  // full-page capture and leave sticky-header pixels at the old scroll offset.
  await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" })
  console.log(JSON.stringify({ stage: "loaded", route, viewport }))
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("font readiness exceeded 15s")), 15_000))]))
  return { page, errors, blockedSubmissions, requests }
}
async function scrollRender(page) {
  for (const section of await page.locator("main section").all()) {
    await section.scrollIntoViewIfNeeded()
    for (const figure of await section.locator(".ms-work-shot").all()) {
      await figure.scrollIntoViewIfNeeded()
      await figure.locator("img").waitFor({ state: "visible" })
      await figure.locator("img").evaluate(img => img.decode())
    }
  }
  for (const image of await page.locator("img").all()) {
    if (!await image.isVisible()) continue
    await image.scrollIntoViewIfNeeded()
    await image.evaluate(img => Promise.race([img.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error(`image decode exceeded 15s: ${img.src}`)), 15_000))]))
  }
  if (await page.locator("#contact").count()) await page.locator("form.ms-quote-form").waitFor({ state: "attached" })
  await page.locator(".ms-footer").scrollIntoViewIfNeeded()
}
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const [slug, route] of routes) {
      const { page, errors, blockedSubmissions, requests } = await open(route, viewport)
      await scrollRender(page)
      console.log(JSON.stringify({ stage: "scroll-rendered", route, viewport }))
      // Reveal only already-scroll-verified deferred content for full-page rasterization.
      await page.addStyleTag({ content: ".ms-home *, .ms-subpage[data-service] > * { content-visibility: visible !important; }" })
      await page.evaluate(async () => {
        // Browser lazy loading does not scroll during full-page rasterization.
        // All visible proof was scrolled above; eagerly finish hidden duplicates.
        for (const img of document.images) img.loading = "eager"
        await Promise.race([Promise.all([...document.images].map(img => img.decode())), new Promise((_, reject) => setTimeout(() => reject(new Error(`full-page image decode exceeded 15s: ${[...document.images].filter(img => !img.complete).map(img => img.src).join(", ")}`)), 15_000))])
        window.scrollTo({ top: 0, left: 0, behavior: "instant" })
      })
      await page.waitForFunction(() => scrollY === 0)
      await page.waitForTimeout(80)
      const base = `${directory}/fable-r3-${slug}-${viewport.width}x${viewport.height}`
      await page.screenshot({ path: `${base}-fold.png`, animations: "disabled" })
      await page.screenshot({ path: `${base}.png`, fullPage: true, animations: "disabled", style: ".ms-nav { position: relative !important; top: 0 !important; }" })
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        missingImages: [...document.images].filter(img => !img.complete || !img.naturalWidth).map(img => img.src),
        undersizedMono: [...document.querySelectorAll(".ms-site *")].filter(el => el.textContent.trim() && getComputedStyle(el).fontFamily.includes("Plex Mono") && parseFloat(getComputedStyle(el).fontSize) < 12).map(el => el.textContent.trim().slice(0, 60)),
      }))
      assert.equal(metrics.overflow, false, `${route} ${viewport.width}: no overflow`)
      assert.deepEqual(metrics.missingImages, [])
      assert.deepEqual(metrics.undersizedMono, [])
      // A full-page capture perturbs Chromium's sticky compositor. Restore a
      // fresh normal viewport before recording interactive menu/chat states.
      await page.reload({ waitUntil: "networkidle" })
      await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" })
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }))
      await page.waitForTimeout(80)
      if (viewport.width === 390) {
        await page.locator(".ms-menu summary").click()
        await page.screenshot({ path: `${base}-menu.png`, animations: "disabled" })
        const before = await page.evaluate(() => scrollY)
        await page.mouse.move(180, 500)
        await page.mouse.wheel(0, 600)
        await page.waitForTimeout(100)
        assert.equal(await page.evaluate(() => scrollY), before, `${route}: open menu locks document scroll`)
        await page.keyboard.press("Escape")
        assert.equal(await page.locator(".ms-menu").evaluate(menu => menu.open), false)
      }
      const heroAsk = page.locator(".ms-hero-actions button").first()
      const opener = viewport.width < 980
        ? await heroAsk.count() ? heroAsk : page.locator(".ms-mobile-cta button")
        : page.locator('aside[aria-label="Contact the welding shop"] button')
      await opener.click()
      await page.locator("#shop-assistant-message").waitFor({ state: "visible" })
      assert.equal(await page.locator("#shop-assistant-message").evaluate(el => el === document.activeElement), true)
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }))
      await page.waitForTimeout(80)
      await page.screenshot({ path: `${base}-chat.png`, animations: "disabled" })
      await page.keyboard.press("Escape")
      assert.equal(await page.locator("dialog[open]").count(), 0)
      assert.deepEqual(errors, [], `${route}: no browser errors`)
      assert.deepEqual(blockedSubmissions, [], `${route}: no attempted sends`)
      const unwantedHomePrefetch = route.startsWith("/services/") ? requests.filter(request => {
        const url = new URL(request)
        return url.pathname === "/" && url.searchParams.has("_rsc") || request.includes("welder-1600")
      }) : []
      assert.deepEqual(unwantedHomePrefetch, [], `${route}: no home RSC or hero prefetch`)
      results.captures.push({ route, viewport, screenshot: `${base}.png`, fold: `${base}-fold.png`, menu: viewport.width === 390 ? `${base}-menu.png` : null, chat: `${base}-chat.png`, ...metrics, errors, blockedSubmissions, unwantedHomePrefetch })
      save()
      console.log(JSON.stringify({ route, viewport, captured: true }))
      await page.close()
    }
  }
  // Measure glyph-bearing outer content edges. The FAQ card intentionally has
  // its own cream-card interior inset, shared with home.
  for (const [slug, route] of [["home", "/"], ...services]) {
    const { page } = await open(route, { width: 1440, height: 900 })
    await scrollRender(page)
    const selectors = slug === "home" ? [".ms-brand", ".ms-hero-copy", ".ms-services-heading", ".ms-job-glass-copy", ".ms-faq-heading", ".ms-contact-lead", ".ms-footer-mark"] : [".ms-brand", ".ms-breadcrumb", ".ms-subhero-copy", ".ms-subscope > div", ".ms-subplan-lead", ".ms-subglass", ".ms-faq-heading", ".ms-otherwork", ".ms-contact-lead", ".ms-footer-mark"]
    const edges = await page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
      const el = document.querySelector(selector)
      if (!el) return [selector, null]
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el)
      const padded = [".ms-breadcrumb", ".ms-subglass", ".ms-otherwork"].includes(selector)
      return [selector, rect.x + (padded ? parseFloat(style.paddingLeft) : 0)]
    })), selectors)
    for (const [selector, x] of Object.entries(edges)) assert.ok(x !== null && Math.abs(x - 112) < 1, `${route} ${selector}: expected shared x112; got ${x}`)
    const navCallRight = await page.locator(".ms-nav-call").evaluate(el => el.getBoundingClientRect().right)
    assert.ok(Math.abs(navCallRight - 1328) < 1, `${route}: navigation call ends at x1328`)
    results.geometry.push({ route, viewport: { width: 1440, height: 900 }, contentEdge: 112, edges, navCallRight })
    save()
    await page.close()
  }
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    for (const route of ["/", "/services/mobile-welding", "/service-areas"]) {
      const { page } = await open(route, viewport)
      await scrollRender(page)
      await page.evaluate(() => window.scrollTo(0, 0))
      if (route === "/services/mobile-welding") {
        await page.locator('aside[aria-label="Contact the welding shop"] button').click()
        await page.locator("#shop-assistant-message").waitFor({ state: "visible" })
        await page.keyboard.press("Escape")
      }
      const height = await page.evaluate(() => document.documentElement.scrollHeight)
      let samples = 0, formHiddenSamples = 0
      const collisions = []
      for (let y = 0; y <= height; y += 120) {
        await page.evaluate(y => window.scrollTo(0, y), y)
        await page.waitForTimeout(40)
        const sample = await page.evaluate(() => {
          const launcher = document.querySelector('aside[aria-label="Contact the welding shop"]')
          const a = launcher.getBoundingClientRect(), style = getComputedStyle(launcher)
          const visible = style.display !== "none" && style.opacity !== "0" && style.pointerEvents !== "none"
          const form = document.querySelector("form.ms-quote-form")?.getBoundingClientRect()
          const formInView = Boolean(form && form.bottom > 0 && form.top < innerHeight)
          const hits = visible ? [...document.querySelectorAll(".ms-subglass a, .ms-submit, .ms-faq summary, .ms-footer a")].filter(el => {
            const b = el.getBoundingClientRect()
            return b.width && b.height && Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)
          }).map(el => ({ text: el.textContent.trim().slice(0, 80), y: scrollY })) : []
          return { visible, formInView, hits }
        })
        if (sample.formInView) {
          assert.equal(sample.visible, false, `${route} ${viewport.width}: launcher hidden while form visible`)
          formHiddenSamples++
        }
        collisions.push(...sample.hits)
        samples++
      }
      assert.deepEqual(collisions, [], `${route} ${viewport.width}: no launcher/control intersections during scroll`)
      if (route !== "/service-areas") assert.ok(formHiddenSamples > 0)
      results.scrollChecks.push({ route, viewport, loadedChat: route === "/services/mobile-welding", samples, formHiddenSamples, collisions })
      save()
      await page.close()
    }
  }
  for (const width of [320, 768, 1024]) {
    for (const route of ["/", "/services/mobile-welding", "/privacy", "/terms"]) {
      const { page, errors } = await open(route, { width, height: 900 })
      await scrollRender(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      assert.equal(overflow, false, `${route} ${width}: no overflow`)
      assert.deepEqual(errors, [])
      const emailDomain = await page.locator('.ms-legal-contact a[href^="mailto:"]').count() ? await page.locator('.ms-legal-contact a[href^="mailto:"]').evaluate(link => {
        const range = document.createRange()
        range.selectNode(link.lastChild)
        return { domain: link.lastChild.textContent, lines: range.getClientRects().length, rectangles: [...range.getClientRects()].map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })) }
      }) : null
      if (emailDomain) assert.equal(emailDomain.lines, 1, `${route} ${width}: complete email domain stays on one line`)
      results.responsive.push({ route, width, overflow, errors, emailDomain })
      await page.close()
    }
  }
  results.passed = true
  save()
} finally { await browser.close() }
