import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "playwright"
import AxeBuilder from "@axe-core/playwright"

const phase = String(process.argv[2] || "").toUpperCase()
if (!["P01", "P02", "P03"].includes(phase)) {
  console.error("Usage: node docs/polish/evidence/verify-local-fixes.mjs P01|P02|P03")
  process.exit(2)
}

const base = "http://127.0.0.1:3041"
const evidenceDir = resolve("docs/polish/evidence")
const jsonPath = resolve(evidenceDir, `verify-local-${phase}.json`)
const screenshotPath = resolve(evidenceDir, `verify-local-${phase}.png`)
const verifyQuery = "utm_source=internal-verify&utm_medium=e2e"
const serviceSlugs = [
  "mobile-welding",
  "trailer-welding-repair",
  "equipment-repair",
  "architectural-welding",
  "custom-fabrication",
  "custom-metal-products",
]
const nonHomeRoutes = [
  "/service-areas",
  "/privacy",
  "/terms",
  ...serviceSlugs.map(slug => `/services/${slug}`),
  "/__local-verification-404__",
]
const allPublicRoutes = ["/", ...nonHomeRoutes]

function verifiedUrl(path) {
  return `${base}${path}${path.includes("?") ? "&" : "?"}${verifyQuery}`
}

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

async function waitForServer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let last = "no response"
  while (Date.now() < deadline) {
    try {
      const response = await fetch(verifiedUrl("/"), { method: "GET" })
      last = `HTTP ${response.status}`
      if (response.status < 500) return
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(1_000)
  }
  throw new Error(`Local server was not ready within ${timeoutMs / 1000}s (${last}).`)
}

function rgb(value) {
  const match = String(value).match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i)
  if (!match) return null
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) }
}

