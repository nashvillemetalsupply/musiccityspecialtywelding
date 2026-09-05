import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { ROUTES, WIDTHS, FLOOR_PX, AXE_TAGS } from "./routes.mjs"

const ROWS = "scripts/qa/report/rows"
mkdirSync(ROWS, { recursive: true })
const STRICT = process.env.MCSW_QA_STRICT === "1"
const BASE = process.env.MCSW_QA_BASE

// Live routes poll (OpsLive, the calls dropdown), so "networkidle" never
// arrives. Ready means: the document loaded, the fonts settled, and the
// first heading is on screen.
async function ready(page, path) {
  await page.goto(path, { waitUntil: "load" })
  await page.locator("h1, h2").first().waitFor({ state: "visible" })
  await page.evaluate(() => document.fonts.ready)
}

// Everything measurable about one rendered page, in one evaluate.
async function measure(page) {
  return page.evaluate((FLOOR) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"
    }
    let minFont = Infinity, minFontSel = ""
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue
      const el = n.parentElement
      if (!el || el.closest(".sr-only,[hidden],script,style,noscript")) continue
      if (!visible(el)) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < minFont) { minFont = fs; minFontSel = el.tagName.toLowerCase() + "." + [...el.classList].join(".") }
    }
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map((h) => +h.tagName[1])
    let orderOk = true
    for (let i = 1; i < headings.length; i++) if (headings[i] > headings[i - 1] + 1) orderOk = false
    const fp = {}
    for (const el of document.querySelectorAll("[class*='ops-']")) {
      const cls = [...el.classList].filter((c) => c.startsWith("ops-")).join(" ")
      if (!cls || fp[cls]) continue
      const cs = getComputedStyle(el)
      fp[cls] = [cs.fontSize, cs.fontWeight, cs.color, cs.backgroundColor, cs.padding, cs.display, cs.lineHeight].join("|")
    }
    return {
      minFont: minFont === Infinity ? null : minFont,
      minFontSel,
      floorOk: minFont >= FLOOR,
      h1: document.querySelectorAll("h1").length,
      main: document.querySelectorAll("main").length,
      skipLink: !!document.querySelector("a[href='#main']"),
      orderOk,
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      fp,
    }
  }, FLOOR_PX)
}

const row = (name, data) => writeFileSync(`${ROWS}/${name}.json`, JSON.stringify(data))

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    test(`${route.key} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await ready(page, route.path)
      const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
      const m = await measure(page)
      row(`${route.key}-${width}`, { route: route.key, width, axe: axe.violations.length,
        axeIds: axe.violations.map((v) => v.id).join(","), ...m, fp: width === 1440 ? m.fp : undefined })
      // The baseline run asserts nothing; Task 6 flips STRICT on.
      if (STRICT) {
        expect(axe.violations, axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`).join("\n")).toEqual([])
        expect(m.floorOk, `min font ${m.minFont}px at ${m.minFontSel}`).toBe(true)
        expect(m.h1).toBe(1)
        expect(m.main).toBe(1)
        expect(m.skipLink).toBe(true)
        expect(m.orderOk).toBe(true)
        expect(m.overflow).toBe(0)
      }
    })
  }
}

test("skip link moves focus to main", async ({ page }) => {
  await ready(page, "/board")
  await page.keyboard.press("Tab")
  const href = await page.evaluate(() => document.activeElement?.getAttribute("href"))
  let landed = null
  if (href === "#main") {
    await page.keyboard.press("Enter")
    landed = await page.evaluate(() => document.activeElement?.id)
  }
  row("skip-link", { route: "board", width: "skip", skipLink: href === "#main", landed })
  if (STRICT) { expect(href).toBe("#main"); expect(landed).toBe("main") }
})

test("no third-party font request", async ({ page }) => {
  const external = []
  page.on("request", (r) => { if (/fonts\.g(oogleapis|static)\.com/.test(r.url())) external.push(r.url()) })
  await ready(page, "/board")
  row("fonts", { route: "board", width: "fonts", externalFonts: external.length })
  if (STRICT) expect(external).toEqual([])
})

test("signed-out /board is the structural zero state, still measured", async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${BASE}/board`, { waitUntil: "load" })
  const m = await measure(page)
  row("signedout-1280", { route: "signedout", width: 1280, ...m, fp: undefined })
  await ctx.close()
})
