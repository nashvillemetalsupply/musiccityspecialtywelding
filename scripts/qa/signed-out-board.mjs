/**
 * Read-only browser gate for the real, signed-out /board route.
 *
 * The browser context is new for every case. Non-GET/HEAD requests and every
 * request outside the configured local origin are blocked, so this harness
 * cannot create an operator, write a job, or call a configured provider.
 *
 * Run (with the app already listening):
 *   node scripts/qa/signed-out-board.mjs
 *   MCSW_BOARD_QA_BASE=http://localhost:3033 node scripts/qa/signed-out-board.mjs
 */
import AxeBuilder from "@axe-core/playwright"
import { chromium } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"

const BASE = new URL(process.env.MCSW_BOARD_QA_BASE ?? "http://localhost:3033")
const BOARD_URL = new URL("/board", BASE)
const OUT = "scripts/qa/report/signed-out-board"
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
const CASES = [
  { name: "desktop", width: 1440, height: 900, coarse: false },
  { name: "laptop", width: 1024, height: 768, coarse: false },
  { name: "phone-375", width: 375, height: 812, coarse: true },
  { name: "phone-390", width: 390, height: 844, coarse: true },
].flatMap((viewport) => ["light", "dark"].map((theme) => ({ ...viewport, theme })))

mkdirSync(OUT, { recursive: true })

function check(failures, condition, message) {
  if (!condition) failures.push(message)
}

async function waitForBoard(page) {
  const response = await page.goto(BOARD_URL.href, { waitUntil: "load" })
  if (!response) throw new Error("/board returned no document response")
  if (!response.ok()) throw new Error(`/board returned HTTP ${response.status()}`)
  await page.getByRole("heading", { level: 1, name: "Job tracker" }).waitFor({ state: "visible" })
  await page.evaluate(() => document.fonts.ready)
}

async function geometry(page, coarse) {
  return page.evaluate(({ coarse }) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== "none"
        && style.visibility !== "hidden"
    }
    const label = (element) => element.getAttribute("aria-label")
      || element.textContent?.replace(/\s+/g, " ").trim()
      || element.getAttribute("name") || element.tagName.toLowerCase()
    const actionable = [...document.querySelectorAll("a[href],button,input,select,textarea,summary,[tabindex]")]
      .filter((element) => visible(element) && element.id !== "main" && !element.classList.contains("skip"))
    const undersized = coarse ? actionable.flatMap((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width < 44 || rect.height < 44
        ? [{ label: label(element), width: Math.round(rect.width), height: Math.round(rect.height) }]
        : []
    }) : []
    const unnamed = actionable.filter((element) => !label(element)).map((element) => element.outerHTML.slice(0, 100))
    const main = document.querySelector("main#main")
    const trackerHeading = [...document.querySelectorAll("h1")].find((heading) => heading.textContent?.trim() === "Job tracker")
    const tracker = trackerHeading?.closest("section.card")
    const mainRect = main?.getBoundingClientRect()
    const trackerRect = tracker?.getBoundingClientRect()
    const jobRows = document.querySelectorAll(".job").length
    return {
      viewport: { width: innerWidth, height: innerHeight },
      path: location.pathname,
      explicitTheme: document.documentElement.getAttribute("data-theme"),
      prefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
      colors: {
        background: getComputedStyle(document.body).backgroundColor,
        foreground: getComputedStyle(document.body).color,
      },
      mainWidth: mainRect?.width ?? 0,
      trackerWidth: trackerRect?.width ?? 0,
      documentOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      bodyOverflow: Math.max(0, document.body.scrollWidth - innerWidth),
      jobRows,
      signedInChrome: Boolean(document.querySelector(".who-dot,.board-more")),
      emptyTracker: Boolean(document.querySelector(".track-empty")),
      topLevelH1s: document.querySelectorAll("h1").length,
      mains: document.querySelectorAll("main").length,
      skipLinks: document.querySelectorAll("a[href='#main']").length,
      actionable: actionable.length,
      unnamed,
      undersized,
    }
  }, { coarse })
}

async function keyboardCheck(page) {
  await page.evaluate(() => {
    const scrolling = document.scrollingElement
    if (scrolling) scrolling.scrollTop = 0
    const main = document.querySelector("main#main")
    if (main) main.scrollTop = 0
    document.activeElement?.blur()
  })
  await page.keyboard.press("Tab")
  const first = await page.evaluate(() => ({
    href: document.activeElement?.getAttribute("href"),
    text: document.activeElement?.textContent?.trim(),
    outlineStyle: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none",
    outlineWidth: document.activeElement ? getComputedStyle(document.activeElement).outlineWidth : "0px",
  }))
  if (first.href === "#main") await page.keyboard.press("Enter")
  const landed = await page.evaluate(() => document.activeElement?.id ?? null)
  return { first, landed }
}