function luminance(color) {
  const channel = value => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function contrast(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const evidence = {
  phase,
  target: base,
  startedAt: new Date().toISOString(),
  requestPolicy: "GET and HEAD only; every other method aborted by Playwright routing",
  assertions: [],
  failures: [],
  blockedRequests: [],
  pageErrors: [],
  results: {},
  screenshot: screenshotPath.split(/[\\/]/).pop(),
}

function check(condition, name, detail = undefined) {
  const passed = Boolean(condition)
  evidence.assertions.push({ name, passed, ...(detail === undefined ? {} : { detail }) })
  if (!passed) evidence.failures.push(name)
  return passed
}

let browser
let page
let screenshotSaved = false
try {
  await waitForServer()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  })
  await context.route("**/*", async route => {
    const method = route.request().method().toUpperCase()
    if (method === "GET" || method === "HEAD") return route.continue()
    const parsed = new URL(route.request().url())
    evidence.blockedRequests.push({ method, origin: parsed.origin, path: parsed.pathname })
    return route.abort("blockedbyclient")
  })
  page = await context.newPage()
  page.on("pageerror", error => evidence.pageErrors.push(error.message.slice(0, 500)))

  async function goto(path) {
    const response = await page.goto(verifiedUrl(path), { waitUntil: "domcontentloaded", timeout: 45_000 })
    await page.locator("body").waitFor({ state: "visible", timeout: 15_000 })
    return response?.status() ?? 0
  }

  async function revealQuickActions() {
    const bar = page.locator(".ms-mobile-cta")
    await bar.waitFor({ state: "attached", timeout: 15_000 })
    const trigger = page.locator(".ms-hero-actions").first()
    if (await trigger.count()) {
      await page.evaluate(() => {
        const element = document.querySelector(".ms-hero-actions")
        if (!element) return
        window.scrollTo(0, Math.ceil(window.scrollY + element.getBoundingClientRect().bottom + 2))
        window.dispatchEvent(new Event("scroll"))
      })
    }
    await page.waitForFunction(() => document.querySelector(".ms-mobile-cta")?.classList.contains("is-visible"), undefined, { timeout: 10_000 })
    await page.waitForTimeout(80)
    return bar
  }

  if (phase === "P01") {
    const mobile = []
    for (const path of allPublicRoutes) {
      await page.setViewportSize({ width: 390, height: 844 })
      const status = await goto(path)
      const bar = await revealQuickActions()
      const state = await bar.evaluate(element => {
        const box = element.getBoundingClientRect()
        const links = [...element.querySelectorAll("a")]
        const call = getComputedStyle(links[0])
        const quote = getComputedStyle(links[1])
        return {
          className: element.className,
          ariaHidden: element.getAttribute("aria-hidden"),
          inert: element.hasAttribute("inert"),
          box: { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom },
          call: { backgroundImage: call.backgroundImage, backgroundColor: call.backgroundColor, color: call.color },
          quote: { backgroundImage: quote.backgroundImage, backgroundColor: quote.backgroundColor, color: quote.color },
        }
      })
      const quoteBg = rgb(state.quote.backgroundColor)
      const quoteText = rgb(state.quote.color)
      const quoteContrast = quoteBg && quoteText ? contrast(quoteText, quoteBg) : 0
      const callGradientOpaque = state.call.backgroundImage.includes("gradient")
        && !state.call.backgroundImage.includes("transparent")
        && !state.call.backgroundImage.includes("rgba(0, 0, 0, 0)")
      const axe = await new AxeBuilder({ page }).include(".ms-mobile-cta").analyze()
      const row = {
        path,
        status,
        ...state,
        quoteBackgroundLuminance: quoteBg ? luminance(quoteBg) : null,
        quoteTextLuminance: quoteText ? luminance(quoteText) : null,
        quoteContrast,
        callGradientOpaque,
        axeViolations: axe.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) })),
      }
      mobile.push(row)
      const expectedStatus = path === "/__local-verification-404__" ? 404 : 200
      check(status === expectedStatus, `P01 ${path} returns expected HTTP ${expectedStatus}`, { status })
      check(state.ariaHidden === "false" && !state.inert && state.box.height > 0 && state.box.y < 844 && state.box.bottom <= 845, `P01 ${path} quick actions are actually visible`, state)
      check(Boolean(quoteBg && quoteBg.a === 1 && luminance(quoteBg) < 0.5), `P01 ${path} Quote background resolves to an opaque dark color`, { backgroundColor: state.quote.backgroundColor, luminance: quoteBg ? luminance(quoteBg) : null })
      check(Boolean(quoteText && quoteText.a > 0 && luminance(quoteText) >= 0.5), `P01 ${path} Quote text resolves to a light color`, { color: state.quote.color, luminance: quoteText ? luminance(quoteText) : null })
      check(quoteContrast >= 4.5, `P01 ${path} Quote text contrast is at least 4.5:1`, { quoteContrast, quote: state.quote })
      check(callGradientOpaque, `P01 ${path} Call background resolves to a nontransparent gradient`, state.call)
      check(axe.violations.length === 0, `P01 ${path} quick actions have no axe violations`, row.axeViolations)
      if (path === "/privacy") {
        await page.screenshot({ path: screenshotPath })
        screenshotSaved = true
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    const desktop = []
    for (const path of allPublicRoutes) {
      const status = await goto(path)
      const dimensions = await page.evaluate(() => ({
        innerWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
      }))
      const maxWidth = Math.max(dimensions.documentScrollWidth, dimensions.bodyScrollWidth)
      desktop.push({ path, status, ...dimensions, overflowPixels: maxWidth - dimensions.documentClientWidth })
      check(maxWidth <= dimensions.documentClientWidth + 1, `P01 ${path} has no horizontal overflow at 1440`, dimensions)
    }
    evidence.results = { routeCount: allPublicRoutes.length, nonHomeRouteCount: nonHomeRoutes.length, screenshotRoute: "/privacy", mobile, desktop }
  }

  if (phase === "P02") {
    const desktopScreenshotPath = resolve(evidenceDir, "verify-local-P02-desktop.png")

    async function collectCityTargets({ hitTest }) {
      const links = page.locator(".ms-area-cities > div > a.ms-display")
      const count = await links.count()
      const targets = []
      for (let index = 0; index < count; index += 1) {
        const link = links.nth(index)
        if (hitTest) {
          await link.scrollIntoViewIfNeeded()
          await page.waitForTimeout(40)
        }
        targets.push(await link.evaluate((anchor, input) => {
          const box = anchor.getBoundingClientRect()
          const style = getComputedStyle(anchor)
          const points = [
            { x: box.left + 3, y: box.top + box.height / 2 },
            { x: box.right - 3, y: box.top + box.height / 2 },
            { x: box.left + box.width / 2, y: box.top + 3 },
            { x: box.left + box.width / 2, y: box.bottom - 3 },
          ]
          const hits = input.hitTest ? points.map(point => {
            const hit = document.elementFromPoint(point.x, point.y)
            return Boolean(hit && (hit === anchor || hit.closest("a") === anchor))
          }) : []
          return {
            index: input.index,
            text: anchor.textContent.trim(),
            href: anchor.getAttribute("href"),
            anchor: { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom },
            style: {
              display: style.display,
              minHeight: style.minHeight,
              padding: style.padding,
              borderWidth: style.borderWidth,
              backgroundColor: style.backgroundColor,
              color: style.color,
              boxShadow: style.boxShadow,
              fontSize: style.fontSize,
              textDecorationLine: style.textDecorationLine,
              transform: style.transform,
            },
            paddedEdgeHitsAnchor: input.hitTest ? hits.every(Boolean) : null,
            edgeHitResults: hits,
          }
        }, { index, hitTest }))
      }
      return { count, targets }
    }

    await page.setViewportSize({ width: 390, height: 844 })
    const mobileStatus = await goto("/service-areas")
    const mobile = await collectCityTargets({ hitTest: true })
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      window.scrollTo(0, 0)
    })
    const firstCity = page.locator(".ms-area-cities > div > a.ms-display").first()
    let tabsUsed = 0
    let focusedByKeyboard = false
    for (; tabsUsed < 40; tabsUsed += 1) {
      await page.keyboard.press("Tab")
      focusedByKeyboard = await firstCity.evaluate(anchor => document.activeElement === anchor)
      if (focusedByKeyboard) break
    }
    const focusState = await firstCity.evaluate(anchor => {
      const box = anchor.getBoundingClientRect()
      const style = getComputedStyle(anchor)
      return {
        active: document.activeElement === anchor,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
        outlineColor: style.outlineColor,
      }
    })
    await page.screenshot({ path: screenshotPath })
    screenshotSaved = true

    const expectedPath = "/services/mobile-welding"
    const expectedHash = "#service"
    await page.keyboard.press("Enter")
    await page.waitForURL(current => current.pathname === expectedPath && current.hash === expectedHash, { timeout: 20_000 })
    const enterDestination = await page.evaluate(() => ({ pathname: location.pathname, hash: location.hash, href: location.href }))

    await page.setViewportSize({ width: 1440, height: 900 })
    const desktopStatus = await goto("/service-areas")
    await page.locator(".ms-area-cities").scrollIntoViewIfNeeded()
    const desktop = await collectCityTargets({ hitTest: false })
    const desktopOverflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }))
    await page.screenshot({ path: desktopScreenshotPath })

    evidence.screenshots = [screenshotPath, desktopScreenshotPath].map(item => item.split(/[\\/]/).pop())
    evidence.results = {
      mobile: { status: mobileStatus, ...mobile, keyboard: { tabsUsed: tabsUsed + 1, focusedByKeyboard, focusState, enterDestination } },
      desktop: { status: desktopStatus, ...desktop, overflow: desktopOverflow },
    }

    check(mobileStatus === 200, "P02 service-areas returns HTTP 200 at 390", { status: mobileStatus })
    check(mobile.count === 8, "P02 finds all eight direct city anchors at 390", { count: mobile.count })
    for (const target of mobile.targets) {
      check(target.anchor.width >= 44 && target.anchor.height >= 44, `P02 mobile ${target.text} anchor target is at least 44x44`, target.anchor)
      check(target.href === "/services/mobile-welding#service", `P02 mobile ${target.text} keeps the existing destination`, { href: target.href })
      check(target.paddedEdgeHitsAnchor, `P02 mobile ${target.text} padded edges are part of the anchor hit area`, target)
    }
    check(focusedByKeyboard && focusState.active && focusState.outlineStyle !== "none" && parseFloat(focusState.outlineWidth) >= 2, "P02 keyboard focus visibly surrounds the full first city tile", focusState)
    check(enterDestination.pathname === expectedPath && enterDestination.hash === expectedHash, "P02 Enter activates the unchanged city destination", enterDestination)

    check(desktopStatus === 200, "P02 service-areas returns HTTP 200 at 1440", { status: desktopStatus })
    check(desktop.count === 8, "P02 finds all eight direct city anchors at 1440", { count: desktop.count })
    for (const target of desktop.targets) {
      check(target.anchor.width >= 44 && target.anchor.height >= 44, `P02 desktop ${target.text} anchor geometry remains at least 44x44`, target.anchor)
      check(target.href === "/services/mobile-welding#service", `P02 desktop ${target.text} keeps the existing destination`, { href: target.href })
      check(target.style.display === "inline-flex" && target.style.textDecorationLine === "none" && target.style.backgroundColor !== "rgba(0, 0, 0, 0)" && target.style.boxShadow !== "none", `P02 desktop ${target.text} retains tile presentation`, target.style)
    }
    const desktopMaxWidth = Math.max(desktopOverflow.documentScrollWidth, desktopOverflow.bodyScrollWidth)
    check(desktopMaxWidth <= desktopOverflow.clientWidth + 1, "P02 service-areas has no horizontal overflow at 1440", desktopOverflow)
  }
  if (phase === "P03") {
    await page.setViewportSize({ width: 390, height: 844 })
    const status = await goto("/")
    const details = page.locator(".ms-menu")
    const summary = details.locator("summary")
    const firstLink = details.locator(".ms-menu-panel a").first()
    await page.waitForFunction(() => {
      const element = document.querySelector(".ms-menu")
      return Boolean(element && Object.keys(element).some(key => key.startsWith("__reactFiber$") || key.startsWith("__reactProps$")))
    }, undefined, { timeout: 15_000 })
    const hydrationReady = true
    await summary.focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.querySelector(".ms-menu")?.open === true, undefined, { timeout: 2_000 })
    const openedWithEnter = await details.evaluate(element => element.open)
    await page.keyboard.press("Tab")
    const tabReachedLink = await firstLink.evaluate(element => document.activeElement === element)
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => {
      const menu = document.querySelector(".ms-menu")
      const trigger = menu?.querySelector("summary")
      return Boolean(menu && !menu.open && document.activeElement === trigger)
    }, undefined, { timeout: 2_000 })
    const closedWithEscape = !(await details.evaluate(element => element.open))
    const focusReturned = await summary.evaluate(element => document.activeElement === element)
    await page.screenshot({ path: screenshotPath })
    screenshotSaved = true

    const navLink = details.locator('.ms-menu-panel a[href="#services"]')
    const hrefBefore = await navLink.getAttribute("href")
    await summary.click()
    await page.waitForFunction(() => document.querySelector(".ms-menu")?.open === true, undefined, { timeout: 2_000 })
    await navLink.click()
    await page.waitForFunction(() => location.hash === "#services" && document.querySelector(".ms-menu")?.open === false, undefined, { timeout: 2_000 })
    const linkClosedMenu = !(await details.evaluate(element => element.open))
    const hashAfter = await page.evaluate(() => location.hash)
    const hrefAfter = await navLink.getAttribute("href")

    const postCountBefore = evidence.blockedRequests.filter(item => item.method === "POST").length
    await page.locator("#contact").scrollIntoViewIfNeeded()
    await page.getByRole("button", { name: "Send the job" }).click()
    await page.waitForFunction(() => Boolean(document.querySelector("#quote-name")?.validationMessage) && document.activeElement?.id === "quote-name", undefined, { timeout: 2_000 })
    const emptyForm = await page.evaluate(() => {
      const first = document.querySelector("#quote-name")
      return { activeId: document.activeElement?.id || "", validationMessage: first?.validationMessage || "" }
    })
    const postCountAfter = evidence.blockedRequests.filter(item => item.method === "POST").length

    const faq = page.locator(".ms-faq-list details").first()
    const faqSummary = faq.locator("summary")
    const faqAnswer = faq.locator("p")
    await faqSummary.scrollIntoViewIfNeeded()
    await faqSummary.click()
    const faqOpened = await faq.evaluate(element => element.open)
    const answerVisible = await faqAnswer.isVisible()
    await faqSummary.click()
    const faqClosed = !(await faq.evaluate(element => element.open))
    const answerHidden = !(await faqAnswer.isVisible())

    evidence.results = {
      status,
      disclosure: { hydrationReady, openedWithEnter, tabReachedLink, closedWithEscape, focusReturned },
      navLink: { hrefBefore, hrefAfter, hashAfter, linkClosedMenu },
      emptyForm: { ...emptyForm, postCountBefore, postCountAfter },
      faq: { faqOpened, answerVisible, faqClosed, answerHidden },
    }
    check(status === 200, "P03 home returns HTTP 200", { status })
    check(hydrationReady, "P03 client hydration is attached before keyboard interaction")
    check(openedWithEnter, "P03 Enter opens the native details menu")
    check(tabReachedLink, "P03 Tab moves from summary to the first navigation link")
    check(closedWithEscape, "P03 Escape closes the open menu")
    check(focusReturned, "P03 Escape returns focus to the summary")
    check(hrefBefore === "#services" && hrefAfter === "#services" && hashAfter === "#services" && linkClosedMenu, "P03 nav-link href and click-close behavior remain unchanged", evidence.results.navLink)
    check(postCountAfter === postCountBefore && emptyForm.activeId === "quote-name" && Boolean(emptyForm.validationMessage), "P03 empty form stays local, makes no POST, and focuses the first required field", evidence.results.emptyForm)
    check(faqOpened && answerVisible && faqClosed && answerHidden, "P03 FAQ disclosure still opens and closes", evidence.results.faq)
  }

  check(evidence.pageErrors.length === 0, `${phase} has no page errors`, evidence.pageErrors)
  check(evidence.blockedRequests.length === 0, `${phase} attempted no mutating requests`, evidence.blockedRequests)
} catch (error) {
  evidence.failures.push(`Runner error: ${error instanceof Error ? error.message : String(error)}`)
  if (page && !screenshotSaved) {
    await page.screenshot({ path: screenshotPath }).then(() => { screenshotSaved = true }).catch(() => undefined)
  }
} finally {
  evidence.completedAt = new Date().toISOString()
  evidence.pass = evidence.failures.length === 0
  evidence.screenshotSaved = screenshotSaved
  await writeFile(jsonPath, JSON.stringify(evidence, null, 2) + "\n", "utf8")
  await browser?.close()
}

console.log(JSON.stringify({ phase, pass: evidence.pass, assertionCount: evidence.assertions.length, failures: evidence.failures, json: jsonPath, screenshot: screenshotSaved ? screenshotPath : null }))
if (!evidence.pass) process.exitCode = 1





