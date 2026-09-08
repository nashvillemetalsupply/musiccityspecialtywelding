import { chromium } from "@playwright/test"
import { constants } from "node:fs"
import { copyFile, mkdir, rmdir, unlink } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Populated, write-inert board QA.
 *
 * Start the app in development mode, then run:
 *   node scripts/mobile-crm-repro.mjs
 * Add --capture to refresh the screenshots under .backups.
 *
 * The script installs scripts/qa/fixtures/mobile-crm-page.tsx.fixture as a
 * temporary Next route and removes it in finally. It refuses to overwrite an
 * existing route, blocks external requests and blocks every browser POST.
 */

const baseURL = process.env.MCSW_QA_BASE || "http://localhost:3033"
const capture = process.argv.includes("--capture") || Boolean(process.env.MCSW_CAPTURE)
const allowedOrigin = new URL(baseURL).origin
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const fixtureSource = path.join(repoRoot, "scripts", "qa", "fixtures", "mobile-crm-page.tsx.fixture")
const fixtureDir = path.join(repoRoot, "app", "board", "mobile-fixture")
const fixtureRoute = path.join(fixtureDir, "page.tsx")
const results = []
let browser
let fixtureInstalled = false

async function installFixture() {
  await mkdir(fixtureDir, { recursive: true })
  try {
    await copyFile(fixtureSource, fixtureRoute, constants.COPYFILE_EXCL)
    fixtureInstalled = true
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing fixture route: ${fixtureRoute}`)
    }
    throw error
  }
}

async function removeFixture() {
  if (!fixtureInstalled) return
  await unlink(fixtureRoute)
  try {
    await rmdir(fixtureDir)
  } catch (error) {
    if (error?.code !== "ENOTEMPTY" && error?.code !== "ENOENT") throw error
  }
}

async function newProtectedPage(options) {
  const page = await browser.newPage(options)
  const blockedRequests = []
  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const unsafeMethod = !["GET", "HEAD"].includes(request.method())
    const external = ["http:", "https:"].includes(url.protocol) && url.origin !== allowedOrigin
    if (unsafeMethod || external) {
      blockedRequests.push({ method: request.method(), url: request.url() })
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
  return { page, blockedRequests }
}

async function checkDesktop() {
  const { page, blockedRequests } = await newProtectedPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${baseURL}/board`, { waitUntil: "load", timeout: 15_000 })
  const main = page.locator(".app > main.main").last()
  await main.waitFor({ timeout: 5_000 })
  const geometry = await main.evaluate((main) => {
    const matchingRules = []
    const visit = (rules, media = "all") => {
      for (const rule of rules) {
        if (rule.cssRules) visit(rule.cssRules, rule.conditionText || media)
        if (rule.selectorText?.split(",").some((selector) => {
          try { return main.matches(selector.trim()) } catch { return false }
        }) && (rule.style.gridColumn || rule.style.gridRow || rule.style.overflowY)) {
          matchingRules.push({ media, rule: rule.cssText })
        }
      }
    }
    for (const sheet of document.styleSheets) {
      try { visit(sheet.cssRules) } catch {}
    }
    return {
      width: main.getBoundingClientRect().width,
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainGridColumn: getComputedStyle(main).gridColumn,
      mainOverflowY: getComputedStyle(main).overflowY,
      appWidth: main.parentElement?.getBoundingClientRect().width,
      appColumns: main.parentElement ? getComputedStyle(main.parentElement).gridTemplateColumns : "",
      rail: document.querySelector(".rail")?.getBoundingClientRect().toJSON(),
      matchingRules,
    }
  })
  results.push({
    check: "desktop board keeps a scannable work area",
    pass: geometry.width >= 1100 && geometry.scrollWidth <= geometry.viewport,
    geometry,
  })
  results.push({
    check: "desktop QA blocks external requests and issues no mutating requests",
    pass: blockedRequests.every(({ method }) => ["GET", "HEAD"].includes(method)),
    blockedRequests,
  })
  if (capture) await page.screenshot({ path: `.backups/crm-desktop-after.png`, fullPage: false })
  await page.close()
}