async function themeToggleCheck(page, expectedTheme) {
  const before = await page.evaluate(() => ({
    explicit: document.documentElement.getAttribute("data-theme"),
    background: getComputedStyle(document.body).backgroundColor,
    foreground: getComputedStyle(document.body).color,
  }))
  await page.locator("#theme").click()
  const opposite = expectedTheme === "dark" ? "light" : "dark"
  await page.waitForFunction((theme) => document.documentElement.getAttribute("data-theme") === theme, opposite)
  const toggled = await page.evaluate(() => ({
    explicit: document.documentElement.getAttribute("data-theme"),
    background: getComputedStyle(document.body).backgroundColor,
    foreground: getComputedStyle(document.body).color,
  }))
  await page.locator("#theme").click()
  await page.waitForFunction((theme) => document.documentElement.getAttribute("data-theme") === theme, expectedTheme)
  const restored = await page.evaluate(() => ({
    explicit: document.documentElement.getAttribute("data-theme"),
    background: getComputedStyle(document.body).backgroundColor,
    foreground: getComputedStyle(document.body).color,
  }))
  return { before, toggled, restored }
}

async function wheelToEnd(page) {
  const pointer = await page.evaluate(() => {
    const main = document.querySelector("main#main")
    const mainStyle = main ? getComputedStyle(main) : null
    const mainScrolls = Boolean(main && /(auto|scroll)/.test(mainStyle?.overflowY ?? "") && main.scrollHeight > main.clientHeight + 1)
    const scroller = mainScrolls ? main : document.scrollingElement
    if (scroller) scroller.scrollTop = 0
    const rect = main?.getBoundingClientRect()
    return {
      x: Math.round(Math.min(innerWidth - 2, Math.max(1, (rect?.left ?? 0) + (rect?.width ?? innerWidth) / 2))),
      y: Math.round(Math.min(innerHeight - 2, Math.max(1, (rect?.top ?? 0) + Math.min((rect?.height ?? innerHeight) / 2, 300)))),
    }
  })
  await page.mouse.move(pointer.x, pointer.y)

  let bottomActionSeen = false
  for (let step = 0; step < 24; step += 1) {
    bottomActionSeen ||= await page.evaluate(() => {
      const main = document.querySelector("main#main")
      const actions = [...(main?.querySelectorAll("a[href],button,input,select,textarea,summary") ?? [])]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
        })
      const last = actions.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).at(-1)
      if (!last) return true
      const rect = last.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < innerHeight
    })
    await page.mouse.wheel(0, 650)
    await page.waitForTimeout(30)
  }

  return page.evaluate((bottomActionSeen) => {
    const main = document.querySelector("main#main")
    const mainStyle = main ? getComputedStyle(main) : null
    const mainScrolls = Boolean(main && /(auto|scroll)/.test(mainStyle?.overflowY ?? "") && main.scrollHeight > main.clientHeight + 1)
    const scroller = mainScrolls ? main : document.scrollingElement
    const terminal = main?.lastElementChild
    const rect = terminal?.getBoundingClientRect()
    const mainRect = main?.getBoundingClientRect()
    const visibleTop = Math.max(rect?.top ?? 0, mainScrolls ? (mainRect?.top ?? 0) + 2 : 58)
    const visibleBottom = Math.min(rect?.bottom ?? 0, mainScrolls ? (mainRect?.bottom ?? innerHeight) - 2 : innerHeight - 58)
    const sampleX = rect ? Math.min(innerWidth - 2, Math.max(1, rect.left + Math.min(rect.width / 2, 20))) : 1
    const sampleY = visibleBottom > visibleTop ? (visibleTop + visibleBottom) / 2 : 1
    const covering = document.elementFromPoint(sampleX, sampleY)
    return {
      scrollOwner: mainScrolls ? "main" : "document",
      scrollTop: scroller?.scrollTop ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      clientHeight: scroller?.clientHeight ?? 0,
      reachedEnd: Boolean(scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2),
      terminalVisible: Boolean(rect && rect.bottom > 0 && rect.top < innerHeight),
      terminalUncovered: Boolean(terminal && covering && (terminal === covering || terminal.contains(covering))),
      bottomActionSeen,
    }
  }, bottomActionSeen)
}

const browser = await chromium.launch({ headless: true })
const results = []
let failed = false

