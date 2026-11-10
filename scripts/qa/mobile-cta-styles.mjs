// Standalone browser regression: node scripts/qa/mobile-cta-styles.mjs
// Kept outside npm test because normal CI does not install Playwright browsers.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, webkit } from "@playwright/test"

const root = new URL("../..", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const require = createRequire(import.meta.url)
const { calculateSizeAdjustValues } = require("next/dist/server/font-utils")
const fallback = calculateSizeAdjustValues("Barlow Condensed")
// Match next/font's real adjusted fallback while testing without a Next server.
const fontCss = `@font-face { font-family: CTAFallback; src: local('${fallback.fallbackFont}'); ascent-override: ${fallback.ascent}%; descent-override: ${fallback.descent}%; line-gap-override: ${fallback.lineGap}%; size-adjust: ${fallback.sizeAdjust}%; } body { --font-ms-display: CTAFallback, Arial, sans-serif; }`
const css = (await postcss([tailwindcss({ optimize: true })]).process(read("app/globals.css"), {
  from: fileURLToPath(new URL("app/globals.css", root)),
})).css + read("app/homepage-polish.css") + fontCss
const properties = [
  "background", "color", "border-top", "border-right", "border-bottom", "border-left",
  "border-radius", "font", "line-height", "letter-spacing", "text-transform", "white-space", "padding",
  "appearance", "outline", "outline-offset", "box-shadow", "filter", "transform", "opacity",
]

function markup(flag) {
  const output = ts.transpileModule(read("components/mobile-quick-actions.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const fakes = {
    react: { ...React, useState: () => [true, () => {}], useEffect: () => {} },
    "next/link": { __esModule: true, default: (props) => React.createElement("a", props) },
    "@/lib/shop-phone-shared": { FALLBACK_SHOP_PHONE_HREF: "tel:+16157033296" },
  }
  const context = vm.createContext({ process: { env: { NEXT_PUBLIC_ASSISTANT_CHAT: flag } }, require: (name) => fakes[name] ?? require(name) })
  vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, context.require, loaded)
  return renderToStaticMarkup(React.createElement(loaded.exports.MobileQuickActions))
}

const quote = markup("0")
const ask = markup("1")
assert.match(quote, />Quote<\/a>/)
assert.match(ask, />Ask the shop<\/button>/)
// Nonvisual sentinels prove that CSS pseudo selectors are active. Chromium's
// matches(':hover') can report false even while its :hover declarations apply.
const probes = ".ms-mobile-cta > a:hover, .ms-mobile-cta > button:hover { --cta-hover-probe:1; } .ms-mobile-cta > a:active, .ms-mobile-cta > button:active { --cta-active-probe:1; }"
const fixture = (surface, html) => `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${probes}</style><main class="ms-site ${surface}">${html}</main>`

for (const engine of [chromium, webkit]) {
  let browser = await engine.launch({ headless: true })
  try {
    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    for (const width of [360, 390, 768, 979]) {
      await mobilePage.setViewportSize({ width, height: 844 })
      for (const surface of ["ms-home", "ms-subpage"]) {
        const actualCopy = []
        for (const html of [quote, ask]) {
          await mobilePage.setContent(fixture(surface, html))
          await mobilePage.evaluate(() => document.fonts.ready)
          const mobileAction = mobilePage.locator(".ms-mobile-cta > :last-child")
          const geometry = await mobileAction.evaluate((element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            const text = range.getBoundingClientRect()
            const box = element.getBoundingClientRect()
            return { height: box.height, lines: range.getClientRects().length, fits: text.left >= box.left && text.right <= box.right, appearance: getComputedStyle(element).appearance }
          })
          actualCopy.push(geometry)
          assert.equal(geometry.lines, 1, `${engine.name()} ${surface} ${width}px: actual CTA copy must stay on one line`)
          assert.equal(geometry.fits, true, `${engine.name()} ${surface} ${width}px: actual CTA label must fit its button`)
          assert.equal(geometry.appearance, "none", "touch browser must paint the shared CTA CSS")
          const mobileCall = mobilePage.locator(".ms-mobile-cta > :first-child")
          assert.ok((await mobileCall.boundingBox()).width > (await mobileAction.boundingBox()).width, "Call remains the larger primary")
          assert.match(await mobileCall.evaluate((element) => getComputedStyle(element).backgroundImage), /linear-gradient/)
        }
        assert.equal(actualCopy[1].height, actualCopy[0].height, `${engine.name()} ${surface} ${width}px: actual Ask copy must preserve Quote height`)
      }
    }
    await mobilePage.close()
    await browser.close()
    browser = await engine.launch({ headless: true })
    // Use a mouse-capable context for hover at the same responsive widths.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    for (const width of [360, 390, 768, 979]) {
      await page.setViewportSize({ width, height: 844 })
      for (const surface of ["ms-home", "ms-subpage"]) {
        const variants = []
        for (const html of [quote, ask]) {
          await page.setContent(fixture(surface, html))
          await page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault()))
          await page.evaluate(() => document.fonts.ready)
          const action = page.locator(".ms-mobile-cta > :last-child")
          // After checking the real copy, normalize its label to isolate the
          // element styling from intrinsic text width in the state comparison.
          await action.evaluate((element) => { element.textContent = "Quote" })
          const states = {}
          for (const state of ["default", "hover", "active", "focus-visible"]) {
            if (state === "default") await page.mouse.move(0, 0)
            if (state === "hover") {
              await action.hover()
              await page.waitForFunction(() => getComputedStyle(document.querySelector(".ms-mobile-cta > :last-child")).getPropertyValue("--cta-hover-probe").trim() === "1", null, { timeout: 1000 })
            }
            if (state === "active") {
              await page.mouse.down()
              await page.waitForFunction(() => getComputedStyle(document.querySelector(".ms-mobile-cta > :last-child")).getPropertyValue("--cta-active-probe").trim() === "1", null, { timeout: 1000 })
            }
            if (state === "focus-visible") {
              await page.mouse.up()
              await page.keyboard.press("Tab")
              await action.focus()
              assert.equal(await action.evaluate((element) => element.matches(":focus-visible")), true)
            }
            states[state] = await action.evaluate((element, properties) => ({
              ...Object.fromEntries(properties.map((property) => [property, getComputedStyle(element).getPropertyValue(property)])),
              height: element.getBoundingClientRect().height,
            }), properties)
            assert.equal(states[state].background.startsWith("rgb(36, 29, 18)"), true, "secondary background remains opaque")
            assert.equal(states[state].color, "rgb(243, 234, 216)")
          }
          variants.push(states)
        }
        assert.deepEqual(variants[1], variants[0], `${engine.name()} ${surface} ${width}px: Ask button must match Quote link in every state`)
      }
    }
    console.log(`${engine.name()}: Quote/button parity passed at 360, 390, 768 and 979px in default, hover, active and focus-visible states`)
  } finally {
    await browser.close()
  }
}