async function checkMobile(width) {
  const { page, blockedRequests } = await newProtectedPage({
    viewport: { width, height: 720 },
    isMobile: true,
    hasTouch: true,
  })
  await page.goto(`${baseURL}/board/mobile-fixture`, { waitUntil: "load", timeout: 15_000 })
  const main = page.locator(".app > main.main").last()
  await main.waitFor({ timeout: 5_000 })

  const contentOrder = await main.evaluate((main) => [...main.children].map((child) => {
    const box = child.getBoundingClientRect()
    return {
      tag: child.tagName,
      className: child.className,
      label: child.getAttribute("aria-label"),
      top: box.top + scrollY,
      bottom: box.bottom + scrollY,
    }
  }))

  const scroll = []
  for (let index = 0; index < 14; index += 1) {
    await page.mouse.wheel(0, 640)
    await page.waitForTimeout(35)
    scroll.push(await page.evaluate(() => scrollY))
  }
  const terminal = await page.evaluate(() => ({
    y: scrollY,
    max: document.documentElement.scrollHeight - innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }))
  results.push({
    check: `${width}px wheel reaches the native document end`,
    pass: terminal.max > 0 && terminal.y >= terminal.max - 2 && terminal.scrollWidth <= terminal.viewport,
    terminal,
    scroll,
    contentOrder,
  })

  const scheduledDay = page.getByRole("button", { name: /Thursday, September 10, 2026, 1 job scheduled/i })
  await scheduledDay.click()
  const calendarSelection = {
    pressed: await scheduledDay.getAttribute("aria-pressed"),
    href: await page.getByRole("link", { name: /Open Riverbend Fabrication/i }).getAttribute("href"),
  }
  results.push({
    check: `${width}px calendar selects a populated day and exposes its work order`,
    pass: calendarSelection.pressed === "true" && calendarSelection.href === "/ops/leads/4242",
    calendarSelection,
  })
  await scheduledDay.press("ArrowRight")
  const calendarKeyboard = await scheduledDay.evaluate((button) => {
    const calendar = button.closest("section")
    const active = document.activeElement
    return {
      tabbableDays: calendar?.querySelectorAll('button[tabindex="0"]').length ?? 0,
      activeName: active?.getAttribute("aria-label"),
      activePressed: active?.getAttribute("aria-pressed"),
    }
  })
  results.push({
    check: `${width}px calendar uses one arrow-navigable tab stop`,
    pass: calendarKeyboard.tabbableDays === 1
      && calendarKeyboard.activeName?.includes("Friday, September 11, 2026")
      && calendarKeyboard.activePressed === "true",
    calendarKeyboard,
  })

  const voiceButton = page.getByRole("button", { name: "Hear it now" })
  await voiceButton.scrollIntoViewIfNeeded()
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  const coverage = await voiceButton.evaluate((button) => {
    const action = button.getBoundingClientRect()
    const rail = document.querySelector(".rail")?.getBoundingClientRect()
    const strip = button.closest(".voice-strip")?.getBoundingClientRect()
    const call = button.closest("aside")?.getBoundingClientRect()
    return rail ? {
      actionTop: action.top,
      actionBottom: action.bottom,
      railTop: rail.top,
      railBottom: rail.bottom,
      stripTop: strip?.top,
      stripBottom: strip?.bottom,
      callTop: call?.top,
      callBottom: call?.bottom,
      covered: action.bottom > rail.top && action.top < rail.bottom,
    } : null
  })
  results.push({
    check: `${width}px voice action clears the fixed rail`,
    pass: Boolean(coverage && !coverage.covered && coverage.actionBottom <= coverage.railTop),
    coverage,
  })
  if (capture) await page.screenshot({ path: `.backups/crm-voice-${width}-after.png`, fullPage: false })

  const source = page.locator("#closeout-source")
  await source.fill("Finished the bracket, fit good, nothing left.")
  await page.getByRole("button", { name: "Review closeout" }).click()
  const closeoutType = await page.locator(".ops-closeout-form").evaluate((form) => {
    const controls = [...form.querySelectorAll("textarea, input:not([type='hidden']), select")]
    const labels = [...form.querySelectorAll("label")]
    return {
      controlFontSizes: controls.map((control) => Number.parseFloat(getComputedStyle(control).fontSize)),
      textareaLineHeights: [...form.querySelectorAll("textarea")].map((control) => Number.parseFloat(getComputedStyle(control).lineHeight)),
      labelLineHeights: labels.map((label) => Number.parseFloat(getComputedStyle(label).lineHeight)),
    }
  })
  results.push({
    check: `${width}px closeout controls stay readable without iOS focus zoom`,
    pass: closeoutType.controlFontSizes.every((size) => size >= 16)
      && closeoutType.textareaLineHeights.every((height) => height >= 22)
      && closeoutType.labelLineHeights.every((height) => height >= 18),
    closeoutType,
  })
  const helperContrast = await page.locator(".ops-closeout-finish > small").evaluateAll((helpers) => {
    function channels(color) {
      return color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0]
    }
    function luminance(color) {
      const linear = channels(color).map((value) => {
        const channel = value / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    return helpers.map((helper) => {
      const foreground = getComputedStyle(helper).color
      let ancestor = helper.parentElement
      let background = "rgb(255, 255, 255)"
      while (ancestor) {
        const candidate = getComputedStyle(ancestor).backgroundColor
        if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
          background = candidate
          break
        }
        ancestor = ancestor.parentElement
      }
      const lighter = Math.max(luminance(foreground), luminance(background))
      const darker = Math.min(luminance(foreground), luminance(background))
      return {
        text: helper.textContent,
        foreground,
        background,
        ratio: (lighter + 0.05) / (darker + 0.05),
        fontSize: Number.parseFloat(getComputedStyle(helper).fontSize),
        lineHeight: Number.parseFloat(getComputedStyle(helper).lineHeight),
      }
    })
  })
  results.push({
    check: `${width}px completion helper text stays legible on the shop-floor surface`,
    pass: helperContrast.length === 2
      && helperContrast.every((helper) => helper.ratio >= 4.5 && helper.fontSize >= 14 && helper.lineHeight >= 19),
    helperContrast,
  })
  const swipe = page.locator(".ops-swipe-finish")
  const finishButton = page.locator(".ops-finish-button")

  await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto" })
  const documentY = await swipe.evaluate((button) => button.getBoundingClientRect().top + scrollY)
  await page.evaluate((target) => scrollTo(0, target), Math.max(0, documentY - 220))
  await page.waitForTimeout(200)
  const box = await swipe.boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const beforeWheel = await page.evaluate(() => scrollY)
  await page.mouse.wheel(0, 260)
  await page.waitForTimeout(200)
  const afterWheel = await page.evaluate(() => scrollY)
  results.push({
    check: `${width}px wheel remains native over the completion control`,
    pass: afterWheel > beforeWheel + 100,
    beforeWheel,
    afterWheel,
  })

  await page.evaluate((target) => scrollTo(0, target), Math.max(0, documentY - 220))
  await page.waitForTimeout(100)
  const touchBox = await swipe.boundingBox()
  if (touchBox) {
    const cdp = await page.context().newCDPSession(page)
    const x = touchBox.x + touchBox.width / 2
    const y = touchBox.y + touchBox.height / 2
    const beforeTouch = await page.evaluate(() => scrollY)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
    for (const offset of [20, 45, 75, 110, 150]) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - offset }] })
      await page.waitForTimeout(16)
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await page.waitForTimeout(80)
    const afterTouch = await page.evaluate(() => scrollY)
    results.push({
      check: `${width}px vertical touch drag remains native over the completion control`,
      pass: afterTouch > beforeTouch + 60,
      beforeTouch,
      afterTouch,
    })
  }

  const completionPosition = await finishButton.evaluate((button) => {
    const buttonDocumentTop = button.getBoundingClientRect().top + scrollY
    const rail = document.querySelector(".rail")?.getBoundingClientRect()
    const targetTop = (rail?.top ?? innerHeight) - button.getBoundingClientRect().height - 70
    scrollTo(0, Math.max(0, buttonDocumentTop - targetTop))
    const action = button.getBoundingClientRect()
    const settledRail = document.querySelector(".rail")?.getBoundingClientRect()
    const hit = document.elementFromPoint(action.left + action.width / 2, action.top + action.height / 2)
    return {
      actionTop: action.top,
      actionBottom: action.bottom,
      railTop: settledRail?.top,
      visible: action.top >= 0 && action.bottom <= (settledRail?.top ?? innerHeight),
      hitTarget: hit === button || Boolean(hit && button.contains(hit)),
    }
  })
  results.push({
    check: `${width}px completion button can sit fully above the fixed rail`,
    pass: completionPosition.visible && completionPosition.hitTarget,
    completionPosition,
  })

  if (width === 375) {
    await finishButton.focus()
    await page.keyboard.press("Enter")
  }
  else await finishButton.evaluate((button) => button.click())
  const clickState = await finishButton.getAttribute("aria-pressed")
  results.push({
    check: `${width}px completion has an operable native-button confirmation`,
    pass: clickState === "true" && await finishButton.textContent() === "Confirm completion",
    activation: width === 375 ? "keyboard Enter" : "assistive synthesized click",
    ariaPressedAfterClick: clickState,
  })
  await page.evaluate(() => {
    window.__completionSubmits = 0
    document.querySelector(".ops-done-bench form")?.addEventListener("submit", (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      window.__completionSubmits += 1
    }, true)
  })
  await finishButton.dispatchEvent("keydown", { key: "Enter", repeat: true })
  const submitsAfterRepeat = await page.evaluate(() => window.__completionSubmits)
  if (capture) await page.screenshot({ path: `.backups/crm-completion-${width}-after.png`, fullPage: false })
  if (width === 375) await finishButton.click()
  else await finishButton.evaluate((button) => button.click())
  await page.waitForTimeout(50)
  const completionSubmits = await page.evaluate(() => window.__completionSubmits)
  results.push({
    check: `${width}px explicit completion requires two presses and submits once`,
    pass: clickState === "true" && submitsAfterRepeat === 0 && completionSubmits === 1,
    submitsAfterRepeat,
    completionSubmits,
  })
  results.push({
    check: `${width}px QA blocks external requests and issues no mutating requests`,
    pass: blockedRequests.every(({ method }) => ["GET", "HEAD"].includes(method)),
    blockedRequests,
  })
  await page.close()
}

try {
  await installFixture()
  browser = await chromium.launch({ headless: true })
  await checkDesktop()
  if (!process.env.MCSW_REPRO_DESKTOP_ONLY) {
    await checkMobile(375)
    await checkMobile(390)
  }
} finally {
  if (browser) await browser.close()
  await removeFixture()
}

console.log(JSON.stringify(results, null, 2))
if (results.some((result) => !result.pass)) process.exitCode = 1