try {
  for (const testCase of CASES) {
    const context = await browser.newContext({
      viewport: { width: testCase.width, height: testCase.height },
      colorScheme: testCase.theme,
      hasTouch: testCase.coarse,
      isMobile: testCase.coarse,
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    const blocked = []
    const consoleErrors = []
    const pageErrors = []

    await page.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const safeMethod = request.method() === "GET" || request.method() === "HEAD"
      if (url.origin !== BASE.origin || !safeMethod) {
        blocked.push({ method: request.method(), url: request.url() })
        await route.abort("blockedbyclient")
        return
      }
      await route.continue()
    })
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    page.on("pageerror", (error) => pageErrors.push(error.message))

    const failures = []
    try {
      await waitForBoard(page)
      const initial = await geometry(page, testCase.coarse)
      const keyboard = await keyboardCheck(page)
      const themeToggle = await themeToggleCheck(page, testCase.theme)
      const key = `${testCase.name}-${testCase.theme}`
      await page.screenshot({ path: `${OUT}/${key}-top.png` })
      const scroll = await wheelToEnd(page)
      await page.screenshot({ path: `${OUT}/${key}-bottom.png` })
      const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
      const severeAxe = axe.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")

      check(failures, initial.path === "/board", `unexpected path ${initial.path}`)
      check(failures, initial.prefersDark === (testCase.theme === "dark"), `browser did not emulate ${testCase.theme} scheme`)
      check(failures, themeToggle.toggled.explicit === (testCase.theme === "dark" ? "light" : "dark"), `theme control did not switch away from ${testCase.theme}`)
      check(failures, themeToggle.restored.explicit === testCase.theme, `theme control did not restore ${testCase.theme}`)
      check(failures, themeToggle.before.background !== themeToggle.toggled.background || themeToggle.before.foreground !== themeToggle.toggled.foreground, "theme control changed its label state but not the rendered colors")
      check(failures, initial.mainWidth >= testCase.width * (testCase.coarse ? 0.96 : 0.88), `main is only ${Math.round(initial.mainWidth)}px of ${testCase.width}px`)
      check(failures, initial.trackerWidth >= testCase.width * (testCase.coarse ? 0.90 : testCase.width >= 1200 ? 0.84 : 0.76), `tracker is only ${Math.round(initial.trackerWidth)}px of ${testCase.width}px`)
      check(failures, initial.documentOverflow <= 1 && initial.bodyOverflow <= 1, `horizontal overflow: document ${initial.documentOverflow}px, body ${initial.bodyOverflow}px`)
      check(failures, initial.jobRows === 0 && initial.emptyTracker, `signed-out route exposed ${initial.jobRows} job rows or lost its zero state`)
      check(failures, !initial.signedInChrome, "signed-out route rendered signed-in chrome")
      check(failures, initial.topLevelH1s === 1 && initial.mains === 1 && initial.skipLinks === 1, `landmarks: ${initial.topLevelH1s} h1, ${initial.mains} main, ${initial.skipLinks} skip link`)
      check(failures, initial.unnamed.length === 0, `${initial.unnamed.length} visible controls have no accessible name`)
      check(failures, initial.undersized.length === 0, `${initial.undersized.length} coarse-pointer controls are smaller than 44px`)
      check(failures, keyboard.first.href === "#main" && keyboard.landed === "main", `skip link focus failed (${keyboard.first.href} -> ${keyboard.landed})`)
      check(failures, keyboard.first.outlineStyle !== "none" && keyboard.first.outlineWidth !== "0px", "focused skip link has no measurable outline")
      check(failures, scroll.reachedEnd && scroll.terminalVisible && scroll.terminalUncovered, `wheel did not reach an uncovered terminal state (${JSON.stringify(scroll)})`)
      check(failures, scroll.bottomActionSeen, "bottom-most signed-out action was never reachable by wheel")
      check(failures, severeAxe.length === 0, `serious/critical axe: ${severeAxe.map((violation) => violation.id).join(", ")}`)
      check(failures, blocked.length === 0, `page attempted blocked external/mutating requests: ${blocked.map((request) => `${request.method} ${request.url}`).join(", ")}`)
      check(failures, pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`)
      check(failures, consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`)

      await page.evaluate(() => {
        const scrolling = document.scrollingElement
        if (scrolling) scrolling.scrollTop = 0
        const main = document.querySelector("main#main")
        if (main) main.scrollTop = 0
      })
      await page.screenshot({ path: `${OUT}/${key}.png`, fullPage: true })
      results.push({ case: testCase, ok: failures.length === 0, failures, initial, themeToggle, keyboard, scroll,
        axe: axe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })), blocked,
        consoleErrors, pageErrors })
      console.log(`${failures.length === 0 ? "PASS" : "FAIL"} ${key}${failures.length ? `\n  ${failures.join("\n  ")}` : ""}`)
      failed ||= failures.length > 0
    } catch (error) {
      failed = true
      results.push({ case: testCase, ok: false, failures: [error.stack ?? error.message], blocked, consoleErrors, pageErrors })
      console.error(`FAIL ${testCase.name}-${testCase.theme}\n  ${error.stack ?? error.message}`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}

writeFileSync(`${OUT}/results.json`, `${JSON.stringify({ base: BASE.href, generatedAt: new Date().toISOString(), results }, null, 2)}\n`)
console.log(`\nReport: ${OUT}/results.json`)
process.exitCode = failed ? 1 : 0
